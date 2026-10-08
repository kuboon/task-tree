/**
 * Everything a signed-in user can do, as one object per request.
 *
 * Both front doors call this and nothing else: the browser through `POST /api/ops/:name`, MCP
 * clients through `/mcp`. Every rule lives here — membership, ownership, the tree and the
 * dependency graph staying acyclic — so the two cannot drift apart.
 *
 * A team that the caller is not a member of answers `not_found`, not `forbidden`: whether a team
 * exists is itself something only its members get to know.
 */

import { monotonicUlid } from "@std/ulid";

import { all, batch, type Db, first, run, stmt } from "../lib/sql.ts";
import { AppError } from "./errors.ts";
import type {
  Invite,
  InvitePreview,
  Me,
  Member,
  Task,
  TaskDetail,
  TaskStatus,
  TeamDetail,
  TeamRole,
  TeamSummary,
} from "./types.ts";

/** How long an invite link stays valid. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface TaskFilter {
  status?: TaskStatus;
  /** `null` for unassigned tasks. */
  assigneeId?: string | null;
  /** Only tasks that are not done and have every dependency done. */
  readyOnly?: boolean;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  assigneeId?: string | null;
  parentId?: string | null;
  dependsOn?: string[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  assigneeId?: string | null;
  parentId?: string | null;
}

interface TaskRow {
  id: string;
  team_id: string;
  parent_id: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  assignee_id: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

const newId = () => monotonicUlid();

function newToken(): string {
  return crypto.getRandomValues(new Uint8Array(16)).toBase64({
    alphabet: "base64url",
    omitPadding: true,
  });
}

function cleanName(value: string, what: string, max = 200): string {
  const trimmed = value.trim();
  if (!trimmed) throw new AppError("invalid", `${what}を入力してください。`);
  if (trimmed.length > max) {
    throw new AppError("invalid", `${what}は ${max} 文字以内にしてください。`);
  }
  return trimmed;
}

/**
 * Record a user as the IdP describes them. A `null` nickname (an MCP access token carries none)
 * keeps whatever the browser sign-in stored.
 */
export async function upsertUser(
  db: Db,
  userId: string,
  nickname: string | null,
): Promise<void> {
  await run(
    db,
    `INSERT INTO users (id, nickname, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       nickname = COALESCE(excluded.nickname, users.nickname),
       updated_at = excluded.updated_at`,
    userId,
    nickname,
    Date.now(),
  );
}

export class Service {
  constructor(readonly db: Db, readonly userId: string) {}

  // --- me -------------------------------------------------------------------

  async me(): Promise<Me> {
    const row = await first<{ nickname: string | null }>(
      this.db,
      "SELECT nickname FROM users WHERE id = ?",
      this.userId,
    );
    return { userId: this.userId, nickname: row?.nickname ?? null };
  }

  // --- teams ----------------------------------------------------------------

