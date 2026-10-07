/**
 * The app, wired by hand — and wired the same on both hosts.
 *
 * Route definitions live in `client/routes.ts` and this file maps them to what answers them — the
 * shape a Remix app has. `router.map(routes, controller)` is the whole of the mapping, and a
 * controller has to name an action for every route in the map it owns: leave one out and the
 * router throws while it is being built, rather than answering a route with nothing.
 *
 * What differs between hosts is handed in as {@link AppDeps}: where the browser modules are
 * (`assets`), and where DPoP sessions are kept (`sessionStorage`). `router.tsx` builds those for
 * Deno, `worker.ts` for Cloudflare, and nothing in here names either runtime.
 */

import {
  createController,
  createRouter,
  type RouterContext,
} from "@remix-run/fetch-router";
import { render } from "@remix-run/render-middleware";
import type { SessionStorage } from "@remix-run/session";

import type { AppAssets } from "./assets.ts";
import { Layout, type PageModule } from "../client/layout.tsx";
import { routes } from "../client/routes.ts";
import * as Home from "../client/pages/index.tsx";
import * as My from "../client/pages/my.tsx";

import { createApiController } from "./controllers/api/controller.ts";
import { notifyAction } from "./controllers/api/notify.ts";
import { jwksAction } from "./controllers/well_known.ts";
import { createDpopMiddleware } from "./middleware/dpop.ts";

/** What a host supplies to build the app. */
export interface AppDeps {
  /** Resolves islands and the runtime to their public URLs. */
  assets: AppAssets;
  /** Where DPoP sessions live (`middleware/dpop.ts`). */
  sessionStorage: SessionStorage;
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
  const { assets } = deps;
  const router = buildRouter(assets);

  /** The runtime a hydrating page loads, resolved once and kept. */
  let runtime: Promise<{ src: string; preloads: string[] }> | undefined;
  const clientRuntime = () =>
    runtime ??= assets.getScriptEntry("hydration.ts").then((entry) => ({
      src: entry.href,
      preloads: entry.preloads,
    }));

  /** Renders a page module into the shell. */
  const pageAction = (page: PageModule) => {
    const Page = page.default;
    return async (context: AppContext): Promise<Response> =>
      context.render(
        <Layout
          title={page.title}
          description={page.description}
          script={page.hydrate ? await clientRuntime() : null}
        >
          <Page />
        </Layout>,
      );
  };

  const top = createController(routes, {
    actions: {
      home: pageAction(Home),
      my: pageAction(My),
      jwks: jwksAction,
    },
  });

  const api = createController(routes.api, {
    actions: {
      notify: notifyAction,
    },
  });

  router.map(routes, top);
  router.map(routes.api, api);
  router.map(
    routes.api.protected,
    createApiController(createDpopMiddleware(deps.sessionStorage)),
  );

  return router;
}
