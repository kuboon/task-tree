/**
 * Every URL the app answers, in one place.
 *
 * `server/router.tsx` maps these to the controllers that answer them, and everything that links
 * reads `routes.my.href()` rather than rebuilding `/my` at each call site.
 *
 * The app is always served from its origin's root (`deno serve` / Deno Deploy), so the map has no
 * prefix. Pages (`home`, `my`, …) and server routes (`jwks`, everything under `api`) are both
 * answered live by the same router.
 */

import { get, post, route } from "@remix-run/fetch-router/routes";

export const routes = route("", {
  home: get("/"),
  // [feature:hydration-demo]
  hydration: get("/hydration"),
  // [feature:signin] (the push card on this page is [feature:push])
  my: get("/my"),
  // [feature:fullscreen]
  fullscreen: get("/fullscreen"),
  // [feature:showcase]
  showcase: get("/showcase"),
  // [feature:spa]
  spa: route("spa", {
    /** One view of the SPA demo; the build generates each as its own static file. */
    show: get("/:id"),
  }),
  // [feature:blog]
  blog: route("blog", {
    index: get("/"),
    /** One article. Articles are Markdown files; `server/blog/` answers this by reading the slug's file. */
    show: get("/:slug"),
  }),
  // [feature:server-send] RP public JWKS — lets the IdP verify our `private_key_jwt` assertions.
  jwks: get("/.well-known/jwks.json"),
  api: route("api", {
    // [feature:server-send] Server-initiated push fan-out (delegates to the IdP). Not DPoP-protected.
    notify: post("/notify"),
    // [feature:turso] Turso (libSQL) + @remix-run/data-table sample.
    turso: get("/turso"),
    // [feature:protected-api] DPoP-protected JSON endpoints; `server/router.tsx` puts the DPoP middleware on this group.
    protected: route("protected", {
      get: get("/"),
      post: post("/"),
    }),
  }),
});
