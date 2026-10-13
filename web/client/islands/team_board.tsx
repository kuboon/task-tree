/**
 * TeamBoard — one team: its tasks drawn as a dependency tree, who does what, and the members.
 *
 * Tasks have no parent/child structure; dependencies (`dependsOn`) are the only one. The tree puts
 * the tasks that can start now at the left, and under each task, indented, the tasks it unblocks —
 * so the further down-right, the further in the future. A task waiting on several others hangs
 * under the one with the longest chain behind it, and appears again under the others as a 再掲
 * row with nothing beneath it. Branches open and close. Every change
 * goes through an operation (`lib/ops.ts`) and then reloads the team's tasks, so `ready` is always
 * the server's answer.
 */

import {
  clientEntry,
  css,
  type Handle,
  on,
  ref,
  type RemixNode,
  type SerializableValue,
} from "@remix-run/component";

import { clientModule } from "../client_entry.ts";
import {
  type Task,
  TASK_STATUSES,
  type TaskStatus,
  type TeamDetail,
} from "../../server/domain/types.ts";
import { callOp, errorMessage } from "../lib/ops.ts";
import {
  badgeStyle,
  growStyle,
  inputStyle,
  listResetStyle,
  mutedStyle,
  rowStyle,
  selectStyle,
  STATUS_LABEL,
  userLabel,
} from "../lib/ui.ts";
import { routes } from "../routes.ts";
import { sessionStore } from "../session.ts";
import {
  actionStyle,
  alertStyle,
  cardStyle,
  dangerStyle,
  primaryStyle,
} from "../theme.ts";
import { color, radius } from "../tokens.ts";

export interface TeamBoardProps {
  teamId: string;
  [key: string]: SerializableValue;
}

/** One row of the tree: a task, under `parentId`, either at home or repeated (`isRef`). */
interface TreeNode {
  task: Task;
  parentId: string | null;
  isRef: boolean;
  children: TreeNode[];
  /** It has dependents to show, whether or not the branch is open. */
  hasChildren: boolean;
}

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  todo: "doing",
  doing: "done",
  done: "todo",
};

