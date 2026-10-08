/**
 * POST /api/ops/:name — the browser's door to `ops.ts`.
 *
 * Body: the operation's input as JSON. Answer: `{ result }`, or `{ error: { code, message } }`
 * with the matching status.
 */

import * as z from "zod";

import type { Authenticator } from "../auth.ts";
import { AppError } from "../domain/errors.ts";
import { Service } from "../domain/service.ts";
import type { Db } from "../lib/sql.ts";
import { isOpName, runOp } from "../ops.ts";
import { ensureUser, publicOrigin, publicUrl } from "./context.ts";

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof z.ZodError) {
    return Response.json(
      {
        error: {
          code: "invalid",
          message: error.issues.map((i) =>
            `${i.path.join(".") || "input"}: ${i.message}`
          ).join("; "),
        },
      },
      { status: 400 },
    );
  }
  console.error(error);
  return Response.json(
    {
      error: {
        code: "internal",
        message: error instanceof Error ? error.message : "Internal error",
      },
    },
    { status: 500 },
  );
}

export function createOpsHandler(db: Db, auth: Authenticator) {
  return async (request: Request, name: string): Promise<Response> => {
    try {
      if (!isOpName(name)) {
        throw new AppError("not_found", `Unknown operation: ${name}`);
      }
      const caller = await auth.browser(request, publicUrl(request));
      await ensureUser(db, caller);
      let input: unknown = {};
      const text = await request.text();
      if (text.trim()) {
        try {
          input = JSON.parse(text);
        } catch {
          throw new AppError("invalid", "Body must be JSON.");
        }
      }
      const result = await runOp(
        {
          service: new Service(db, caller.userId),
          origin: publicOrigin(request),
        },
        name,
        input,
      );
      return Response.json({ result }, {
        headers: { "cache-control": "no-store" },
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
