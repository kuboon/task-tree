/**
 * The MCP server: one tool per operation in `ops.ts`, served over Streamable HTTP at `/mcp`.
 *
 * Authorization is id.kbn.one's OAuth 2.1 server; this app is the protected resource (RFC 9728).
 * An MCP client that gets a 401 here reads `WWW-Authenticate`, fetches our protected-resource
 * metadata, finds id.kbn.one in `authorization_servers`, and runs the standard flow (PKCE, CIMD)
 * there. What comes back is an access token whose `aud` is our MCP URL and whose `sub` is the same
 * user id the browser signs in as — so an agent sees exactly the teams its user does.
 *
 * A fresh `McpServer` is built per request (`createMcpHandler`), closed over that request's user.
 */

import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type * as z from "zod";

import type { Authenticator } from "../auth.ts";
import { getConfig } from "../config.ts";
import { AppError } from "../domain/errors.ts";
import { Service } from "../domain/service.ts";
import type { Db } from "../lib/sql.ts";
import { type OpDef, type OpName, ops, runOp } from "../ops.ts";
import { ensureUser, publicOrigin } from "./context.ts";

export const MCP_PATH = "/mcp";
const PRM_PATH = "/.well-known/oauth-protected-resource";

/** RFC 9728 protected-resource metadata for `/mcp`. */
export function protectedResourceMetadata(request: Request): Response {
  const origin = publicOrigin(request);
  return Response.json(
    {
      resource: `${origin}${MCP_PATH}`,
      authorization_servers: [getConfig().idpOrigin],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp"],
      resource_name: "Task Tree",
    },
    {
      headers: {
        "cache-control": "public, max-age=3600",
        "access-control-allow-origin": "*",
      },
    },
  );
}

function challenge(request: Request, error?: AppError): Response {
  const origin = publicOrigin(request);
  const params = [
    `resource_metadata="${origin}${PRM_PATH}${MCP_PATH}"`,
    'scope="mcp"',
    ...(error ? ['error="invalid_token"'] : []),
  ];
  return Response.json(
    {
      error: "unauthorized",
      error_description: error?.message ?? "Authorization required",
    },
    {
      status: 401,
      headers: { "www-authenticate": `Bearer ${params.join(", ")}` },
    },
  );
}

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function toolError(error: unknown) {
  const message = error instanceof AppError
    ? `${error.code}: ${error.message}`
    : error instanceof Error
    ? error.message
    : String(error);
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

function buildServer(db: Db, userId: string, origin: string): McpServer {
  const server = new McpServer({ name: "task-tree", version: "0.1.0" }, {
    instructions:
      "Task Tree: チームのタスク管理。チーム（list_teams）→ タスク（list_tasks）の順にたどる。タスクは parentId で親子の木、dependsOn で依存のグラフを作る。ready は今すぐ着手できるタスク。",
  });
  const ctx = { service: new Service(db, userId), origin };
  for (const [name, def] of Object.entries(ops)) {
    const op = def as OpDef<z.ZodObject, unknown>;
    server.registerTool(
      name,
      {
        description: op.description,
        inputSchema: op.input,
        annotations: {
          readOnlyHint: op.readOnly ?? false,
          destructiveHint: op.destructive ?? false,
          idempotentHint: op.readOnly ?? false,
          openWorldHint: false,
        },
      },
      async (args: unknown) => {
        try {
          return toolResult(await runOp(ctx, name as OpName, args));
        } catch (error) {
          return toolError(error);
        }
      },
    );
  }
  return server;
}

export function createMcpEndpoint(db: Db, auth: Authenticator) {
  return async (request: Request): Promise<Response> => {
    const origin = publicOrigin(request);
    let userId: string;
    try {
      const caller = await auth.bearer(request, [
        `${origin}${MCP_PATH}`,
        origin,
      ]);
      await ensureUser(db, caller);
      userId = caller.userId;
    } catch (error) {
      if (error instanceof AppError) {
        const hadToken = request.headers.has("authorization");
        return challenge(request, hadToken ? error : undefined);
      }
      throw error;
    }
    const handler = createMcpHandler(() => buildServer(db, userId, origin), {
      responseMode: "json",
      keepAliveMs: 0,
    });
    try {
      return await handler.fetch(request, {
        authInfo: {
          token: "",
          clientId: "",
          scopes: ["mcp"],
          extra: { userId },
        },
      });
    } finally {
      await handler.close();
    }
  };
}
