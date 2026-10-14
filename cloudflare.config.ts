import { bindings, defineConfig } from "cf/config";

// Cloudflare Workers deployment. `deno task build` writes the entrypoint and the assets directory
// (see wrangler.config.ts); chunks, `static/`, `sw.js` and the asset manifest are answered by the
// platform, and the Worker reads the manifest through the `ASSETS` binding.
//
// Optional secret (`cf deploy --secrets-file`): `RP_SIGNING_KEY_JWK`, a fixed ES256 private JWK.
// Without it the Worker generates one on first use and keeps it in D1 (`kv` table), shared by every
// isolate. It is not declared as `bindings.secret()` because that would make it required.
export default defineConfig((ctx) => {
  if (ctx.isPreview) {
    // Preview deployments (Workers Builds on non-production branches / PRs): their own D1, so
    // previews never touch production data, and no custom domain (it belongs to production).
    // RP_ORIGIN is empty on purpose: the app then uses each request's own origin, which is what
    // the DPoP `htu` check needs on a *.workers.dev preview URL. (Side effect: server -> IdP push
    // is unavailable.)
    return {
      worker: {
        name: "task-tree",
        compatibilityDate: "2026-10-01",
        entrypoint: "web/dist/worker.js",
        env: {
          IDP_ORIGIN: bindings.text("https://id.kbn.one"),
          RP_ORIGIN: bindings.text(""),
          DB: bindings.d1({
            name: "task-tree-preview",
            id: "32db5f2a-fd5c-4d16-ad8f-b416174e515e",
          }),
          ASSETS: bindings.assets(),
        },
      },
    };
  }
  return {
    worker: {
      name: "task-tree",
      compatibilityDate: "2026-10-01",
      entrypoint: "web/dist/worker.js",
      domains: ["task-tree.kbn.one"],
      env: {
        IDP_ORIGIN: bindings.text("https://id.kbn.one"),
        // This Worker's public origin; must be on the IdP's AUTHORIZE_WHITELIST (*.kbn.one is).
        RP_ORIGIN: bindings.text("https://task-tree.kbn.one"),
        // Account kuboon, APAC. Migrations: `deno task db migrate --remote` (see README).
        DB: bindings.d1({
          name: "task-tree",
          id: "6688e147-2742-49ca-a26a-93337fe6d4aa",
        }),
        ASSETS: bindings.assets(),
      },
    },
  };
});
