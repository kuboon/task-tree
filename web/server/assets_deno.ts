/**
 * The browser modules, compiled on startup — the dev server's asset server, and the build's.
 *
 * `@remix-kbn/assets-deno` runs one `Deno.bundle` over every entrypoint in `assets.ts` and serves
 * the chunks from memory. The Worker never loads this file: `build.ts` uses it to write the same
 * chunks to disk, with a manifest, and `worker.ts` reads those back.
 */

import { createAssetServer } from "@remix-kbn/assets-deno";

import {
  type AppAssets,
  ASSETS_PATH,
  CLIENT_ENTRYPOINTS,
  entrypointFor,
} from "./assets.ts";

/** The directory every entrypoint is resolved against. */
export const clientDir = new URL("../client/", import.meta.url);

export interface DenoAssets extends AppAssets {
  /** Serve one chunk. */
  fetch(request: Request): Promise<Response>;
  /** Every served chunk's public path. */
  publicPaths(): string[];
}

export async function createDenoAssets(): Promise<DenoAssets> {
  const inner = await createAssetServer({
    rootDir: decodeURIComponent(clientDir.pathname),
    entrypoints: CLIENT_ENTRYPOINTS,
    basePath: ASSETS_PATH,
    mode: "bundle",
    // The sources are on GitHub; no source maps.
    bundle: { sourcemap: "none" },
  });

  return {
    fetch: (request) => inner.fetch(request),
    getScriptEntry: (id) => inner.getScriptEntry(entrypointFor(id)),
    publicPaths: () => [...new Set(inner.moduleUrls().values())],
  };
}
