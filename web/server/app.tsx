/**
 * The app, wired by hand — and wired the same on both hosts.
 *
 * Route definitions live in `client/routes.ts` and this file maps them to what answers them.
 * `router.map(routes, controller)` is the whole of the mapping, and a controller has to name an
 * action for every route in the map it owns.
 *
 * What differs between hosts is handed in as {@link AppDeps}: where the browser modules are
 * (`assets`), the database (`db`, a D1 binding or a local one), and how callers are authenticated.
 * `router.tsx` builds those for Deno, `worker.ts` for Cloudflare, and nothing in here names either
 * runtime.
 */

import {
  createController,
  createRouter,
  type RouterContext,
} from "@remix-run/fetch-router";
import { render } from "@remix-run/render-middleware";
import type { RemixNode } from "@remix-run/component";

import type { AppAssets } from "./assets.ts";
import type { Authenticator } from "./auth.ts";
import { Layout } from "../client/layout.tsx";
import { routes } from "../client/routes.ts";
import * as Home from "../client/pages/index.tsx";
import * as My from "../client/pages/my.tsx";
import * as Team from "../client/pages/team.tsx";
import * as Join from "../client/pages/join.tsx";

import {
  createMcpEndpoint,
  protectedResourceMetadata,
} from "./controllers/mcp.ts";
import { publicOrigin } from "./controllers/context.ts";
import { createOpsHandler } from "./controllers/ops.ts";
import { jwksAction } from "./controllers/well_known.ts";
import { D1KvRepo } from "./lib/kv_d1.ts";
import { setSigningKeyStore } from "./lib/signing-key.ts";
import type { Db } from "./lib/sql.ts";

/** What a host supplies to build the app. */
export interface AppDeps {
  /** Resolves islands and the runtime to their public URLs. */
  assets: AppAssets;
  /** The D1 binding (`env.DB`), or a local one with the same surface. */
  db: Db;
  /** Verifies browser and MCP credentials against id.kbn.one. */
  auth: Authenticator;
}

function buildRouter(assets: AppAssets) {
  return createRouter({ middleware: [render({ assets })] });
}

/** The router every host serves. */
export type AppRouter = ReturnType<typeof buildRouter>;

/** The request context the middlewares produce — `context.render`, in practice. */
export type AppContext = RouterContext<AppRouter>;

declare module "@remix-run/fetch-router" {
  interface RouterTypes {
    context: AppContext;
  }
}

export function createApp(deps: AppDeps): AppRouter {
  const { assets, db, auth } = deps;
  const router = buildRouter(assets);

  setSigningKeyStore(new D1KvRepo<JsonWebKey>(db, ["rp-signing-key"]));

  /** The runtime a hydrating page loads, resolved once and kept. */
  let runtime: Promise<{ src: string; preloads: string[] }> | undefined;
  const clientRuntime = () =>
    runtime ??= assets.getScriptEntry("hydration.ts").then((entry) => ({
      src: entry.href,
      preloads: entry.preloads,
    }));

  /** Renders a page into the shell. Every page hydrates: the nav's sign-in is an island. */
  const page = async (
    context: AppContext,
    meta: { title: string; description?: string },
    body: RemixNode,
  ): Promise<Response> =>
    context.render(
      <Layout
        title={meta.title}
        description={meta.description}
        script={await clientRuntime()}
      >
        {body}
      </Layout>,
    );

  const ops = createOpsHandler(db, auth);
  const mcp = createMcpEndpoint(db, auth);

  const top = createController(routes, {
    actions: {
      home: (context) =>
        page(
          context,
          Home,
          <Home.default origin={publicOrigin(context.request)} />,
        ),
      my: (context) => page(context, My, <My.default />),
      team: (context) =>
        page(context, Team, <Team.default teamId={context.params.teamId} />),
      join: (context) =>
        page(context, Join, <Join.default token={context.params.token} />),
      jwks: jwksAction,
      protectedResource: ({ request }) => protectedResourceMetadata(request),
      protectedResourceMcp: ({ request }) => protectedResourceMetadata(request),
      mcp: ({ request }) => mcp(request),
    },
  });

  const api = createController(routes.api, {
    actions: {
      op: ({ request, params }) => ops(request, params.name),
    },
  });

  router.map(routes, top);
  router.map(routes.api, api);

  return router;
}
