/**
 * Every operation the app offers, defined once.
 *
 * Each entry is a name, a description, an input schema (zod) and a function over the per-request
 * `Service`. Two front doors serve this same table:
 *
 * - the browser, as `POST /api/ops/:name` (`controllers/ops.ts`), and
 * - MCP clients, as one tool per entry (`controllers/mcp.ts`).
 *
 * So anything a person can do in the browser, an agent can do over MCP, by construction. The
 * browser's caller (`client/lib/ops.ts`) takes its types from here too.
 */

import * as z from "zod";

import type { Service } from "./domain/service.ts";
import { TASK_STATUSES } from "./domain/types.ts";
import { sendRpNotification } from "./lib/push/client.ts";

export interface OpContext {
  service: Service;
  /** This app's public origin, for links an operation hands back. */
  origin: string;
}

export interface OpDef<I extends z.ZodObject, O> {
  description: string;
  input: I;
  /** Changes nothing (MCP `readOnlyHint`). */
  readOnly?: boolean;
  /** May delete or remove something (MCP `destructiveHint`). */
  destructive?: boolean;
  run(ctx: OpContext, input: z.output<I>): Promise<O>;
}

const op = <I extends z.ZodObject, O>(def: OpDef<I, O>): OpDef<I, O> => def;

const id = z.string().min(1).max(64);
const teamId = id.describe("チーム ID");
const taskId = id.describe("タスク ID");
const status = z.enum(TASK_STATUSES).describe(
  "todo（未着手） / doing（進行中） / done（完了）",
);
const title = z.string().min(1).max(200);