  async listTeams(): Promise<TeamSummary[]> {
    const rows = await all<{
      id: string;
      name: string;
      role: TeamRole;
      created_at: number;
      member_count: number;
    }>(
      this.db,
      `SELECT t.id, t.name, m.role, t.created_at,
         (SELECT COUNT(*) FROM team_members x WHERE x.team_id = t.id) AS member_count
       FROM teams t JOIN team_members m ON m.team_id = t.id
       WHERE m.user_id = ?
       ORDER BY t.created_at`,
      this.userId,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      memberCount: Number(r.member_count),
      createdAt: Number(r.created_at),
    }));
  }

  async createTeam(name: string): Promise<TeamSummary> {
    const id = newId();
    const now = Date.now();
    const clean = cleanName(name, "チーム名", 100);
    await batch(this.db, [
      stmt(
        this.db,
        "INSERT INTO teams (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
        id,
        clean,
        this.userId,
        now,
      ),
      stmt(
        this.db,
        "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
        id,
        this.userId,
        now,
      ),
    ]);
    return { id, name: clean, role: "owner", memberCount: 1, createdAt: now };
  }

  async getTeam(teamId: string): Promise<TeamDetail> {
    const myRole = await this.#role(teamId);
    const team = await first<{ name: string; created_at: number }>(
      this.db,
      "SELECT name, created_at FROM teams WHERE id = ?",
      teamId,
    );
    if (!team) throw notFoundTeam();
    return {
      id: teamId,
      name: team.name,
      createdAt: Number(team.created_at),
      myRole,
      members: await this.#members(teamId),
    };
  }

  async renameTeam(teamId: string, name: string): Promise<TeamDetail> {
    await this.#requireOwner(teamId);
    await run(
      this.db,
      "UPDATE teams SET name = ? WHERE id = ?",
      cleanName(name, "チーム名", 100),
      teamId,
    );
    return this.getTeam(teamId);
  }

  /** Deletes the team and every task, member and invite in it. Owner only. */
  async deleteTeam(teamId: string): Promise<{ deleted: true }> {
    await this.#requireOwner(teamId);
    await run(this.db, "DELETE FROM teams WHERE id = ?", teamId);
    return { deleted: true };
  }

  /**
   * Leave a team. The owner cannot — a team always has its owner; they delete it instead. Tasks
   * assigned to the leaver become unassigned.
   */
  async leaveTeam(teamId: string): Promise<{ left: true }> {
    const role = await this.#role(teamId);
    if (role === "owner") {
      throw new AppError(
        "forbidden",
        "オーナーはチームから抜けられません。不要ならチームを削除してください。",
      );
    }
    await this.#removeMembership(teamId, this.userId);
    return { left: true };
  }

  /** Remove another member. Owner only; their tasks become unassigned. */
  async removeMember(teamId: string, userId: string): Promise<TeamDetail> {
    await this.#requireOwner(teamId);
    if (userId === this.userId) {
      throw new AppError("invalid", "自分自身は外せません。");
    }
    const target = await first(
      this.db,
      "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
      teamId,
      userId,
    );
    if (!target) throw new AppError("not_found", "そのメンバーはいません。");
    await this.#removeMembership(teamId, userId);
    return this.getTeam(teamId);
  }

  // --- invites --------------------------------------------------------------

  /** A link anyone can use to join, until it expires. Any member can make one. */
  async createInvite(teamId: string): Promise<Invite> {
    await this.#role(teamId);
    const token = newToken();
    const now = Date.now();
    const expiresAt = now + INVITE_TTL_MS;
    await run(
      this.db,
      "INSERT INTO team_invites (token, team_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      token,
      teamId,
      this.userId,
      now,
      expiresAt,
    );
    return { token, teamId, expiresAt };
  }

  async getInvite(token: string): Promise<InvitePreview> {
    const invite = await this.#liveInvite(token);
    const member = await first(
      this.db,
      "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
      invite.team_id,
      this.userId,
    );
    return {
      teamId: invite.team_id,
      teamName: invite.name,
      expiresAt: Number(invite.expires_at),
      alreadyMember: member !== null,
    };
  }

  async acceptInvite(token: string): Promise<{ teamId: string }> {
    const invite = await this.#liveInvite(token);
    await run(
      this.db,
      `INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)
       ON CONFLICT (team_id, user_id) DO NOTHING`,
      invite.team_id,
      this.userId,
      Date.now(),
    );
    return { teamId: invite.team_id };
  }

  // --- tasks ----------------------------------------------------------------

  /** Every task in the team (filtered), with its dependencies and whether it is ready. */
  async listTasks(teamId: string, filter: TaskFilter = {}): Promise<Task[]> {
    await this.#role(teamId);
    const tasks = await this.#teamTasks(teamId);
    return tasks.filter((t) =>
      (filter.status === undefined || t.status === filter.status) &&
      (filter.assigneeId === undefined || t.assigneeId === filter.assigneeId) &&
      (!filter.readyOnly || t.ready)
    );
  }

  async getTask(teamId: string, taskId: string): Promise<TaskDetail> {
    await this.#role(teamId);
    const tasks = await this.#teamTasks(teamId);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw notFoundTask();
    return {
      ...task,
      childIds: tasks.filter((t) => t.parentId === taskId).map((t) => t.id),
      dependentIds: tasks.filter((t) => t.dependsOn.includes(taskId)).map((
        t,
      ) => t.id),
    };
  }

  async createTask(
    teamId: string,
    input: CreateTaskInput,
  ): Promise<TaskDetail> {
    await this.#role(teamId);
    const title = cleanName(input.title, "タイトル");
    const parentId = input.parentId ?? null;
    if (parentId !== null) await this.#requireTask(teamId, parentId);
    const assigneeId = input.assigneeId ?? null;
    if (assigneeId !== null) await this.#requireMember(teamId, assigneeId);
    const dependsOn = [...new Set(input.dependsOn ?? [])];
    for (const dep of dependsOn) await this.#requireTask(teamId, dep);

    // A new task has no dependents yet, so its dependencies cannot close a cycle.
    const id = newId();
    const now = Date.now();
    await batch(this.db, [
      stmt(
        this.db,
        `INSERT INTO tasks (id, team_id, parent_id, title, description, status, assignee_id,
           created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        teamId,
        parentId,
        title,
        input.description ?? "",
        input.status ?? "todo",
        assigneeId,
        this.userId,
        now,
        now,
      ),
      ...dependsOn.map((dep) =>
        stmt(
          this.db,
          "INSERT INTO task_deps (task_id, depends_on_id) VALUES (?, ?)",
          id,
          dep,
        )
      ),
    ]);
    return this.getTask(teamId, id);
  }

  async updateTask(
    teamId: string,
    taskId: string,
    input: UpdateTaskInput,
  ): Promise<TaskDetail> {
    await this.#role(teamId);
    await this.#requireTask(teamId, taskId);

    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.title !== undefined) {
      sets.push("title = ?");
      params.push(cleanName(input.title, "タイトル"));
    }
    if (input.description !== undefined) {
      sets.push("description = ?");
      params.push(input.description);
    }
    if (input.status !== undefined) {
      sets.push("status = ?");
      params.push(input.status);
    }
    if (input.assigneeId !== undefined) {
      if (input.assigneeId !== null) {
        await this.#requireMember(teamId, input.assigneeId);
      }
      sets.push("assignee_id = ?");
      params.push(input.assigneeId);
    }
    if (input.parentId !== undefined) {
      if (input.parentId !== null) {
        await this.#requireTask(teamId, input.parentId);
        if (await this.#isAncestorOrSelf(taskId, input.parentId)) {
          throw new AppError(
            "conflict",
            "そのタスクを親にすると、親子関係が循環します。",
          );
        }
      }
      sets.push("parent_id = ?");
      params.push(input.parentId);
    }
    if (sets.length > 0) {
      sets.push("updated_at = ?");
      params.push(Date.now());
      await run(
        this.db,
        `UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`,
        ...params,
        taskId,
      );
    }
    return this.getTask(teamId, taskId);
  }

  /**
   * Delete a task. Its children move up to its parent rather than disappearing with it; its
   * dependency edges go with it.
   */
  async deleteTask(teamId: string, taskId: string): Promise<{ deleted: true }> {
    await this.#role(teamId);
    const task = await this.#requireTask(teamId, taskId);
    await batch(this.db, [
      stmt(
        this.db,
        "UPDATE tasks SET parent_id = ?, updated_at = ? WHERE parent_id = ?",
        task.parent_id,
        Date.now(),
        taskId,
      ),
      stmt(this.db, "DELETE FROM tasks WHERE id = ?", taskId),
    ]);
    return { deleted: true };
  }

  /** `taskId` cannot start until `dependsOnId` is done. Refuses edges that would close a cycle. */
  async addDependency(
    teamId: string,
    taskId: string,
    dependsOnId: string,
  ): Promise<TaskDetail> {
    await this.#role(teamId);
    if (taskId === dependsOnId) {
      throw new AppError("invalid", "タスクは自分自身に依存できません。");
    }
    await this.#requireTask(teamId, taskId);
    await this.#requireTask(teamId, dependsOnId);
    if (await this.#dependsOnTransitively(dependsOnId, taskId)) {
      throw new AppError(
        "conflict",
        "その依存を足すと、依存関係が循環します。",
      );
    }
    await run(
      this.db,
      "INSERT INTO task_deps (task_id, depends_on_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
      taskId,
      dependsOnId,
    );
    return this.getTask(teamId, taskId);
  }

  async removeDependency(
    teamId: string,
    taskId: string,
    dependsOnId: string,
  ): Promise<TaskDetail> {
    await this.#role(teamId);
    await this.#requireTask(teamId, taskId);
    await run(
      this.db,
      "DELETE FROM task_deps WHERE task_id = ? AND depends_on_id = ?",
      taskId,
      dependsOnId,
    );
    return this.getTask(teamId, taskId);
  }

  // --- internals ------------------------------------------------------------

  /** The caller's role in the team; `not_found` when they are not in it. */
  async #role(teamId: string): Promise<TeamRole> {
    const row = await first<{ role: TeamRole }>(
      this.db,
      "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
      teamId,
      this.userId,
    );
    if (!row) throw notFoundTeam();
    return row.role;
  }

  async #requireOwner(teamId: string): Promise<void> {
    if (await this.#role(teamId) !== "owner") {
      throw new AppError(
        "forbidden",
        "この操作はチームのオーナーだけができます。",
      );
    }
  }

  async #requireMember(teamId: string, userId: string): Promise<void> {
    const row = await first(
      this.db,
      "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
      teamId,
      userId,
    );
    if (!row) {
      throw new AppError(
        "invalid",
        "担当者はチームのメンバーから選んでください。",
      );
    }
  }

  async #requireTask(teamId: string, taskId: string): Promise<TaskRow> {
    const row = await first<TaskRow>(
      this.db,
      "SELECT * FROM tasks WHERE id = ? AND team_id = ?",
      taskId,
      teamId,
    );
    if (!row) throw notFoundTask();
    return row;
  }

  async #members(teamId: string): Promise<Member[]> {
    const rows = await all<{
      user_id: string;
      nickname: string | null;
      role: TeamRole;
      joined_at: number;
    }>(
      this.db,
      `SELECT m.user_id, u.nickname, m.role, m.joined_at
       FROM team_members m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.team_id = ?
       ORDER BY m.role = 'owner' DESC, m.joined_at`,
      teamId,
    );
    return rows.map((r) => ({
      userId: r.user_id,
      nickname: r.nickname,
      role: r.role,
      joinedAt: Number(r.joined_at),
    }));
  }

  async #removeMembership(teamId: string, userId: string): Promise<void> {
    await batch(this.db, [
      stmt(
        this.db,
        "UPDATE tasks SET assignee_id = NULL, updated_at = ? WHERE team_id = ? AND assignee_id = ?",
        Date.now(),
        teamId,
        userId,
      ),
      stmt(
        this.db,
        "DELETE FROM team_members WHERE team_id = ? AND user_id = ?",
        teamId,
        userId,
      ),
    ]);
  }

  async #liveInvite(token: string) {
    const invite = await first<
      { team_id: string; name: string; expires_at: number }
    >(
      this.db,
      `SELECT i.team_id, t.name, i.expires_at
       FROM team_invites i JOIN teams t ON t.id = i.team_id
       WHERE i.token = ?`,
      token,
    );
    if (!invite || Number(invite.expires_at) < Date.now()) {
      throw new AppError("not_found", "招待リンクが無効か、期限切れです。");
    }
    return invite;
  }

  async #teamTasks(teamId: string): Promise<Task[]> {
    const [rows, deps] = await Promise.all([
      all<TaskRow>(
        this.db,
        "SELECT * FROM tasks WHERE team_id = ? ORDER BY created_at, id",
        teamId,
      ),
      all<{ task_id: string; depends_on_id: string }>(
        this.db,
        `SELECT d.task_id, d.depends_on_id FROM task_deps d
         JOIN tasks t ON t.id = d.task_id WHERE t.team_id = ?`,
        teamId,
      ),
    ]);
    const status = new Map(rows.map((r) => [r.id, r.status]));
    const dependsOn = new Map<string, string[]>();
    for (const d of deps) {
      const list = dependsOn.get(d.task_id) ?? [];
      list.push(d.depends_on_id);
      dependsOn.set(d.task_id, list);
    }
    return rows.map((r) => {
      const deps = dependsOn.get(r.id) ?? [];
      return {
        id: r.id,
        teamId: r.team_id,
        parentId: r.parent_id,
        title: r.title,
        description: r.description,
        status: r.status,
        assigneeId: r.assignee_id,
        createdBy: r.created_by,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
        dependsOn: deps,
        ready: r.status !== "done" &&
          deps.every((d) => status.get(d) === "done"),
      };
    });
  }

  /** Whether `candidate` is `taskId` itself or a descendant of it — making it the parent would loop. */
  async #isAncestorOrSelf(taskId: string, candidate: string): Promise<boolean> {
    // Walk up from the candidate parent; reaching `taskId` means it is a descendant of `taskId`.
    const hit = await first(
      this.db,
      `WITH RECURSIVE up(id) AS (
         SELECT ?
         UNION
         SELECT t.parent_id FROM tasks t JOIN up ON t.id = up.id WHERE t.parent_id IS NOT NULL
       )
       SELECT 1 FROM up WHERE id = ? LIMIT 1`,
      candidate,
      taskId,
    );
    return hit !== null;
  }

  /** Whether `from` already depends on `to`, directly or through other tasks. */
  async #dependsOnTransitively(from: string, to: string): Promise<boolean> {
    const hit = await first(
      this.db,
      `WITH RECURSIVE reach(id) AS (
         SELECT ?
         UNION
         SELECT d.depends_on_id FROM task_deps d JOIN reach ON d.task_id = reach.id
       )
       SELECT 1 FROM reach WHERE id = ? LIMIT 1`,
      from,
      to,
    );
    return hit !== null;
  }
}

function notFoundTeam(): AppError {
  return new AppError("not_found", "チームが見つかりません。");
}

function notFoundTask(): AppError {
  return new AppError("not_found", "タスクが見つかりません。");
}
