/**
 * The build: everything the Worker needs on disk.
 *
 *   deno run -A web/server/build.ts
 *
 * Writes `web/dist/public/` — the compiled chunks under `assets/` with their manifest, `static/`
 * copied as is, and `sw.js` at the root — which `wrangler.toml` serves as static assets. The
 * Worker script itself is bundled by `deno bundle` in the `build` task, after this.
 *
 * The chunks come from the same compiler the dev server uses (`assets_deno.ts`), fetched out of it
 * and written down, so what the Worker serves is byte for byte what `deno task dev` served.
 */

import { copy, emptyDir, ensureDir } from "@std/fs";

import { type AssetManifest, ASSETS_PATH, MANIFEST_PATH } from "./assets.ts";
import { clientDir, createDenoAssets } from "./assets_deno.ts";

const outDir = new URL("../dist/public/", import.meta.url);
const outPath = (publicPath: string) => new URL(`.${publicPath}`, outDir);

await emptyDir(outDir);

const assets = await createDenoAssets();

// The chunks, exactly as the asset server would serve them.
let chunks = 0;
for (const publicPath of assets.publicPaths()) {
  const response = await assets.fetch(new Request(`http://build${publicPath}`));
  if (!response.ok) {
    throw new Error(
      `${publicPath}: the asset server answered ${response.status}`,
    );
  }
  const target = outPath(publicPath);
  await ensureDir(new URL("./", target));
  await Deno.writeFile(target, new Uint8Array(await response.arrayBuffer()));
  chunks++;
}

// The manifest: every entrypoint, resolved. Islands are listed by reading the directory, so a new
// island is in the manifest by being in the directory, the same way it is an entrypoint.
const entrypoints = ["hydration.ts"];
for await (const entry of Deno.readDir(new URL("islands/", clientDir))) {
  if (entry.isFile && entry.name.endsWith(".tsx")) {
    entrypoints.push(`islands/${entry.name}`);
  }
}
entrypoints.sort();
const manifest: AssetManifest = {};
for (const entrypoint of entrypoints) {
  const { href, preloads } = await assets.getScriptEntry(entrypoint);
  manifest[entrypoint] = { href, preloads };
}
await Deno.writeTextFile(
  outPath(MANIFEST_PATH),
  JSON.stringify(manifest, null, 2) + "\n",
);

// The files the browser fetches by name.
await copy(new URL("static/", clientDir), new URL("static/", outDir));
await copy(new URL("sw.js", clientDir), new URL("sw.js", outDir));

console.log(
  `web/dist/public: ${chunks} chunks under ${ASSETS_PATH}, ${entrypoints.length} manifest entries, static/, sw.js`,
);
