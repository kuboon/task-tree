/**
 * Every URL the app answers, in one place.
 *
 * `server/app.tsx` maps these to the controllers that answer them, and everything that links
 * reads `routes.my.href()` rather than rebuilding `/my` at each call site.
 *
 * The app is always served from its origin's root, so the map has no prefix. Pages (`home`, `my`)
 * and server routes (`jwks`, everything under `api`) are answered by the same router.
 *
 * Files the browser fetches by URL — `/assets/*`, `/static/*`, `/sw.js` — are not here: on
 * Cloudflare they are static assets the platform answers before the Worker runs, and the dev
 * server adds its own routes for them (`server/router.tsx`).
 */

import { get, post, route } from "@remix-run/fetch-router/routes";

export const routes = route("", {
  home: get("/"),
  my: get("/my"),
  /** RP public JWKS — lets the IdP verify our `private_key_jwt` assertions. */
  jwks: get("/.well-known/jwks.json"),
  api: route("api", {
    /** Server-initiated push fan-out (delegates to the IdP). Not DPoP-protected. */
    notify: post("/notify"),
    /** DPoP-protected JSON endpoints; `server/app.tsx` puts the DPoP middleware on this group. */
    protected: route("protected", {
      get: get("/"),
      post: post("/"),
    }),
  }),
});
