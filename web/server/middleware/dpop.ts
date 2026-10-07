/**
 * DPoP middleware — verifies RFC 9449 DPoP proofs on incoming requests and
 * exposes the session via `context.get(DpopSession)`.
 *
 * Thin wrapper over `@scope/remix-dpop-session-middleware`, re-exporting the context key from one
 * place. The session storage is the host's to supply (`app.tsx` → `AppDeps`): a D1-backed
 * `KvRepo` on both hosts, with a 1-hour TTL.
 *
 * The replay detector is the package's in-memory default — per process on Deno, per isolate on
 * Workers. Good enough while proofs are short-lived; a shared store is the upgrade.
 */

import { dpopSession } from "@scope/remix-dpop-session-middleware";
import { createKvSessionStorage } from "@scope/session-storage-kv";
import type { KvRepo } from "@kuboon/kv";
import type { Session, SessionStorage } from "@remix-run/session";

export { DpopSession } from "@scope/remix-dpop-session-middleware";

/** How long a DPoP session lives without being touched. */
export const DPOP_SESSION_TTL_MS = 3_600_000;

/** The `KvRepo` prefix sessions are stored under. */
export const DPOP_SESSION_PREFIX = ["dpop-session"];

/** Session storage over any `KvRepo` — the thing a host hands to `createApp`. */
export function createDpopSessionStorage(
  repo: KvRepo<Session["data"]>,
): SessionStorage {
  return createKvSessionStorage(repo);
}

export function createDpopMiddleware(sessionStorage: SessionStorage) {
  return dpopSession({ sessionStorage });
}
