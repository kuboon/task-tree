/**
 * The Cloudflare Workers host.
 *
 * `wrangler.toml` points `main` at the bundle `deno task build` writes from this file, and at the
 * `web/dist/public/` directory the same build fills: the chunks, `static/`, `sw.js`, and the
 * manifest. The platform answers requests for those files before this Worker runs, so the router
 * here only ever sees pages and the API.
 *
 * Everything is built on the first request rather than at module scope, because that is when the
 * bindings arrive — and because Workers forbid I/O in global scope anyway.
 */

import type { D1DatabaseBinding } from "@remix-kbn/data-table-d1";

import { createApp } from "./app.tsx";
import {
  type AssetManifest,
  createManifestAssets,
  MANIFEST_PATH,
} from "./assets.ts";
import { configure, type Env } from "./config.ts";
import { D1KvRepo } from "./lib/kv_d1.ts";
import {
  createDpopSessionStorage,
  DPOP_SESSION_PREFIX,
  DPOP_SESSION_TTL_MS,
} from "./middleware/dpop.ts";

/** The Worker's `env`: the variables `config.ts` reads, plus the bindings `wrangler.toml` declares. */
export interface WorkerEnv extends Env {
  readonly DB: D1DatabaseBinding;
  /** The static assets binding, for reading the manifest. */
  readonly ASSETS: { fetch(input: Request | string): Promise<Response> };
}

let app: ReturnType<typeof createApp> | undefined;

function boot(env: WorkerEnv) {
  configure(env);
  const assets = createManifestAssets(async () => {
    // Any origin will do: the assets binding ignores the host and reads the path.
    const response = await env.ASSETS.fetch(
      new Request(`https://assets.local${MANIFEST_PATH}`),
    );
    if (!response.ok) {
      throw new Error(
        `The asset manifest is missing (${response.status}); run \`deno task build\` before deploying.`,
      );
    }
    return await response.json() as AssetManifest;
  });
  return createApp({
    assets,
    sessionStorage: createDpopSessionStorage(
      new D1KvRepo(env.DB, DPOP_SESSION_PREFIX, {
        expireIn: DPOP_SESSION_TTL_MS,
      }),
    ),
  });
}

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    app ??= boot(env);
    return app.fetch(request);
  },
};
