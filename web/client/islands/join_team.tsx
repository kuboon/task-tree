/**
 * JoinTeam — the page an invite link opens: which team, and a button to join it.
 *
 * Signed out, it asks for sign-in first; the nav's sign-in returns to this same URL.
 */

import {
  clientEntry,
  css,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/component";

import { clientModule } from "../client_entry.ts";
import type { InvitePreview } from "../../server/domain/types.ts";
import { callOp, errorMessage } from "../lib/ops.ts";
import { inputStyle, mutedStyle } from "../lib/ui.ts";
import { routes } from "../routes.ts";
import { sessionStore } from "../session.ts";
import { actionStyle, alertStyle, cardStyle, primaryStyle } from "../theme.ts";

export interface JoinTeamProps {
  token: string;
  [key: string]: SerializableValue;
}

export const JoinTeam = clientEntry(
  clientModule("islands/join_team.tsx", "JoinTeam"),
  function JoinTeam(handle: Handle<JoinTeamProps>) {
    let phase: "loading" | "signedout" | "ready" | "error" = "loading";
    let invite: InvitePreview | null = null;
    let error = "";
    let busy = false;

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
        invite = await callOp("get_invite", { token: handle.props.token });
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

    const onJoin = async (form: HTMLFormElement) => {
      if (busy) return;
      busy = true;
      error = "";
      handle.update();
      try {
        const { teamId } = await callOp("accept_invite", {
          token: handle.props.token,
          nickname: String(new FormData(form).get("nickname") ?? ""),
        });
        globalThis.location.href = routes.team.href({ teamId });
      } catch (e) {
        error = errorMessage(e);
        busy = false;
        handle.update();
      }
    };

    return () => (
      <section mix={cardStyle}>
        <h2>チームへの招待</h2>
        {phase === "loading" && <p mix={mutedStyle}>読み込み中…</p>}
        {phase === "signedout" && (
          <p>
            参加するには、ナビバー右上の「Sign In」から id.kbn.one
            でサインインしてください。サインイン後にこのページへ戻ります。
          </p>
        )}
        {error && (
          <div role="alert" data-kind="error" mix={alertStyle}>{error}</div>
        )}
        {phase === "ready" && invite && (
          invite.alreadyMember
            ? (
              <p>
                「{invite.teamName}」にはもう参加しています。{" "}
                <a href={routes.team.href({ teamId: invite.teamId })}>
                  チームを開く →
                </a>
              </p>
            )
            : (
              <form
                mix={[
                  formStyle,
                  on("submit", (event) => {
                    event.preventDefault();
                    void onJoin(event.currentTarget as HTMLFormElement);
                  }),
                ]}
              >
                <p>「{invite.teamName}」に参加しますか？</p>
                <label mix={formStyle}>
                  <span mix={mutedStyle}>このチームでの名前</span>
                  <input
                    name="nickname"
                    type="text"
                    maxlength={40}
                    placeholder={sessionStore.nickname ?? "名前"}
                    mix={inputStyle}
                  />
                </label>
                <p mix={mutedStyle}>
                  空欄なら id.kbn.one のニックネーム
                  {sessionStore.nickname ? `「${sessionStore.nickname}」` : ""}
                  で参加します。あとからチームのメンバー欄で変えられます。
                </p>
                <div>
                  <button
                    type="submit"
                    disabled={busy}
                    mix={[actionStyle, primaryStyle]}
                  >
                    参加する
                  </button>
                </div>
              </form>
            )
        )}
      </section>
    );
  },
);

const formStyle = css({ display: "grid", gap: "0.5rem" });
