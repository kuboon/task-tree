/**
 * Every URL the app answers, in one place.
 *
 * `server/app.tsx` maps these to what answers them, and everything that links reads
 * `routes.team.href({ teamId })` rather than rebuilding the path at each call site.
 *
 * Pages render a shell whose islands fetch their data through `api.op` — a page request carries
 * no credentials (DPoP proofs are made per fetch), so the server cannot know who is asking until
 * the island calls in.
 *
 * Files the browser fetches by URL — `/assets/*`, `/static/*`, `/sw.js` — are not here: on
 * Cloudflare they are static assets the platform answers before the Worker runs, and the dev
 * server adds its own routes for them (`server/router.tsx`).
 */

import { get, post, route } from "@remix-run/fetch-router/routes";

export const routes = route("", {
  home: get("/"),
  my: get("/my"),
  team: get("/teams/:teamId"),
  join: get("/join/:token"),
  /** RP public JWKS — lets the IdP verify our `private_key_jwt` assertions. */
  jwks: get("/.well-known/jwks.json"),
  /** RFC 9728 metadata for `/mcp`, at the root and at the path-suffixed location. */
  protectedResource: get("/.well-known/oauth-protected-resource"),
  protectedResourceMcp: get("/.well-known/oauth-protected-resource/mcp"),
  api: route("api", {
    /** Every operation in `server/ops.ts`; the browser's only API. */
    op: post("/ops/:name"),
  }),
  /** The MCP server (Streamable HTTP; every method). */
  mcp: "/mcp",
});
