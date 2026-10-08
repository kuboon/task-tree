/**
 * TeamsHome — the signed-in home: the teams you are in, and a form to start one.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/component";

import { clientModule } from "../client_entry.ts";
import type { TeamSummary } from "../../server/domain/types.ts";
import { callOp, errorMessage } from "../lib/ops.ts";
import {
  growStyle,
  inputStyle,
  listResetStyle,
  mutedStyle,
  rowStyle,
} from "../lib/ui.ts";
import { routes } from "../routes.ts";
import { sessionStore } from "../session.ts";
import { actionStyle, alertStyle, cardStyle, primaryStyle } from "../theme.ts";

export interface TeamsHomeProps {
  [key: string]: SerializableValue;
}

type Phase = "loading" | "signedout" | "ready" | "error";

export const TeamsHome = clientEntry(
  clientModule("islands/teams_home.tsx", "TeamsHome"),
  function TeamsHome(handle: Handle<TeamsHomeProps>) {
    let phase: Phase = "loading";
    let teams: TeamSummary[] = [];
    let error = "";
    let busy = false;

    const load = async () => {
      await sessionStore.load();
      if (sessionStore.userId === null) {
        phase = "signedout";
        handle.update();
        return;
      }
      try {
        teams = await callOp("list_teams", {});
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

    const onCreate = async (form: HTMLFormElement) => {
      const name = String(new FormData(form).get("name") ?? "");
      if (!name.trim() || busy) return;
      busy = true;
      error = "";
      handle.update();
      try {
        const team = await callOp("create_team", { name });
        globalThis.location.href = routes.team.href({ teamId: team.id });
      } catch (e) {
        error = errorMessage(e);
        busy = false;
        handle.update();
      }
    };

    return () => (
      <section mix={cardStyle}>
        <h2>チーム</h2>
        {phase === "loading" && <p mix={mutedStyle}>読み込み中…</p>}
        {phase === "signedout" && (
          <p>
            ナビバー右上の「Sign In」から id.kbn.one でサインインしてください。
          </p>
        )}
        {error && (
          <div role="alert" data-kind="error" mix={alertStyle}>{error}</div>
        )}
        {phase === "ready" && (
          <>
            {teams.length === 0
              ? <p mix={mutedStyle}>まだチームがありません。</p>
              : (
                <ul mix={listResetStyle}>
                  {teams.map((team) => (
                    <li key={team.id} mix={rowStyle}>
                      <a href={routes.team.href({ teamId: team.id })}>
                        {team.name}
                      </a>
                      <span mix={mutedStyle}>
                        {team.role === "owner" ? "オーナー" : "メンバー"} ・
                        {" "}
                        {team.memberCount} 人
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            <form
              mix={[
                rowStyle,
                on("submit", (event) => {
                  event.preventDefault();
                  void onCreate(event.currentTarget as HTMLFormElement);
                }),
              ]}
            >
              <input
                name="name"
                type="text"
                required
                maxlength={100}
                placeholder="新しいチーム名"
                aria-label="新しいチーム名"
                mix={[inputStyle, growStyle]}
              />
              <button
                type="submit"
                disabled={busy}
                mix={[actionStyle, primaryStyle]}
              >
                チームを作る
              </button>
            </form>
          </>
        )}
      </section>
    );
  },
);
