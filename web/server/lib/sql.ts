/**
 * The few calls this app makes on a D1 binding, typed.
 *
 * Only `prepare().bind().all()` and `batch()` are used, because that is the surface both the real
 * `env.DB` and `createLocalD1()` (the Deno host and the tests) implement.
 */

import type {
  D1DatabaseBinding,
  D1PreparedStatementBinding,
} from "@remix-kbn/data-table-d1";

export type Db = D1DatabaseBinding;
export type Statement = D1PreparedStatementBinding;

/** A prepared statement with its parameters bound, for {@link batch}. */
export function stmt(db: Db, sql: string, ...params: unknown[]): Statement {
  return db.prepare(sql).bind(...params);
}

/** Every row the query returns. */
export async function all<T>(
  db: Db,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const result = await stmt(db, sql, ...params).all();
  return result.results as T[];
}

/** The first row, or `null`. */
export async function first<T>(
  db: Db,
  sql: string,
  ...params: unknown[]
): Promise<T | null> {
  return (await all<T>(db, sql, ...params))[0] ?? null;
}

/** Run a write; returns the number of rows it changed. */
export async function run(
  db: Db,
  sql: string,
  ...params: unknown[]
): Promise<number> {
  const result = await stmt(db, sql, ...params).all();
  return result.meta.changes ?? 0;
}

/** Run statements as one transaction: all of them commit, or none do. */
export async function batch(db: Db, statements: Statement[]): Promise<void> {
  if (statements.length > 0) await db.batch(statements);
}
