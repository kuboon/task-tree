/**
 * The database, on the Deno host: a local SQLite file driven through the same D1 binding surface
 * the Worker's `env.DB` has, migrated on startup from `db/migrations/`.
 *
 * The Worker never loads this file — `createLocalD1` is `node:sqlite`, and the migrations are
 * applied to the real D1 by `deno task db migrate --remote` (see `README.md`). What both hosts
 * share is `@remix-kbn/data-table-d1`'s `createD1Database`, and `lib/kv_d1.ts`.
 */

import { createD1Database } from "@remix-kbn/data-table-d1";
import type { D1DatabaseBinding } from "@remix-kbn/data-table-d1";
import { loadMigrations } from "@remix-run/data-table/migrations/node";

/** Where `db/migrations/` is, from here. */
const migrationsDir = new URL("../../db/migrations/", import.meta.url);

/** Apply every pending migration to a local D1 binding. */
export async function migrateLocalD1(d1: D1DatabaseBinding): Promise<void> {
  const db = createD1Database(d1);
  const migrations = await loadMigrations(
    decodeURIComponent(migrationsDir.pathname),
  );
  await db.migrate(migrations);
}
