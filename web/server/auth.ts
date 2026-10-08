/**
 * Who is calling — the two ways in, both ending at an id.kbn.one user id.
 *
 * - **Browser** (`/api/ops/*`): the page holds a DPoP key that id.kbn.one bound to the user at
 *   sign-in. Each request carries a DPoP proof (`DPoP:` header, RFC 9449) and the IdP's session
 *   token (`Authorization: DPoP <jws>`, from `GET ${IDP_ORIGIN}/session`). The token is the IdP's
 *   signature on "this user, this key" (`sub`, `cnf.jkt`); the proof shows the caller holds that
 *   key. Both are checked here; no session is kept.
 * - **MCP** (`/mcp`): an OAuth 2.1 access token id.kbn.one issued for this resource
 *   (`Authorization: Bearer`, RFC 9068 `at+jwt`, `aud` = our MCP URL).
 *
 * Signatures are checked against the IdP's JWKS (`/.well-known/jwks.json`), fetched and cached by
 * `jose`. Tests hand in their own key resolver.
 */

import {
  createRemoteJWKSet,
  type JWTPayload,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import { computeThumbprint } from "@kuboon/dpop/common.ts";
import { verifyDpopProof } from "@kuboon/dpop/server.ts";

import { AppError } from "./domain/errors.ts";

export interface Caller {
  userId: string;
  /** The IdP nickname, when the credential carries one (browser sign-in does; MCP tokens do not). */
  nickname: string | null;
}

export interface Authenticator {
  /**
   * A browser request: DPoP proof + IdP session token.
   *
   * `publicUrl` is the URL the browser addressed — what its proof is bound to (`htu`). It differs
   * from `request.url` when the platform rewrites the host (a custom domain in `wrangler dev`, a
   * proxy), so the caller passes it in rather than this guessing.
   */
  browser(request: Request, publicUrl?: string): Promise<Caller>;
  /** An MCP request: an OAuth access token whose audience is one of `audiences`. */
  bearer(request: Request, audiences: string[]): Promise<Caller>;
}

export interface AuthenticatorOptions {
  idpOrigin: string;
  /** Resolves the IdP's signing keys. Defaults to its published JWKS. */
  keys?: JWTVerifyGetKey;
  /** Maximum age of a DPoP proof, in seconds. */
  proofMaxAgeSeconds?: number;
}

/**
 * Remembers DPoP proof ids until they are too old to be accepted anyway, so a proof cannot be
 * replayed within its lifetime. Per isolate: a replay that lands on another isolate is not caught,
 * which the short proof lifetime bounds.
 */
class ReplayGuard {
  #seen = new Map<string, number>();
  constructor(private readonly ttlMs: number) {}

  check(jti: string): boolean {
    const now = Date.now();
    if (this.#seen.size > 10_000) {
      for (const [id, until] of this.#seen) {
        if (until < now) this.#seen.delete(id);
      }
    }
    const until = this.#seen.get(jti);
    if (until !== undefined && until >= now) return false;
    this.#seen.set(jti, now + this.ttlMs);
    return true;
  }
}

const unauthorized = (message: string) => new AppError("unauthorized", message);

export function createAuthenticator(
  options: AuthenticatorOptions,
): Authenticator {
  const { idpOrigin } = options;
  const keys = options.keys ??
    createRemoteJWKSet(new URL("/.well-known/jwks.json", idpOrigin));
  const proofMaxAge = options.proofMaxAgeSeconds ?? 300;
  const replay = new ReplayGuard((proofMaxAge + 60) * 1000);

  const verify = async (
    token: string,
    extra: Parameters<typeof jwtVerify>[2] = {},
  ): Promise<JWTPayload> => {
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer: idpOrigin,
        algorithms: ["ES256"],
        ...extra,
      });
      return payload;
    } catch {
      throw unauthorized("トークンが無効か、期限切れです。");
    }
  };

  const subject = (payload: JWTPayload): string => {
    if (typeof payload.sub !== "string" || !payload.sub) {
      throw unauthorized("トークンに利用者がありません。");
    }
    return payload.sub;
  };

  return {
    async browser(request, publicUrl = request.url) {
      const [scheme, token] = (request.headers.get("authorization") ?? "")
        .split(" ", 2);
      if (scheme !== "DPoP" || !token) {
        throw unauthorized("サインインしてください。");
      }
      const header = request.headers.get("dpop");
      if (!header) throw unauthorized("DPoP proof: missing-dpop-header");
      const proof = await verifyDpopProof(
        { proof: header, method: request.method, url: publicUrl },
        {
          maxAgeSeconds: proofMaxAge,
          checkReplay: (jti) => replay.check(jti),
        },
      );
      if (!proof.valid) throw unauthorized(`DPoP proof: ${proof.error}`);

      const payload = await verify(token);
      const cnf = payload.cnf as { jkt?: unknown } | undefined;
      if (cnf?.jkt !== await computeThumbprint(proof.jwk)) {
        throw unauthorized("トークンがこの鍵に紐付いていません。");
      }
      return {
        userId: subject(payload),
        nickname: typeof payload.nickname === "string"
          ? payload.nickname
          : null,
      };
    },

    async bearer(request, audiences) {
      const [scheme, token] = (request.headers.get("authorization") ?? "")
        .split(" ", 2);
      if (scheme?.toLowerCase() !== "bearer" || !token) {
        throw unauthorized("アクセストークンが必要です。");
      }
      const payload = await verify(token, {
        audience: audiences,
        typ: "at+jwt",
      });
      const scope = typeof payload.scope === "string" ? payload.scope : "";
      if (!scope.split(" ").includes("mcp")) {
        throw unauthorized("mcp スコープがありません。");
      }
      return { userId: subject(payload), nickname: null };
    },
  };
}