export const ops = {
  whoami: op({
    description:
      "サインイン中の自分（id.kbn.one の userId とニックネーム）を返す。",
    input: z.object({}),
    readOnly: true,
    run: ({ service }) => service.me(),
  }),

  // --- teams ----------------------------------------------------------------

  list_teams: op({
    description: "自分が所属するチームの一覧。",
    input: z.object({}),
    readOnly: true,
    run: ({ service }) => service.listTeams(),
  }),
  create_team: op({
    description: "チームを作る。作った人がオーナーになる。",
    input: z.object({ name: z.string().min(1).max(100) }),
    run: ({ service }, { name }) => service.createTeam(name),
  }),
  get_team: op({
    description: "チームの詳細とメンバー一覧（userId・ニックネーム・役割）。",
    input: z.object({ teamId }),
    readOnly: true,
    run: ({ service }, i) => service.getTeam(i.teamId),
  }),
  rename_team: op({
    description: "チーム名を変える（オーナーのみ）。",
    input: z.object({ teamId, name: z.string().min(1).max(100) }),
    run: ({ service }, i) => service.renameTeam(i.teamId, i.name),
  }),
  delete_team: op({
    description:
      "チームを、タスク・メンバー・招待ごと削除する（オーナーのみ）。",
    input: z.object({ teamId }),
    destructive: true,
    run: ({ service }, i) => service.deleteTeam(i.teamId),
  }),
  leave_team: op({
    description:
      "チームから抜ける。担当していたタスクは担当者なしになる。オーナーは抜けられない。",
    input: z.object({ teamId }),
    destructive: true,
    run: ({ service }, i) => service.leaveTeam(i.teamId),
  }),
  remove_member: op({
    description:
      "メンバーをチームから外す（オーナーのみ）。その人の担当は外れる。",
    input: z.object({ teamId, userId: id }),
    destructive: true,
    run: ({ service }, i) => service.removeMember(i.teamId, i.userId),
  }),

  // --- invites --------------------------------------------------------------

  create_invite: op({
    description: "チームへの招待リンクを作る（7 日間有効、何人でも使える）。",
    input: z.object({ teamId }),
    run: async ({ service, origin }, i) => {
      const invite = await service.createInvite(i.teamId);
      return { ...invite, url: `${origin}/join/${invite.token}` };
    },
  }),
  get_invite: op({
    description: "招待トークンの中身（チーム名・期限・参加済みか）。",
    input: z.object({ token: z.string().min(1).max(64) }),
    readOnly: true,
    run: ({ service }, i) => service.getInvite(i.token),
  }),
  accept_invite: op({
    description: "招待トークンでチームに参加する。",
    input: z.object({ token: z.string().min(1).max(64) }),
    run: ({ service }, i) => service.acceptInvite(i.token),
  }),

  // --- tasks ----------------------------------------------------------------

  list_tasks: op({
    description:
      "チームのタスク一覧。各タスクに parentId（親子）、dependsOn（先に終わるべきタスク）、ready（未完了で依存が全部完了）が付く。",
    input: z.object({
      teamId,
      status: status.optional(),
      assigneeId: id.nullable().optional().describe(
        "担当者で絞る。null で担当者なし",
      ),
      readyOnly: z.boolean().optional().describe("着手可能なタスクだけ"),
    }),
    readOnly: true,
    run: ({ service }, { teamId, ...filter }) =>
      service.listTasks(teamId, filter),
  }),
  get_task: op({
    description:
      "タスクの詳細。子タスク（childIds）と、このタスクに依存するタスク（dependentIds）も返す。",
    input: z.object({ teamId, taskId }),
    readOnly: true,
    run: ({ service }, i) => service.getTask(i.teamId, i.taskId),
  }),
  create_task: op({
    description:
      "タスクを作る。parentId で親タスクの下に、dependsOn で先行タスクを指定できる。",
    input: z.object({
      teamId,
      title,
      description: z.string().max(10_000).optional(),
      status: status.optional(),
      assigneeId: id.nullable().optional().describe("担当者の userId"),
      parentId: id.nullable().optional(),
      dependsOn: z.array(id).max(100).optional(),
    }),
    run: ({ service }, { teamId, ...input }) =>
      service.createTask(teamId, input),
  }),
  update_task: op({
    description:
      "タスクを更新する。指定した項目だけ変わる。assigneeId / parentId は null で外せる。",
    input: z.object({
      teamId,
      taskId,
      title: title.optional(),
      description: z.string().max(10_000).optional(),
      status: status.optional(),
      assigneeId: id.nullable().optional(),
      parentId: id.nullable().optional(),
    }),
    run: ({ service }, { teamId, taskId, ...input }) =>
      service.updateTask(teamId, taskId, input),
  }),
  delete_task: op({
    description: "タスクを削除する。子タスクは削除したタスクの親に付け替わる。",
    input: z.object({ teamId, taskId }),
    destructive: true,
    run: ({ service }, i) => service.deleteTask(i.teamId, i.taskId),
  }),
  add_dependency: op({
    description:
      "依存を足す: taskId は dependsOnId が完了するまで着手できない。循環する依存は拒否される。",
    input: z.object({ teamId, taskId, dependsOnId: id }),
    run: ({ service }, i) =>
      service.addDependency(i.teamId, i.taskId, i.dependsOnId),
  }),
  remove_dependency: op({
    description: "依存を外す。",
    input: z.object({ teamId, taskId, dependsOnId: id }),
    destructive: true,
    run: ({ service }, i) =>
      service.removeDependency(i.teamId, i.taskId, i.dependsOnId),
  }),

  // --- notifications --------------------------------------------------------

  send_test_notification: op({
    description:
      "自分の登録済みデバイスにテスト通知を送る（id.kbn.one 経由）。",
    input: z.object({
      badgeCount: z.number().int().min(0).optional().describe(
        "アプリアイコンのバッジ数",
      ),
    }),
    run: async ({ service, origin }, { badgeCount }) => {
      const results = await sendRpNotification({
        userIds: [service.userId],
        notification: {
          title: "Task Tree からのテスト通知",
          body: badgeCount !== undefined
            ? `バッジ数 ${badgeCount} を送信しました。`
            : "サーバーから id.kbn.one 経由で送信しました。",
          url: `${origin}/my`,
          ...(badgeCount !== undefined ? { badgeCount } : {}),
        },
      });
      return { results };
    },
  }),
};

export type Ops = typeof ops;
export type OpName = keyof Ops;
export type OpInput<K extends OpName> = z.input<Ops[K]["input"]>;
export type OpOutput<K extends OpName> = Awaited<ReturnType<Ops[K]["run"]>>;

export function isOpName(name: string): name is OpName {
  return Object.hasOwn(ops, name);
}

/** Validate the input and run one operation. */
export async function runOp(
  ctx: OpContext,
  name: OpName,
  rawInput: unknown,
): Promise<unknown> {
  const def = ops[name] as OpDef<z.ZodObject, unknown>;
  return await def.run(ctx, def.input.parse(rawInput ?? {}));
}
