/** Small things both front doors (`ops.ts`, `mcp.ts`) need. */

import type { Caller } from "../auth.ts";
import { getConfig } from "../config.ts";
import { upsertUser } from "../domain/service.ts";
import type { Db } from "../lib/sql.ts";

/** This app's public origin: `RP_ORIGIN` when set, else the request's own. */
export function publicOrigin(request: Request): string {
  return getConfig().rpOrigin || new URL(request.url).origin;
}

/** The URL the client addressed: the request's path and query under {@link publicOrigin}. */
export function publicUrl(request: Request): string {
  const url = new URL(request.url);
  return `${publicOrigin(request)}${url.pathname}${url.search}`;
}

/** User ids whose row is known to match, so a repeat caller costs no write. Per isolate. */
const known = new Map<string, string | null>();

/** Record the caller in `users` the first time this isolate sees them (or their nickname changes). */
export async function ensureUser(db: Db, caller: Caller): Promise<void> {
  if (known.has(caller.userId)) {
    const seen = known.get(caller.userId) ?? null;
    if (caller.nickname === null || caller.nickname === seen) return;
  }
  await upsertUser(db, caller.userId, caller.nickname);
  known.set(caller.userId, caller.nickname ?? known.get(caller.userId) ?? null);
}
