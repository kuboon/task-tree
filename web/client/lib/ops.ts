/**
 * The browser's caller for `server/ops.ts`: `callOp("create_task", { teamId, title })`.
 *
 * Each call is a DPoP-bound `POST /api/ops/:name` carrying the IdP session token. Input and result
 * types come straight from the server's operation table, so a renamed field is a type error here.
 */

import type { OpInput, OpName, OpOutput } from "../../server/ops.ts";
import { routes } from "../routes.ts";
import { sessionStore } from "../session.ts";

export type { OpInput, OpName, OpOutput };

export class OpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OpError";
  }
}

export async function callOp<K extends OpName>(
  name: K,
  input: OpInput<K>,
): Promise<OpOutput<K>> {
  await sessionStore.load();
  const fetchDpop = sessionStore.fetchDpop;
  if (!fetchDpop || sessionStore.userId === null) {
    throw new OpError("unauthorized", "サインインしてください。", 401);
  }
  // The proof is bound to the absolute URL, which must match what the server sees.
  const url = new URL(routes.api.op.href({ name }), globalThis.location.origin)
    .href;
  for (let attempt = 0;; attempt++) {
    const response = await fetchDpop(url, {
      method: "POST",
      headers: {
        authorization: await sessionStore.authorization(attempt > 0),
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    const body = await response.json().catch(() => null) as
      | { result?: unknown; error?: { code?: string; message?: string } }
      | null;
    if (response.ok) return body?.result as OpOutput<K>;
    // An expired session token: refresh it from the IdP once and retry.
    if (response.status === 401 && attempt === 0) continue;
    throw new OpError(
      body?.error?.code ?? "error",
      body?.error?.message ?? `リクエストに失敗しました (${response.status})`,
      response.status,
    );
  }
}

/** A message for the user from whatever an operation threw. */
export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "エラーが発生しました。";
}
