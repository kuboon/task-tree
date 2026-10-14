import { defineWranglerConfig } from "wrangler/experimental-config";

// What `cloudflare.config.ts` cannot express yet: where `deno task build` puts the static assets.
export default defineWranglerConfig(() => ({
  assetsDirectory: "web/dist/public",
}));
