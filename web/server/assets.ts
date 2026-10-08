/**
 * The browser modules: what they are, where they are served, and how the renderer finds them.
 *
 * This half is host-neutral and is all the Worker needs. The dev server's half — compiling the
 * modules on startup with `@remix-kbn/assets-deno` — is `assets_deno.ts`, and the build
 * (`build.ts`) uses that same compiler to write the chunks and the manifest the Worker reads.
 */

import { clientEntryPath } from "../client/client_entry.ts";

/** Where the chunks are served. */
export const ASSETS_PATH = "/assets";

/** The manifest the build writes next to the chunks, and the Worker reads back. */
export const MANIFEST_PATH = `${ASSETS_PATH}/manifest.json`;

/**
 * The entrypoints, relative to `client/`: the runtime, and every island by where it is.
 *
 * Every entrypoint goes into a single `Deno.bundle({ codeSplitting: true })` call, which is the
 * point: a module two of them import — the DPoP session store — is emitted once, into a chunk both
 * import, so it is one module at runtime rather than two copies with two states.
 */
export const CLIENT_ENTRYPOINTS: readonly string[] = [
  "hydration.ts",
  "islands/*.tsx",
];

/** What the renderer asks for — structurally `@remix-run/assets`'s `ScriptEntry`. */
export interface ScriptEntry {
  href: string;
  preloads: string[];
  importMap: { imports: Record<string, string> };
}

/** What `render({ assets })` and the pages need of an asset server, on any host. */
export interface AppAssets {
  /**
   * Resolve an entry id — an island's `clientModule(...)` id, or a bare entrypoint path such as
   * `hydration.ts` — to its public URL and the chunks to preload behind it.
   */
  getScriptEntry(entry: string): Promise<ScriptEntry>;
}

/** One entry's resolution, as the build writes it. */
export interface ManifestEntry {
  href: string;
  preloads: string[];
}

/** Entrypoint path (relative to `client/`) → where the build put it. */
export type AssetManifest = Record<string, ManifestEntry>;

/** The entrypoint an id names: an island id is unwrapped, anything else is taken as is. */
export function entrypointFor(id: string): string {
  return clientEntryPath(id) ?? id;
}

/**
 * An asset server over a prebuilt manifest — the Worker's.
 *
 * @param load Reads the manifest, once; the result is kept for the life of the isolate
 */
export function createManifestAssets(
  load: () => Promise<AssetManifest>,
): AppAssets {
  let manifest: Promise<AssetManifest> | undefined;
  return {
    async getScriptEntry(id) {
      const entries = await (manifest ??= load());
      const key = entrypointFor(id);
      const entry = entries[key];
      if (entry === undefined) {
        throw new Error(
          `"${key}" is not in the asset manifest. Known entries: ${
            Object.keys(entries).join(", ")
          }.`,
        );
      }
      return { ...entry, importMap: { imports: {} } };
    },
  };
}
