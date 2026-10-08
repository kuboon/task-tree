/**
 * The RP's ECDSA P-256 (ES256) signing key.
 *
 * Used to sign `private_key_jwt` client assertions for the IdP and to publish
 * the matching public key at `/.well-known/jwks.json`, from which the IdP
 * fetches it to verify those assertions (RFC 7515 / 7517 / 7521 / 7523).
 *
 * The key is loaded from `RP_SIGNING_KEY_JWK` (a private JWK JSON) when set,
 * otherwise from the key store the host configured (D1), otherwise generated
 * once per process. Generation-on-first-use keeps local
 * development zero-config; the public half is always derived from whichever
 * private key is in use, so the JWKS endpoint and the signatures stay in sync.
 */

import { calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose";
import type { KvRepo } from "@kuboon/kv";

import { getConfig } from "../config.ts";

const ALG = "ES256";

/** A public JWK extended with the JWS metadata fields (RFC 7517 §4). */
export type PublicJwk = JsonWebKey & {
  kid: string;
  use: "sig";
  alg: "ES256";
};

export interface SigningKey {
  /** Private key for signing client assertions. */
  readonly privateKey: CryptoKey;
  /** RFC 7638 JWK SHA-256 thumbprint of the public key, used as `kid`. */
  readonly kid: string;
  /** Public JWK with `kid`/`use`/`alg` populated, ready to embed in JWKS. */
  readonly publicJwk: PublicJwk;
}

let signingKeyPromise: Promise<SigningKey> | undefined;

const importPrivateJwk = async (
  jwkText: string,
): Promise<{ privateKey: CryptoKey; publicJwk: JsonWebKey }> => {
  const jwk = JSON.parse(jwkText) as JsonWebKey;
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"],
  );
  // Strip the private fields to derive the public JWK.
  const { d: _d, ...publicJwk } = jwk;
  return { privateKey, publicJwk };
};

const generate = async (): Promise<
  { privateKey: CryptoKey; publicJwk: JsonWebKey }
> => {
  const { privateKey, publicKey } = await generateKeyPair(ALG, {
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  return { privateKey: privateKey as CryptoKey, publicJwk };
};

let store: KvRepo<JsonWebKey> | undefined;

/**
 * Where to keep a generated key so every process (every Workers isolate) signs with the same one.
 * The hosts point this at the D1 `kv` table; without it a key is generated per process.
 */
export function setSigningKeyStore(repo: KvRepo<JsonWebKey>): void {
  if (store !== repo) signingKeyPromise = undefined;
  store = repo;
}

/** The stored private JWK, generating and storing one first if there is none. */
const loadOrCreate = async (
  repo: KvRepo<JsonWebKey>,
): Promise<{ privateKey: CryptoKey; publicJwk: JsonWebKey }> => {
  const entry = repo.entry("es256");
  let jwk = await entry.get();
  if (!jwk) {
    const { privateKey } = await generateKeyPair(ALG, { extractable: true });
    const created = await exportJWK(privateKey);
    // Two isolates may race to create it: whichever write lands first wins, and both use it.
    await entry.update((current) => current ?? created);
    jwk = await entry.get() ?? created;
  }
  return await importPrivateJwk(JSON.stringify(jwk));
};

/**
 * Load the RP's signing key: `RP_SIGNING_KEY_JWK` when set, else the one kept in the store
 * (created on first use), else one generated for this process. Idempotent; later callers receive
 * the cached value.
 */
export const getSigningKey = (): Promise<SigningKey> => {
  if (!signingKeyPromise) {
    signingKeyPromise = (async () => {
      const { rpSigningKeyJwk } = getConfig();
      const { privateKey, publicJwk } = rpSigningKeyJwk
        ? await importPrivateJwk(rpSigningKeyJwk)
        : store
        ? await loadOrCreate(store)
        : await generate();
      const kid = await calculateJwkThumbprint(publicJwk);
      const { kty, crv, x, y } = publicJwk;
      return {
        privateKey,
        kid,
        publicJwk: { kty, crv, x, y, kid, use: "sig", alg: ALG },
      };
    })();
  }
  return signingKeyPromise;
};
