import type { Handle } from "@remix-run/component";

import { IDP_ORIGIN } from "../idp.ts";
import { PushCard } from "../islands/push_card.tsx";
import { SignOut } from "../islands/sign_out.tsx";
import { TeamsHome } from "../islands/teams_home.tsx";

export const title = "マイページ — Task Tree";
export const description =
  "所属チームとチームの作成、通知の設定、サインアウト。";

/** Every part is an island. */
export const hydrate = true;

export default function My(_handle: Handle) {
  return () => (
    <>
      <meta name="idp-origin" content={IDP_ORIGIN} />
      <h1>マイページ</h1>

      <TeamsHome />

      <PushCard idpOrigin={IDP_ORIGIN} />

      <SignOut />
    </>
  );
}
