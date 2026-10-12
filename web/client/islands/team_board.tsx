/**
 * TeamBoard — one team: its tasks, their dependencies, who does what, and the members.
 *
 * Tasks have no parent/child structure; dependencies (`dependsOn`) are the only one. The list is
 * grouped by stage: 着手可能 first, then tasks one dependency further out, and so on. Every change
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

type Filter = "all" | "ready" | "mine";

const FILTER_LABEL: Record<Filter, string> = {
  all: "すべて",
  ready: "着手可能",
  mine: "自分の担当",
};

export const TeamBoard = clientEntry(
  clientModule("islands/team_board.tsx", "TeamBoard"),
  function TeamBoard(handle: Handle<TeamBoardProps>) {
    let phase: "loading" | "signedout" | "ready" | "error" = "loading";
    let team: TeamDetail | null = null;
    let tasks: Task[] = [];
    let error = "";
    let busy = false;
    let filter: Filter = "all";
    let showDone = false;
    let expanded: string | null = null;
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
      if (expanded === task.id) expanded = null;
      void act(() =>
        callOp("delete_task", { teamId: teamId(), taskId: task.id })
      );
    };

    // --- derived ----------------------------------------------------------------

    const byId = () => new Map(tasks.map((t) => [t.id, t]));

    /**
     * How many dependency steps a task is from being startable: 0 for 着手可能, otherwise one more
     * than the furthest unfinished task it waits on. Done tasks have no stage.
     */
    const stages = (): Map<string, number> => {
      const map = byId();
      const out = new Map<string, number>();
      const stageOf = (task: Task): number => {
        const known = out.get(task.id);
        if (known !== undefined) return known;
        let stage = 0;
        for (const depId of task.dependsOn) {
          const dep = map.get(depId);
          if (dep && dep.status !== "done") {
            stage = Math.max(stage, stageOf(dep) + 1);
          }
        }
        out.set(task.id, stage);
        return stage;
      };
      for (const t of tasks) if (t.status !== "done") stageOf(t);
      return out;
    };

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

    const visible = (t: Task): boolean => {
      if (!showDone && t.status === "done") return false;
      if (filter === "ready") return t.ready;
      if (filter === "mine") return t.assigneeId === sessionStore.userId;
      return true;
    };

    // --- rendering ------------------------------------------------------------

    const statusSelect = (task: Task) => (
      <select
        key={`status:${task.id}:${task.status}`}
        aria-label="状態"
        disabled={busy}
        mix={[
          selectStyle,
          on("change", (event) =>
            update(task.id, {
              status: (event.currentTarget as HTMLSelectElement)
                .value as TaskStatus,
            })),
        ]}
      >
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s} selected={s === task.status}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
    );

    const assigneeSelect = (task: Task) => (
      <select
        key={`assignee:${task.id}:${task.assigneeId ?? ""}`}
        aria-label="担当者"
        disabled={busy}
        mix={[
          selectStyle,
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

    const readiness = (task: Task) => {
      if (task.status === "done") return null;
      if (task.ready) {
        return <span data-kind="ready" mix={badgeStyle}>着手可能</span>;
      }
      const map = byId();
      const waiting = task.dependsOn.filter((d) =>
        map.get(d)?.status !== "done"
      );
      return (
        <span
          data-kind="blocked"
          mix={badgeStyle}
          title={waiting.map((d) => map.get(d)?.title ?? d).join(", ")}
        >
          待ち {waiting.length}
        </span>
      );
    };

    const detail = (task: Task): RemixNode => {
      const map = byId();
      const excluded = dependentsDeep(task.id);
      const dependents = tasks.filter((t) => t.dependsOn.includes(task.id));
      const depCandidates = tasks.filter((t) =>
        !excluded.has(t.id) && !task.dependsOn.includes(t.id)
      );
      return (
        <div key={`detail:${task.id}`} mix={detailStyle}>
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
              name="title"
              type="text"
              required
              maxlength={200}
              defaultValue={task.title}
              aria-label="タイトル"
              mix={inputStyle}
            />
            <textarea
              name="description"
              rows={3}
              defaultValue={task.description}
              placeholder="説明"
              aria-label="説明"
              mix={inputStyle}
            />
            <div mix={rowStyle}>
              <button
                type="submit"
                disabled={busy}
                mix={[actionStyle, primaryStyle]}
              >
                保存
              </button>
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
          </form>

          <div>
            <span mix={mutedStyle}>先に終わらせるタスク（依存）</span>
            <ul mix={listResetStyle}>
              {task.dependsOn.map((depId) => {
                const dep = map.get(depId);
                return (
                  <li key={depId} mix={rowStyle}>
                    <span>{dep?.title ?? depId}</span>
                    <span mix={mutedStyle}>
                      {dep ? STATUS_LABEL[dep.status] : ""}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label="依存を外す"
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
            {depCandidates.length > 0 && (
              <select
                key={`adddep:${task.id}:${task.dependsOn.join(",")}`}
                disabled={busy}
                aria-label="依存を足す"
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
                <option value="" selected>＋ 依存を足す…</option>
                {depCandidates.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            )}
          </div>

          {dependents.length > 0 && (
            <p mix={mutedStyle}>
              これを待っているタスク:{" "}
              {dependents.map((t) => t.title).join("、")}
            </p>
          )}
        </div>
      );
    };

    const taskItem = (task: Task) => {
      const open = expanded === task.id;
      return (
        <li key={task.id} mix={itemStyle}>
          <div mix={[rowStyle, taskRowStyle]} data-status={task.status}>
            {statusSelect(task)}
            <button
              type="button"
              aria-expanded={open ? "true" : "false"}
              mix={[
                titleButtonStyle,
                on("click", () => {
                  expanded = open ? null : task.id;
                  handle.update();
                }),
              ]}
            >
              {task.title}
            </button>
            {readiness(task)}
            {assigneeSelect(task)}
          </div>
          {open && detail(task)}
        </li>
      );
    };

    const taskList = () => {
      const shown = tasks.filter(visible);
      if (shown.length === 0) {
        return <p mix={mutedStyle}>表示するタスクがありません。</p>;
      }
      const stage = stages();
      // Groups in order: stage 0 (着手可能), 1, 2, … and the done tasks last.
      const groups = new Map<number, Task[]>();
      for (const t of shown) {
        const key = stage.get(t.id) ?? Number.POSITIVE_INFINITY;
        const list = groups.get(key) ?? [];
        list.push(t);
        groups.set(key, list);
      }
      return [...groups].sort(([a], [b]) => a - b).map(([key, list]) => (
        <section key={String(key)} mix={stageStyle}>
          <h3 mix={stageHeadingStyle}>
            {key === 0
              ? "着手可能"
              : Number.isFinite(key)
              ? `${key} 段先`
              : "完了"}
            <span mix={mutedStyle}>{list.length} 件</span>
          </h3>
          <ul mix={listResetStyle}>
            {list.map((t) =>
              taskItem(t)
            )}
          </ul>
        </section>
      ));
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
      const doneCount = tasks.filter((t) => t.status === "done").length;
      return (
        <>
          <h1>{team.name}</h1>
          {error && (
            <div role="alert" data-kind="error" mix={alertStyle}>{error}</div>
          )}
          <section mix={cardStyle}>
            <h2>タスク</h2>
            <div mix={rowStyle}>
              {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f ? "true" : "false"}
                  mix={[
                    actionStyle,
                    filter === f ? primaryStyle : null,
                    on("click", () => {
                      filter = f;
                      handle.update();
                    }),
                  ]}
                >
                  {FILTER_LABEL[f]}
                </button>
              ))}
              <label mix={rowStyle}>
                <input
                  type="checkbox"
                  defaultChecked={showDone}
                  mix={on("change", (event) => {
                    showDone =
                      (event.currentTarget as HTMLInputElement).checked;
                    handle.update();
                  })}
                />
                <span mix={mutedStyle}>完了も表示（{doneCount}）</span>
              </label>
            </div>
            <form
              mix={[
                rowStyle,
                formGapStyle,
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
            {taskList()}
          </section>
          {membersCard(team)}
        </>
      );
    };
  },
);

const itemStyle = css({ marginBlock: "0.35rem" });

const stageStyle = css({ marginBlockStart: "1rem" });

const stageHeadingStyle = css({
  display: "flex",
  alignItems: "baseline",
  gap: "0.5rem",
  margin: "0 0 0.25rem",
  fontSize: "0.95rem",
});

const taskRowStyle = css({
  '&[data-status="done"] button': {
    textDecoration: "line-through",
    color: color.muted,
  },
});

const titleButtonStyle = css({
  font: "inherit",
  textAlign: "start",
  flex: "1 1 10rem",
  padding: "0.2rem 0",
  border: 0,
  background: "transparent",
  color: color.fg,
  cursor: "pointer",
  "&:hover": { color: color.accent },
});

const detailStyle = css({
  display: "grid",
  gap: "0.75rem",
  margin: "0.5rem 0 0.75rem",
  padding: "0.9rem 1rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  background: color.bg,
});

const formStyle = css({ display: "grid", gap: "0.5rem" });

const formGapStyle = css({ marginBlock: "0.75rem" });
