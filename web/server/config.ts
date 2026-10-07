/**
 * Server-side configuration, decoupled from the host runtime's environment.
 *
 * Cloudflare Workers hand the environment to `fetch(request, env, ctx)` as an object; Deno has
 * `Deno.env`. This module models the Workers shape ({@link Env}) and derives the typed
 * {@link Config} from it via {@link loadConfig}.
 *
 * Who supplies the env depends on the host:
 *
 * - **Workers** — `worker.ts` calls {@link configure} with the `env` of the first request. Bindings
 *   (`DB`, `ASSETS`) ride in the same object but are the host entry's business, not this module's.
 * - **Deno** — nobody calls {@link configure}; {@link getConfig} reads {@link denoEnv} on first use.
 */

/** Environment variables, as Cloudflare Workers passes them in `env` (bindings aside). */
export interface Env {
  readonly IDP_ORIGIN?: string;
  readonly RP_ORIGIN?: string;
  readonly RP_SIGNING_KEY_JWK?: string;
}

/** Parsed, typed configuration used across the server. */
export interface Config {
  /** Origin of the IdP (id.kbn.one). Mirrors the client's `IDP_ORIGIN`. */
  readonly idpOrigin: string;
  /**
   * This app's own public origin — the `clientId` / `iss` / `sub` of the
   * `private_key_jwt` client assertion. Must be whitelisted on the IdP and be
   * the origin it fetches `/.well-known/jwks.json` from. Empty until set; the
   * push send path surfaces a clear error in that case.
   */
  readonly rpOrigin: string;
  /**
   * Optional ES256 private key (JWK JSON) for signing client assertions and
   * publishing JWKS. When empty an ephemeral key is generated per process —
   * per isolate, on Workers — so production must set a fixed key.
   */
  readonly rpSigningKeyJwk: string;
}

/** Derive the typed {@link Config} from a raw host env record. */
export function loadConfig(env: Env): Config {
  return {
    idpOrigin: env.IDP_ORIGIN ?? "https://id.kbn.one",
    rpOrigin: env.RP_ORIGIN ?? "",
    rpSigningKeyJwk: env.RP_SIGNING_KEY_JWK ?? "",
  };
}

/** Keys read from the host environment. */
const ENV_KEYS = ["IDP_ORIGIN", "RP_ORIGIN", "RP_SIGNING_KEY_JWK"] as const;

/**
 * Read {@link Env} from `Deno.env` — the single point of `Deno.env` access.
 * Returns an empty record on non-Deno hosts.
 */
export function denoEnv(): Env {
  const deno = (globalThis as {
    Deno?: { env: { get(key: string): string | undefined } };
  }).Deno;
  if (!deno) return {};
  const env: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const value = deno.env.get(key);
    if (value !== undefined) env[key] = value;
  }
  return env;
}

let config: Config | undefined;

/**
 * Install the config from a host-supplied env. Idempotent: the first call wins, so a Worker can
 * call it on every request without re-parsing.
 */
export function configure(env: Env): Config {
  return (config ??= loadConfig(env));
}

/** The active {@link Config}: what {@link configure} installed, else `Deno.env`. */
export function getConfig(): Config {
  return (config ??= loadConfig(denoEnv()));
}
