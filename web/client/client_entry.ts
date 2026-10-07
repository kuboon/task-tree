/**
 * How an island names itself to the renderer — the same way on every host.
 *
 * `clientEntry()` takes an entry id. Remix's own convention is `import.meta.url`, which the asset
 * server resolves to the compiled module. That works while each island is its own file on disk,
 * and stops working the moment the server is bundled into a Worker: every module's
 * `import.meta.url` becomes the bundle's, and three islands name the same thing.
 *
 * So an island names itself by its path under `client/` instead, and the server side resolves
 * that on whichever host it runs: the dev server asks `@remix-kbn/assets-deno`, the Worker reads
 * the manifest the build wrote. The `file:` scheme is what makes the renderer hand the id to the
 * asset server rather than writing it into the HTML as is.
 */

/** The scheme + prefix every island id carries. */
export const CLIENT_ENTRY_PREFIX = "file:///client/";

/**
 * The entry id for a module under `client/`.
 *
 * @param path The module's path under `client/`, e.g. `islands/nav_auth.tsx`
 * @param exportName The exported component, named so minification cannot rename it away
 */
export function clientModule(path: string, exportName?: string): string {
  return exportName
    ? `${CLIENT_ENTRY_PREFIX}${path}#${exportName}`
    : `${CLIENT_ENTRY_PREFIX}${path}`;
}

/**
 * The `client/`-relative path an entry id names, or `null` for an id of some other shape.
 *
 * The renderer strips the `#export` before asking the asset server, but a caller may not have.
 */
export function clientEntryPath(id: string): string | null {
  if (!id.startsWith(CLIENT_ENTRY_PREFIX)) return null;
  const rest = id.slice(CLIENT_ENTRY_PREFIX.length);
  const hash = rest.indexOf("#");
  return hash === -1 ? rest : rest.slice(0, hash);
}
