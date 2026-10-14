/**
 * `deno task db …` — the data-table D1 CLI, with the remote database id taken from
 * `cloudflare.config.ts` instead of `--database-id` / `$CLOUDFLARE_D1_DATABASE_ID`.
 *
 * The id is only filled in when it is missing: an explicit flag or env var still wins. `--preview`
 * picks the preview Worker's database (`task-tree-preview`) instead of production's; the CLI never
 * sees that flag. The account and API token still come from `$CLOUDFLARE_ACCOUNT_ID` /
 * `$CLOUDFLARE_API_TOKEN`.
 */
import process from "node:process";
import config from "../cloudflare.config.ts";

const args = Deno.args.filter((arg) => arg !== "--preview");
const preview = args.length !== Deno.args.length;
const wantsId = args.includes("--remote") &&
  !args.some((arg) =>
    arg === "--database-id" || arg.startsWith("--database-id=")
  ) &&
  !Deno.env.get("CLOUDFLARE_D1_DATABASE_ID");

if (wantsId) {
  const { worker } = await config({ isPreview: preview } as never);
  const db = worker.env?.DB as { type?: string; id?: string } | undefined;
  if (db?.type !== "d1" || !db.id) {
    throw new Error("cloudflare.config.ts has no D1 binding `DB` with an id.");
  }
  Deno.env.set("CLOUDFLARE_D1_DATABASE_ID", db.id);
}

// The CLI parses its own argv, so hand it the list without `--preview`.
Object.defineProperty(Deno, "args", { value: args });
process.argv = [...process.argv.slice(0, 2), ...args];
await import("@remix-kbn/data-table-d1/cli");
