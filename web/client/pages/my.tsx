import type { Handle } from "@remix-run/component";

import { IDP_ORIGIN } from "../idp.ts";
import { PushCard } from "../islands/push_card.tsx";
import { SignInCard } from "../islands/signin_card.tsx";

export const title = "マイページ — Task Tree";
export const description = "サインインとプッシュ通知の設定。";

/** Every card is an island. */
export const hydrate = true;

export default function My(_handle: Handle) {
  return () => (
    <>
      <meta name="idp-origin" content={IDP_ORIGIN} />
      <h1>マイページ</h1>

      <SignInCard idpOrigin={IDP_ORIGIN} />

      <PushCard idpOrigin={IDP_ORIGIN} />
    </>
  );
}
