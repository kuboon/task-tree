/**
 * SignOut — the sign-out button on `/my`, shown only while someone is signed in.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/component";

import { clientModule } from "../client_entry.ts";
import { sessionStore } from "../session.ts";
import { actionStyle, alertStyle, dangerStyle } from "../theme.ts";

export interface SignOutProps {
  [key: string]: SerializableValue;
}

export const SignOut = clientEntry(
  clientModule("islands/sign_out.tsx", "SignOut"),
  function SignOut(handle: Handle<SignOutProps>) {
    let busy = false;
    let error = "";

    if (typeof document !== "undefined") {
      sessionStore.addEventListener("change", () => handle.update(), {
        signal: handle.signal,
      });
      void sessionStore.load();
    }

    const onClick = async () => {
      busy = true;
      error = "";
      handle.update();
      try {
        await sessionStore.signOut();
      } catch (e) {
        error = `サインアウトに失敗しました: ${(e as Error).message}`;
      } finally {
        busy = false;
        handle.update();
      }
    };

    return () => {
      if (sessionStore.userId === null) return null;
      return (
        <div>
          {error && (
            <div role="alert" data-kind="error" mix={alertStyle}>{error}</div>
          )}
          <button
            type="button"
            disabled={busy}
            mix={[actionStyle, dangerStyle, on("click", () => void onClick())]}
          >
            サインアウト
          </button>
        </div>
      );
    };
  },
);
