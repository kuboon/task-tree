/**
 * The Deno host: `deno serve router.tsx` for development, and what the tests `fetch()` against.
 *
 * It builds the app (`app.tsx`) with Deno's versions of what a host supplies — modules compiled on
 * startup, a local SQLite file behind the D1 binding surface — and adds the routes for files the
 * Cloudflare platform would otherwise serve on its own: the chunks, `static/`, and the service
 * worker.
 *
 * `D1_LOCAL_PATH` names the SQLite file (`data/app.db` by default; `:memory:` in the tests). It is
 * migrated on startup, so a fresh checkout needs no step before `deno task dev`.
 */

import { serveDir } from "@std/http/file-server";
import { createLocalD1 } from "@remix-kbn/data-table-d1/node";

import { createApp } from "./app.tsx";
import { createDenoAssets } from "./assets_deno.ts";
import { createAuthenticator } from "./auth.ts";
import { getConfig } from "./config.ts";
import { migrateLocalD1 } from "./db.ts";

const clientDir = new URL("../client/", import.meta.url);

/** The local database, exported so tests can seed it. */
export const db = await createLocalD1(
  Deno.env.get("D1_LOCAL_PATH") ??
    decodeURIComponent(new URL("../../data/app.db", import.meta.url).pathname),
);
await migrateLocalD1(db);

const assets = await createDenoAssets();

const router = createApp({
  assets,
  db,
  auth: createAuthenticator({ idpOrigin: getConfig().idpOrigin }),
});

/** The files under `client/static/`, served verbatim at their own names. */
const staticDir = decodeURIComponent(new URL("static/", clientDir).pathname);
router.get("/static/*path", ({ request }) =>
  serveDir(request, {
    fsRoot: staticDir,
    urlRoot: "static",
    quiet: true,
    headers: ["cache-control: public, max-age=3600"],
  }));

router.get("/assets/*path", ({ request }) => assets.fetch(request));

/**
 * The service worker, from `client/sw.js`. Served at the root so its scope is the whole origin.
 */
const serviceWorker = await Deno.readTextFile(new URL("sw.js", clientDir));
router.get(
  "/sw.js",
  () =>
    new Response(serviceWorker, {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-cache",
      },
    }),
);

export default router;
