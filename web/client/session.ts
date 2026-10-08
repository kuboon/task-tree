/**
 * Shared DPoP session store for the browser.
 *
 * Every island needs the same session: this browser's DPoP key, the IdP's answer to
 * `GET ${IDP_ORIGIN}/session` (who is signed in), and the session token (`jws`) the IdP signs for
 * this key — the credential this app's API checks (`server/auth.ts`). The islands are code-split
 * out of one graph (`server/assets.ts`), so this module is one instance shared by all of them.
 *
 * Subscribe with `sessionStore.addEventListener("change", cb, { signal })` using a clientEntry's
 * `handle.signal` so the listener is removed on unmount.
 */

import { init } from "@kuboon/dpop";
import { TypedEventTarget } from "@remix-run/component";

import { IDP_ORIGIN } from "./idp.ts";

export type FetchDpop = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type SessionEventMap = { change: Event };

interface SessionAnswer {
  userId: string | null;
  jws?: string;
  nickname?: string | null;
}

/** Seconds since the epoch at which a JWT expires, or 0 when it cannot be read. */
function jwtExpiry(token: string): number {
  try {
    const payload = token.split(".")[1] ?? "";
    const json = new TextDecoder().decode(
      Uint8Array.fromBase64(payload, { alphabet: "base64url" }),
    );
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp : 0;
  } catch {
    return 0;
  }
}

class DpopSessionStore extends TypedEventTarget<SessionEventMap> {
  /** DPoP-bound fetch, available once {@link load} resolves (null if init failed). */
  fetchDpop: FetchDpop | null = null;
  /** This browser's DPoP key thumbprint — needed to start the sign-in flow. */
  thumbprint = "";
  /** IdP user id, or `null` when signed out / not yet loaded. */
  userId: string | null = null;
  /** The IdP nickname, when the user has set one. */
  nickname: string | null = null;
  /** True once the initial probe has resolved (success or failure). */
  ready = false;

  #jws = "";
  #loading?: Promise<void>;
  #refreshing?: Promise<void>;

  /**
   * Generate/reuse the DPoP key and probe the IdP `/session` — once. Concurrent and later callers
   * share the single probe. Always resolves (even if DPoP init fails) so subscribers leave the
   * loading state.
   */
  load(): Promise<void> {
    return (this.#loading ??= (async () => {
      try {
        const { fetchDpop, thumbprint } = await init();
        this.fetchDpop = fetchDpop;
        this.thumbprint = thumbprint;
        await this.#probe();
      } catch {
        // DPoP init failed (e.g. no IndexedDB) — stay signed-out but ready.
      } finally {
        this.ready = true;
        this.#emitChange();
      }
    })());
  }

  /**
   * The `Authorization` header for this app's API: the IdP session token, refreshed from the IdP
   * when it is about to expire (or when `force` says the server refused it).
   */
  async authorization(force = false): Promise<string> {
    await this.load();
    if (force || jwtExpiry(this.#jws) - 60 < Date.now() / 1000) {
      await (this.#refreshing ??= this.#probe().finally(() => {
        this.#refreshing = undefined;
      }));
      this.#emitChange();
    }
    if (!this.#jws) throw new Error("サインインしてください。");
    return `DPoP ${this.#jws}`;
  }

  /** Sign out at the IdP, then notify every subscriber. */
  async signOut(): Promise<void> {
    if (!this.fetchDpop) return;
    await this.fetchDpop(`${IDP_ORIGIN}/session/logout`, { method: "POST" });
    this.userId = null;
    this.nickname = null;
    this.#jws = "";
    this.#emitChange();
  }

  async #probe(): Promise<void> {
    if (!this.fetchDpop) return;
    try {
      const response = await this.fetchDpop(`${IDP_ORIGIN}/session`);
      const session = response.ok
        ? await response.json() as SessionAnswer
        : { userId: null };
      this.userId = session.userId ?? null;
      this.nickname = session.nickname ?? null;
      this.#jws = session.jws ?? "";
    } catch {
      // Signed out: the cross-origin probe can 401 or reject.
      this.userId = null;
      this.#jws = "";
    }
  }

  #emitChange(): void {
    this.dispatchEvent(new Event("change"));
  }
}

export const sessionStore: DpopSessionStore = new DpopSessionStore();