export const TeamBoard = clientEntry(
  clientModule("islands/team_board.tsx", "TeamBoard"),
  function TeamBoard(handle: Handle<TeamBoardProps>) {
    let phase: "loading" | "signedout" | "ready" | "error" = "loading";
    let team: TeamDetail | null = null;
    let tasks: Task[] = [];
    let error = "";
    let busy = false;
    let mineOnly = false;
    let showDone = false;
    let selected: string | null = null;
    const collapsed = new Set<string>();
    let inviteUrl = "";
    let inviteInput: HTMLInputElement | undefined;

    const teamId = () => handle.props.teamId;

    const reload = async () => {
      const [t, list] = await Promise.all([
        callOp("get_team", { teamId: teamId() }),
        callOp("list_tasks", { teamId: teamId() }),
      ]);
      team = t;
      // The server cannot know the team's name when it renders the page (the request carries no
      // credentials), so the tab title is set here, once the team is loaded — and after a rename.
      document.title = `${t.name} - Task Tree`;
      tasks = list;
    };

    /** Who the data on screen was loaded for — other session changes need no reload. */
    let loadedFor: string | null | undefined;

    const load = async () => {
      await sessionStore.load();
      if (loadedFor === sessionStore.userId) return;
      loadedFor = sessionStore.userId;
      if (sessionStore.userId === null) {
        phase = "signedout";
        handle.update();
        return;
      }
      try {
        await reload();
        phase = "ready";
      } catch (e) {
        phase = "error";
        error = errorMessage(e);
      }
      handle.update();
    };

    if (typeof document !== "undefined") {
      sessionStore.addEventListener("change", () => void load(), {
        signal: handle.signal,
      });
      void load();
    }

    /** Run a change, then reload; errors land in the alert. */
    const act = async (change: () => Promise<unknown>) => {
      if (busy) return;
      busy = true;
      error = "";
      handle.update();
      try {
        await change();
        await reload();
      } catch (e) {
        error = errorMessage(e);
      } finally {
        busy = false;
        handle.update();
      }
    };

    // --- team actions ---------------------------------------------------------

    const onRename = () => {
      const name = globalThis.prompt("新しいチーム名", team?.name ?? "");
      if (name === null || !name.trim()) return;
      void act(() => callOp("rename_team", { teamId: teamId(), name }));
    };

    const goHome = () => {
      globalThis.location.href = routes.home.href();
    };

    const onDelete = async () => {
      if (
        !globalThis.confirm(
          `「${team?.name}」をタスクごと削除します。元に戻せません。よろしいですか？`,
        )
      ) return;
      try {
        await callOp("delete_team", { teamId: teamId() });
        goHome();
      } catch (e) {
        error = errorMessage(e);
        handle.update();
      }
    };

    const onLeave = async () => {
      if (!globalThis.confirm(`「${team?.name}」から抜けますか？`)) return;
      try {
        await callOp("leave_team", { teamId: teamId() });
        goHome();
      } catch (e) {
        error = errorMessage(e);
        handle.update();
      }
    };

    const onInvite = () =>
      act(async () => {
        inviteUrl = (await callOp("create_invite", { teamId: teamId() })).url;
      });

    const onCopyInvite = async () => {
      inviteInput?.select();
      try {
        await navigator.clipboard.writeText(inviteUrl);
      } catch {
        // Selected already; the user can copy by hand.
      }
    };

    const onTeamNickname = (nickname: string) =>
      void act(() =>
        callOp("set_team_nickname", { teamId: teamId(), nickname })
      );

    const onRemoveMember = (userId: string, label: string) => {
      if (!globalThis.confirm(`${label} をチームから外しますか？`)) return;
      void act(() => callOp("remove_member", { teamId: teamId(), userId }));
    };

    // --- task actions ---------------------------------------------------------

    const createTask = (form: HTMLFormElement) => {
      const data = new FormData(form);
      const title = String(data.get("title") ?? "");
      if (!title.trim()) return;
      void act(async () => {
        await callOp("create_task", { teamId: teamId(), title });
        form.reset();
      });
    };

    const update = (
      taskId: string,
      changes: Omit<
        Parameters<typeof callOp<"update_task">>[1],
        "teamId" | "taskId"
      >,
    ) =>
      void act(() =>
        callOp("update_task", { teamId: teamId(), taskId, ...changes })
      );

    const onDeleteTask = (task: Task) => {
      if (!globalThis.confirm(`「${task.title}」を削除しますか？`)) return;
      if (selected === task.id) selected = null;
      void act(() =>
        callOp("delete_task", { teamId: teamId(), taskId: task.id })
      );
    };

    // --- derived ----------------------------------------------------------------

    const byId = () => new Map(tasks.map((t) => [t.id, t]));

    /** The unfinished tasks `task` still waits on. */
    const openDeps = (task: Task, map: Map<string, Task>): Task[] =>
      task.dependsOn.flatMap((id) => {
        const dep = map.get(id);
        return dep && dep.status !== "done" ? [dep] : [];
      });

    /** The task and everything that waits on it — none of these may become its dependency. */
    const dependentsDeep = (taskId: string): Set<string> => {
      const out = new Set<string>([taskId]);
      const walk = (id: string) => {
        for (const t of tasks) {
          if (t.dependsOn.includes(id) && !out.has(t.id)) {
            out.add(t.id);
            walk(t.id);
          }
        }
      };
      walk(taskId);
      return out;
    };

    /**
     * The unfinished tasks as a tree. The roots are the tasks that can start now; under a task are
     * the tasks waiting on it. A task waiting on several hangs under the one with the longest chain
     * behind it (its home) and is repeated, childless, under the rest.
     */
    const buildTree = (): TreeNode[] => {
      const map = byId();
      const active = tasks.filter((t) => t.status !== "done");

      const depth = new Map<string, number>();
      const depthOf = (task: Task): number => {
        const known = depth.get(task.id);
        if (known !== undefined) return known;
        let d = 0;
        for (const dep of openDeps(task, map)) {
          d = Math.max(d, depthOf(dep) + 1);
        }
        depth.set(task.id, d);
        return d;
      };

      const home = new Map<string, string>();
      const waitingOn = new Map<string, Task[]>();
      for (const t of active) {
        let best: Task | undefined;
        for (const dep of openDeps(t, map)) {
          if (!best || depthOf(dep) >= depthOf(best)) best = dep;
          const list = waitingOn.get(dep.id) ?? [];
          list.push(t);
          waitingOn.set(dep.id, list);
        }
        if (best) home.set(t.id, best.id);
      }

      const node = (
        task: Task,
        parentId: string | null,
        isRef: boolean,
      ): TreeNode => {
        const kids = isRef ? [] : waitingOn.get(task.id) ?? [];
        return {
          task,
          parentId,
          isRef,
          hasChildren: kids.length > 0,
          children: collapsed.has(task.id)
            ? []
            : kids.map((k) => node(k, task.id, home.get(k.id) !== task.id)),
        };
      };
      return active.filter((t) => !home.has(t.id)).map((t) =>
        node(t, null, false)
      );
    };

    /** What the selected task waits on (`up`) and what waits on it (`down`), transitively. */
    const chainOf = (taskId: string) => {
      const map = byId();
      const up = new Set<string>();
      const down = new Set<string>();
      const climb = (task: Task) => {
        for (const dep of openDeps(task, map)) {
          if (!up.has(dep.id)) {
            up.add(dep.id);
            climb(dep);
          }
        }
      };
      const descend = (id: string) => {
        for (const t of tasks) {
          if (t.dependsOn.includes(id) && !down.has(t.id)) {
            down.add(t.id);
            descend(t.id);
          }
        }
      };
      const task = map.get(taskId);
      if (task) climb(task);
      descend(taskId);
      return { up, down };
    };

    // --- rendering ------------------------------------------------------------

    const select = (taskId: string | null) => {
      selected = taskId;
      handle.update();
    };

    const memberOf = (userId: string) =>
      team?.members.find((m) => m.userId === userId);

    const avatar = (userId: string | null) => {
      if (userId === null) {
        return <span mix={avatarStyle} data-empty="true" title="担当なし" />;
      }
      const label = userLabel(memberOf(userId), userId);
      let tone = 0;
      for (const ch of userId) tone = (tone + ch.charCodeAt(0)) % 6;
      return (
        <span mix={avatarStyle} data-tone={String(tone)} title={label}>
          {[...label][0]}
        </span>
      );
    };

    const assigneeSelect = (task: Task) => (
      <select
        key={`assignee:${task.id}:${task.assigneeId ?? ""}`}
        aria-label="担当者"
        disabled={busy}
        mix={[
          selectStyle,
          growStyle,
          on("change", (event) => {
            const value = (event.currentTarget as HTMLSelectElement).value;
            update(task.id, { assigneeId: value || null });
          }),
        ]}
      >
        <option value="" selected={task.assigneeId === null}>担当なし</option>
        {(team?.members ?? []).map((m) => (
          <option
            key={m.userId}
            value={m.userId}
            selected={m.userId === task.assigneeId}
          >
            {userLabel(m)}
          </option>
        ))}
      </select>
    );

    const statusPill = (task: Task) => (
      <button
        type="button"
        disabled={busy}
        data-status={task.status}
        aria-label={`状態: ${STATUS_LABEL[task.status]}（押すと${
          STATUS_LABEL[NEXT_STATUS[task.status]]
        }に）`}
        mix={[
          statusPillStyle,
          on("click", () =>
            update(task.id, { status: NEXT_STATUS[task.status] })),
        ]}
      >
        {STATUS_LABEL[task.status]}
      </button>
    );

    interface RowContext {
      map: Map<string, Task>;
      selected: string | null;
      up: Set<string>;
      down: Set<string>;
    }

    const treeRow = (n: TreeNode, ctx: RowContext): RemixNode => {
      const t = n.task;
      const open = n.hasChildren && !collapsed.has(t.id);
      const sel = ctx.selected;
      const inChain = sel === null || t.id === sel || ctx.up.has(t.id) ||
        ctx.down.has(t.id);
      const p = n.parentId;
      const highlighted = sel !== null && p !== null &&
        ((ctx.up.has(p) && (t.id === sel || ctx.up.has(t.id))) ||
          ((p === sel || ctx.down.has(p)) && ctx.down.has(t.id)));
      const dim = !inChain ||
        (mineOnly && t.assigneeId !== sessionStore.userId);
      const others = openDeps(t, ctx.map).filter((d) => d.id !== p);
      const home = openDeps(t, ctx.map).find((d) => d.id !== p);
      return (
        <li
          key={`${p ?? ""}>${t.id}`}
          data-hi={highlighted ? "true" : undefined}
        >
          <div
            mix={treeRowStyle}
            data-selected={t.id === sel ? "true" : undefined}
            data-dim={dim ? "true" : undefined}
            data-open={open ? "true" : undefined}
          >
            {n.hasChildren
              ? (
                <button
                  type="button"
                  aria-expanded={open ? "true" : "false"}
                  aria-label={`${open ? "畳む" : "開く"}: ${t.title}`}
                  mix={[
                    toggleStyle,
                    on("click", () => {
                      if (collapsed.has(t.id)) collapsed.delete(t.id);
                      else collapsed.add(t.id);
                      handle.update();
                    }),
                  ]}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              )
              : (
                <span
                  mix={leafStyle}
                  data-ref={n.isRef ? "true" : undefined}
                  aria-hidden="true"
                />
              )}
            {statusPill(t)}
            <button
              type="button"
              data-ref={n.isRef ? "true" : undefined}
              aria-pressed={t.id === sel ? "true" : "false"}
              mix={[titleButtonStyle, on("click", () => select(t.id))]}
            >
              {t.title}
            </button>
            {n.isRef && (
              <span
                mix={[badgeStyle, refBadgeStyle]}
                title={home ? `「${home.title}」の下にもあります` : undefined}
              >
                再掲
              </span>
            )}
            {p === null && (
              <span data-kind="ready" mix={[badgeStyle, wideOnlyStyle]}>
                着手可能
              </span>
            )}
            {!n.isRef && p !== null && others.length > 0 && (
              <span
                data-kind="blocked"
                mix={badgeStyle}
                title={others.map((d) => d.title).join("、")}
              >
                ほか {others.length} 件待ち
              </span>
            )}
            {avatar(t.assigneeId)}
          </div>
          {open && (
            <ul mix={childListStyle}>
              {n.children.map((c) => treeRow(c, ctx))}
            </ul>
          )}
        </li>
      );
    };

    const detail = (task: Task): RemixNode => {
      const map = byId();
      const excluded = dependentsDeep(task.id);
      const waiting = openDeps(task, map).length;
      const dependents = tasks.filter((t) => t.dependsOn.includes(task.id));
      const depCandidates = tasks.filter((t) =>
        t.status !== "done" && !excluded.has(t.id) &&
        !task.dependsOn.includes(t.id)
      );
      return (
        <section
          key={`detail:${task.id}`}
          aria-label="タスクの詳細"
          mix={panelStyle}
        >
          <div mix={panelHeadStyle}>
            <h2>{task.title}</h2>
            <button
              type="button"
              aria-label="詳細を閉じる"
              mix={[iconButtonStyle, on("click", () => select(null))]}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <p
            mix={whereStyle}
            data-ready={task.status !== "done" && waiting === 0
              ? "true"
              : undefined}
          >
            {task.status === "done"
              ? "完了"
              : waiting === 0
              ? "着手可能"
              : `あと ${waiting} 件の完了待ち`}
          </p>

          <div role="group" aria-label="状態" mix={segmentStyle}>
            {TASK_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                aria-pressed={s === task.status ? "true" : "false"}
                mix={[
                  actionStyle,
                  segmentButtonStyle,
                  on("click", () => update(task.id, { status: s })),
                ]}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          <div mix={rowStyle}>
            <span mix={mutedStyle}>担当</span>
            {assigneeSelect(task)}
          </div>

          <form
            mix={[
              formStyle,
              on("submit", (event) => {
                event.preventDefault();
                const data = new FormData(
                  event.currentTarget as HTMLFormElement,
                );
                update(task.id, {
                  title: String(data.get("title") ?? ""),
                  description: String(data.get("description") ?? ""),
                });
              }),
            ]}
          >
            <input
              key={`title:${task.id}:${task.title}`}
              name="title"
              type="text"
              required
              maxlength={200}
              defaultValue={task.title}
              aria-label="タイトル"
              mix={inputStyle}
            />
            <textarea
              key={`description:${task.id}:${task.description}`}
              name="description"
              rows={3}
              defaultValue={task.description}
              placeholder="説明"
              aria-label="説明"
              mix={inputStyle}
            />
            <div mix={rowStyle}>
              <button type="submit" disabled={busy} mix={actionStyle}>
                保存
              </button>
            </div>
          </form>

          <h3>先に終わらせるタスク</h3>
          {task.dependsOn.length === 0
            ? <p mix={mutedStyle}>なし</p>
            : (
              <ul mix={[listResetStyle, stackStyle]}>
                {task.dependsOn.map((depId) => {
                  const dep = map.get(depId);
                  return (
                    <li key={depId} mix={depItemStyle}>
                      <button
                        type="button"
                        data-done={dep?.status === "done" ? "true" : undefined}
                        mix={[
                          linkButtonStyle,
                          on("click", () => select(depId)),
                        ]}
                      >
                        {dep?.title ?? depId}
                      </button>
                      <span mix={mutedStyle}>
                        {dep ? STATUS_LABEL[dep.status] : ""}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`「${dep?.title ?? depId}」への依存を外す`}
                        mix={[
                          actionStyle,
                          on("click", () =>
                            void act(() =>
                              callOp("remove_dependency", {
                                teamId: teamId(),
                                taskId: task.id,
                                dependsOnId: depId,
                              })
                            )),
                        ]}
                      >
                        外す
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          {depCandidates.length > 0 && (
            <select
              key={`adddep:${task.id}:${task.dependsOn.join(",")}`}
              disabled={busy}
              aria-label="先に終わらせるタスクを足す"
              mix={[
                selectStyle,
                on("change", (event) => {
                  const value = (event.currentTarget as HTMLSelectElement)
                    .value;
                  if (!value) return;
                  void act(() =>
                    callOp("add_dependency", {
                      teamId: teamId(),
                      taskId: task.id,
                      dependsOnId: value,
                    })
                  );
                }),
              ]}
            >
              <option value="" selected>＋ 先に終わらせるタスクを足す…</option>
              {depCandidates.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          )}

          <h3>これを待っているタスク</h3>
          {dependents.length === 0
            ? <p mix={mutedStyle}>なし</p>
            : (
              <ul mix={[listResetStyle, rowStyle]}>
                {dependents.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      mix={[
                        actionStyle,
                        chipStyle,
                        on("click", () => select(t.id)),
                      ]}
                    >
                      {t.title} →
                    </button>
                  </li>
                ))}
              </ul>
            )}

          <div mix={rowStyle}>
            <button
              type="button"
              disabled={busy}
              mix={[
                actionStyle,
                dangerStyle,
                on("click", () => onDeleteTask(task)),
              ]}
            >
              削除
            </button>
          </div>
        </section>
      );
    };

    const membersCard = (t: TeamDetail) => (
      <section mix={cardStyle}>
        <h2>メンバー</h2>
        <ul mix={listResetStyle}>
          {t.members.map((m) => (
            <li key={m.userId} mix={rowStyle}>
              <span>{userLabel(m)}</span>
              <span mix={mutedStyle}>
                {m.role === "owner" ? "オーナー" : "メンバー"}
                {m.userId === sessionStore.userId ? "（自分）" : ""}
              </span>
              {t.myRole === "owner" && m.userId !== sessionStore.userId && (
                <button
                  type="button"
                  disabled={busy}
                  mix={[
                    actionStyle,
                    dangerStyle,
                    on("click", () => onRemoveMember(m.userId, userLabel(m))),
                  ]}
                >
                  外す
                </button>
              )}
            </li>
          ))}
        </ul>
        {(() => {
          const mine = t.members.find((m) => m.userId === sessionStore.userId);
          if (!mine) return null;
          return (
            <form
              mix={[
                rowStyle,
                formGapStyle,
                on("submit", (event) => {
                  event.preventDefault();
                  const data = new FormData(
                    event.currentTarget as HTMLFormElement,
                  );
                  onTeamNickname(String(data.get("nickname") ?? ""));
                }),
              ]}
            >
              <span mix={mutedStyle}>このチームでの名前</span>
              <input
                key={mine.teamNickname ?? ""}
                name="nickname"
                type="text"
                maxlength={40}
                defaultValue={mine.teamNickname ?? ""}
                placeholder={mine.teamNickname === null
                  ? `${mine.nickname ?? ""}（id.kbn.one のニックネーム）`
                  : ""}
                aria-label="このチームでの名前"
                mix={[inputStyle, growStyle]}
              />
              <button type="submit" disabled={busy} mix={actionStyle}>
                保存
              </button>
              {mine.teamNickname !== null && (
                <button
                  type="button"
                  disabled={busy}
                  mix={[actionStyle, on("click", () => onTeamNickname(""))]}
                >
                  ニックネームに戻す
                </button>
              )}
            </form>
          );
        })()}
        <div mix={rowStyle}>
          <button
            type="button"
            disabled={busy}
            mix={[actionStyle, on("click", () => void onInvite())]}
          >
            招待リンクを作る
          </button>
          {t.myRole === "owner"
            ? (
              <>
                <button
                  type="button"
                  mix={[actionStyle, on("click", onRename)]}
                >
                  名前を変える
                </button>
                <button
                  type="button"
                  mix={[
                    actionStyle,
                    dangerStyle,
                    on("click", () => void onDelete()),
                  ]}
                >
                  チームを削除
                </button>
              </>
            )
            : (
              <button
                type="button"
                mix={[
                  actionStyle,
                  dangerStyle,
                  on("click", () => void onLeave()),
                ]}
              >
                チームから抜ける
              </button>
            )}
        </div>
        {inviteUrl && (
          <div mix={rowStyle}>
            <input
              key={inviteUrl}
              type="text"
              readonly
              defaultValue={inviteUrl}
              aria-label="招待リンク"
              mix={[
                inputStyle,
                growStyle,
                ref((node) => {
                  inviteInput = node as HTMLInputElement;
                }),
              ]}
            />
            <button
              type="button"
              mix={[actionStyle, on("click", () => void onCopyInvite())]}
            >
              コピー
            </button>
            <span mix={mutedStyle}>7 日間有効</span>
          </div>
        )}
      </section>
    );

    return () => {
      if (phase === "loading") return <p mix={mutedStyle}>読み込み中…</p>;
      if (phase === "signedout") {
        return (
          <p>
            このチームを見るには、ナビバー右上の「Sign
            In」からサインインしてください。
          </p>
        );
      }
      if (phase === "error" || !team) {
        return (
          <div role="alert" data-kind="error" mix={alertStyle}>
            {error || "チームを読み込めませんでした。"}
          </div>
        );
      }
      const map = byId();
      const roots = buildTree();
      const done = tasks.filter((t) => t.status === "done");
      const activeCount = tasks.length - done.length;
      const selectedTask = selected === null ? undefined : map.get(selected);
      const { up, down } = selectedTask
        ? chainOf(selectedTask.id)
        : { up: new Set<string>(), down: new Set<string>() };
      const ctx: RowContext = {
        map,
        selected: selectedTask?.id ?? null,
        up,
        down,
      };
      const branches = tasks.filter((t) =>
        t.status !== "done" &&
        tasks.some((o) => o.status !== "done" && o.dependsOn.includes(t.id))
      );
      return (
        <>
          <h1>{team.name}</h1>
          <p mix={statsStyle}>
            <span>メンバー {team.members.length} 人</span>
            <span>未完了 {activeCount} 件</span>
            <span data-kind="ready">着手可能 {roots.length} 件</span>
            <span>完了 {done.length} 件</span>
          </p>
          {error && (
            <div role="alert" data-kind="error" mix={alertStyle}>{error}</div>
          )}
          <div mix={boardStyle}>
            <section aria-label="タスク" mix={treePaneStyle}>
              <form
                mix={[
                  rowStyle,
                  on("submit", (event) => {
                    event.preventDefault();
                    createTask(event.currentTarget as HTMLFormElement);
                  }),
                ]}
              >
                <input
                  name="title"
                  type="text"
                  required
                  maxlength={200}
                  placeholder="新しいタスク"
                  aria-label="新しいタスクのタイトル"
                  mix={[inputStyle, growStyle]}
                />
                <button
                  type="submit"
                  disabled={busy}
                  mix={[actionStyle, primaryStyle]}
                >
                  追加
                </button>
              </form>
              <div mix={rowStyle}>
                <button
                  type="button"
                  aria-pressed={mineOnly ? "true" : "false"}
                  mix={[
                    actionStyle,
                    segmentButtonStyle,
                    on("click", () => {
                      mineOnly = !mineOnly;
                      handle.update();
                    }),
                  ]}
                >
                  自分の担当を強調
                </button>
                {branches.length > 0 && (
                  <button
                    type="button"
                    mix={[
                      actionStyle,
                      on("click", () => {
                        if (collapsed.size > 0) collapsed.clear();
                        else for (const t of branches) collapsed.add(t.id);
                        handle.update();
                      }),
                    ]}
                  >
                    {collapsed.size > 0 ? "すべて開く" : "すべて畳む"}
                  </button>
                )}
              </div>
              <div mix={treeBoxStyle}>
                {roots.length === 0
                  ? <p mix={mutedStyle}>未完了のタスクはありません。</p>
                  : (
                    <ul mix={listResetStyle}>
                      {roots.map((n) => treeRow(n, ctx))}
                    </ul>
                  )}
              </div>
              <div mix={rowStyle}>
                <span mix={[mutedStyle, growStyle]}>
                  左端が今すぐ着手できるタスク。その下に、終わると着手できるようになるタスクが続きます。
                </span>
                {done.length > 0 && (
                  <button
                    type="button"
                    aria-expanded={showDone ? "true" : "false"}
                    mix={[
                      actionStyle,
                      on("click", () => {
                        showDone = !showDone;
                        handle.update();
                      }),
                    ]}
                  >
                    {showDone ? "完了を隠す" : `完了 ${done.length} 件を表示`}
                  </button>
                )}
              </div>
              {showDone && done.length > 0 && (
                <ul
                  aria-label="完了したタスク"
                  mix={[listResetStyle, rowStyle]}
                >
                  {done.map((t) => (
                    <li key={t.id} mix={doneItemStyle}>
                      <button
                        type="button"
                        data-done="true"
                        mix={[linkButtonStyle, on("click", () => select(t.id))]}
                      >
                        {t.title}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        mix={[
                          actionStyle,
                          on("click", () => update(t.id, { status: "todo" })),
                        ]}
                      >
                        戻す
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <aside mix={sidePaneStyle}>
              {selectedTask
                ? detail(selectedTask)
                : (
                  <p mix={[mutedStyle, hintStyle]}>
                    タスクを選ぶと、ここに詳細と依存関係が出ます。
                  </p>
                )}
              {membersCard(team)}
            </aside>
          </div>
        </>
      );
    };
  },
);

/** Tree guide lines: quiet, and the same in light and dark. */
const LINE = `color-mix(in srgb, ${color.muted} 45%, transparent)`;

/** Below this the rows get compact: a dot for the status, no 着手可能 badge, a tighter indent. */
const NARROW = "@media (max-width: 40rem)";

const statsStyle = css({
  display: "flex",
  flexWrap: "wrap",
  gap: "0.25rem 1rem",
  marginTop: "-0.75rem",
  color: color.muted,
  fontSize: "0.9rem",
  '& [data-kind="ready"]': { color: "#16a34a", fontWeight: 600 },
});

const boardStyle = css({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "flex-start",
  gap: "1.25rem",
});

const treePaneStyle = css({
  flex: "999 1 28rem",
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr)",
  gap: "0.75rem",
});

const sidePaneStyle = css({
  flex: "1 1 18rem",
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr)",
  gap: "1rem",
  "& > section": { marginBlock: 0 },
});

const treeBoxStyle = css({
  padding: "0.4rem 0.6rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.lg,
  background: color.bg,
  overflowX: "auto",
});

/** The rows under a task: indented, each joined to its parent by an elbow. */
const childListStyle = css({
  listStyle: "none",
  margin: 0,
  paddingInlineStart: "1.75rem",
  "& > li": { position: "relative" },
  "& > li::before": {
    content: '""',
    position: "absolute",
    insetInlineStart: "-1rem",
    top: 0,
    height: "1.4rem",
    width: "0.85rem",
    borderInlineStart: `1.5px solid ${LINE}`,
    borderBottom: `1.5px solid ${LINE}`,
    borderEndStartRadius: "6px",
  },
  "& > li:not(:last-child)::after": {
    content: '""',
    position: "absolute",
    insetInlineStart: "-1rem",
    top: 0,
    bottom: 0,
    borderInlineStart: `1.5px solid ${LINE}`,
  },
  '& > li[data-hi="true"]::before': { borderColor: color.accent },
  [NARROW]: {
    paddingInlineStart: "1.25rem",
    "& > li::before": { insetInlineStart: "-0.5rem", width: "0.4rem" },
    "& > li:not(:last-child)::after": { insetInlineStart: "-0.5rem" },
  },
});

const treeRowStyle = css({
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  minHeight: "2.8rem",
  paddingInlineEnd: "0.25rem",
  borderRadius: radius.sm,
  '&[data-selected="true"]': {
    background: `color-mix(in srgb, ${color.accent} 12%, transparent)`,
  },
  '&[data-dim="true"]': { opacity: 0.45 },
  // From an open toggle down to the first child's elbow.
  '&[data-open="true"]::after': {
    content: '""',
    position: "absolute",
    insetInlineStart: "0.75rem",
    top: "calc(50% + 0.75rem)",
    bottom: 0,
    borderInlineStart: `1.5px solid ${LINE}`,
  },
});

const toggleStyle = css({
  flex: "none",
  width: "1.5rem",
  height: "1.5rem",
  padding: 0,
  display: "grid",
  placeItems: "center",
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
  background: color.bg,
  color: color.fg,
  cursor: "pointer",
  "& svg": { transition: "transform 120ms ease" },
  '&[aria-expanded="true"] svg': { transform: "rotate(90deg)" },
});

const leafStyle = css({
  flex: "none",
  width: "1.5rem",
  height: "1.5rem",
  display: "grid",
  placeItems: "center",
  "&::after": {
    content: '""',
    width: "0.4rem",
    height: "0.4rem",
    borderRadius: "999px",
    background: color.muted,
  },
  '&[data-ref="true"]::after': { opacity: 0.5 },
});

const statusPillStyle = css({
  flex: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.3rem",
  minWidth: "4.4rem",
  padding: "0.1rem 0.6rem",
  font: "inherit",
  fontSize: "0.78rem",
  border: `1px solid ${color.border}`,
  borderRadius: "999px",
  background: color.bg,
  color: color.fg,
  cursor: "pointer",
  "&::before": {
    content: '""',
    width: "0.4rem",
    height: "0.4rem",
    borderRadius: "999px",
    background: color.muted,
  },
  '&[data-status="doing"]': { borderColor: color.accent, color: color.accent },
  '&[data-status="doing"]::before': { background: color.accent },
  '&[data-status="done"]': { borderColor: "#16a34a", color: "#16a34a" },
  '&[data-status="done"]::before': { background: "#16a34a" },
  "&:disabled": { opacity: 0.5, cursor: "not-allowed" },
  // Just the dot: the label stays as the accessible name.
  [NARROW]: {
    minWidth: 0,
    width: "1.5rem",
    height: "1.5rem",
    padding: 0,
    fontSize: 0,
    "&::before": { width: "0.55rem", height: "0.55rem" },
  },
});

const titleButtonStyle = css({
  flex: "1 1 auto",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  font: "inherit",
  fontWeight: 500,
  textAlign: "start",
  padding: "0.2rem 0",
  border: 0,
  background: "transparent",
  color: color.fg,
  cursor: "pointer",
  "&:hover": { color: color.accent },
  '&[data-ref="true"]': { color: color.muted, fontWeight: 400 },
});

const refBadgeStyle = css({ borderStyle: "dashed" });

const wideOnlyStyle = css({ [NARROW]: { display: "none" } });

const AVATAR_TONES = [
  ["#dbeafe", "#1e40af"],
  ["#fce7f3", "#9d174d"],
  ["#dcfce7", "#166534"],
  ["#fef3c7", "#92400e"],
  ["#ede9fe", "#5b21b6"],
  ["#ffedd5", "#9a3412"],
] as const;

const avatarStyle = css({
  flex: "none",
  width: "1.6rem",
  height: "1.6rem",
  display: "grid",
  placeItems: "center",
  borderRadius: "999px",
  fontSize: "0.72rem",
  fontWeight: 700,
  ...Object.fromEntries(
    AVATAR_TONES.map(([bg, fg], i) => [
      `&[data-tone="${i}"]`,
      { background: bg, color: fg },
    ]),
  ),
  '&[data-empty="true"]': { border: `1px dashed ${color.border}` },
});

const panelStyle = css({
  display: "grid",
  gap: "0.75rem",
  padding: "1.1rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.lg,
  background: color.card,
  "& h2": { margin: 0, fontSize: "1.15rem", lineHeight: 1.4 },
  "& h3": { margin: "0.25rem 0 0", fontSize: "0.85rem" },
  "& p": { margin: 0 },
});

const panelHeadStyle = css({
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "0.5rem",
});

const iconButtonStyle = css({
  flex: "none",
  width: "2rem",
  height: "2rem",
  display: "grid",
  placeItems: "center",
  padding: 0,
  border: 0,
  borderRadius: radius.md,
  background: "transparent",
  color: color.muted,
  cursor: "pointer",
  "&:hover": { color: color.fg },
});

const whereStyle = css({
  fontSize: "0.85rem",
  color: color.muted,
  '&[data-ready="true"]': { color: "#16a34a", fontWeight: 600 },
});

const segmentStyle = css({
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: "0.4rem",
});

const segmentButtonStyle = css({
  '&[aria-pressed="true"]': {
    borderColor: color.accent,
    color: color.accent,
    fontWeight: 600,
    background: `color-mix(in srgb, ${color.accent} 10%, transparent)`,
  },
});

const formStyle = css({ display: "grid", gap: "0.5rem" });

const stackStyle = css({ display: "grid", gap: "0.4rem" });

const depItemStyle = css({
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0.2rem 0.3rem 0.2rem 0.6rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  background: color.bg,
  "& > :not(:first-child)": { flex: "none", whiteSpace: "nowrap" },
});

const linkButtonStyle = css({
  flex: "1 1 auto",
  minWidth: 0,
  padding: 0,
  font: "inherit",
  textAlign: "start",
  border: 0,
  background: "transparent",
  color: color.fg,
  cursor: "pointer",
  "&:hover": { color: color.accent },
  '&[data-done="true"]': { color: color.muted, textDecoration: "line-through" },
});

const chipStyle = css({ borderRadius: "999px", fontSize: "0.85rem" });

const doneItemStyle = css({
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0.2rem 0.3rem 0.2rem 0.6rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
});

const hintStyle = css({
  margin: 0,
  padding: "1rem",
  border: `1px dashed ${color.border}`,
  borderRadius: radius.lg,
});

const formGapStyle = css({ marginBlock: "0.75rem" });
