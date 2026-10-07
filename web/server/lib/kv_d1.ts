/**
 * A `KvRepo` over a Cloudflare D1 binding — the same surface on `env.DB` and on
 * `createLocalD1()` from `@remix-kbn/data-table-d1/node`, so the dev server and the tests use
 * this file unchanged.
 *
 * Modeled on `@kuboon/kv/turso.ts`: one `kv` table (`key` / `value` / `expires_at` / `version`)
 * holds every prefix, keys are encoded so a prefix is a string prefix, and `update` is optimistic
 * on `version` — a write that lost a race answers `ok: false` with the value that won.
 *
 * The table comes from the migration `db/migrations/*_init`; nothing here creates it.
 *
 * Only `prepare().bind().all()` is used, because that is the part of D1's API the local binding
 * implements — `first()` and `run()` are conveniences over the same call.
 */

import type { D1DatabaseBinding } from "@remix-kbn/data-table-d1";
import type {
  KvEntryInterface,
  KvKey,
  KvKeyPart,
  KvOptions,
  KvRepo,
  KvUpdateResult,
} from "@kuboon/kv";
import { monotonicUlid } from "@std/ulid";

// --- key codec ------------------------------------------------------------
// Each key part becomes `<tag><base64url>` and parts are joined with a trailing `/`. base64url
// never contains `/`, so the separator is unambiguous; it does contain `_`, which LIKE treats as a
// wildcard, so prefix queries escape it.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const b64u = (s: string): string =>
  encoder.encode(s).toBase64({ alphabet: "base64url", omitPadding: true });

const unb64u = (b: string): string =>
  decoder.decode(Uint8Array.fromBase64(b, { alphabet: "base64url" }));

const encPart = (part: KvKeyPart): string => {
  switch (typeof part) {
    case "string":
      return "s" + b64u(part);
    case "number":
      return "n" + b64u(String(part));
    case "bigint":
      return "g" + b64u(String(part));
    case "boolean":
      return "b" + (part ? "1" : "0");
    default:
      throw new TypeError(`Unsupported key part: ${typeof part}`);
  }
};

const decPart = (token: string): KvKeyPart => {
  const body = token.slice(1);
  switch (token[0]) {
    case "s":
      return unb64u(body);
    case "n":
      return Number(unb64u(body));
    case "g":
      return BigInt(unb64u(body));
    case "b":
      return body === "1";
    default:
      throw new Error(`Malformed key token: ${token}`);
  }
};

const encKey = (parts: KvKey): string =>
  parts.map((p) => encPart(p) + "/").join("");

/** Escape `\` `%` `_` for a LIKE pattern used with `ESCAPE '\'`. */
const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => "\\" + c);

interface KvRow {
  key: string;
  value: string;
  expires_at: number | null;
  version: number;
}

const asNumber = (value: unknown): number | null =>
  value == null ? null : Number(value);

export class D1KvRepo<TVal> implements KvRepo<TVal, KvKeyPart, KvOptions> {
  /**
   * @param db The D1 binding (`env.DB`), or a local one from `createLocalD1()`
   * @param prefix The key prefix every entry of this repo shares
   * @param options Defaults applied to every write (`expireIn`)
   */
  constructor(
    public db: D1DatabaseBinding,
    public prefix: KvKey = [],
    public options: KvOptions = {},
  ) {}

  genKey(): string {
    return monotonicUlid();
  }

  entry<TEntryVal = TVal>(
    key: KvKeyPart,
  ): KvEntryInterface<TEntryVal, KvKeyPart, KvOptions> {
    const fullKey = [...this.prefix, key];
    const strKey = encKey(fullKey);
    const db = this.db;
    const repoOptions = this.options;

    const readRow = async (): Promise<KvRow | undefined> => {
      const result = await db
        .prepare(
          "SELECT key, value, expires_at, version FROM kv WHERE key = ?",
        )
        .bind(strKey)
        .all();
      return result.results[0] as KvRow | undefined;
    };

    return {
      key,
      fullKey,
      async get(): Promise<TEntryVal | null> {
        const row = await readRow();
        if (!row) return null;
        const expiresAt = asNumber(row.expires_at);
        if (expiresAt !== null && Date.now() >= expiresAt) return null;
        return JSON.parse(row.value) as TEntryVal;
      },
      async update(
        updater: (current: TEntryVal | null) => TEntryVal | null,
        opts: KvOptions = {},
      ): Promise<KvUpdateResult<TEntryVal>> {
        const row = await readRow();
        const now = Date.now();
        const existed = row !== undefined;
        const expiresAt = row ? asNumber(row.expires_at) : null;
        const live = row !== undefined &&
          (expiresAt === null || now < expiresAt);
        const current = live ? JSON.parse(row.value) as TEntryVal : null;
        const version = row ? Number(row.version) : 0;

        const updated = updater(current);

        if (updated === null) {
          if (!existed) return { ok: true, val: null };
          const del = await db
            .prepare("DELETE FROM kv WHERE key = ? AND version = ?")
            .bind(strKey, version)
            .all();
          return { ok: (del.meta.changes ?? 0) > 0, val: null };
        }

        const expireIn = opts.expireIn ?? repoOptions.expireIn;
        const newExpiresAt = expireIn != null ? now + expireIn : null;
        const value = JSON.stringify(updated);

        if (!existed) {
          const insert = await db
            .prepare(
              "INSERT INTO kv (key, value, expires_at, version) VALUES (?, ?, ?, 0) ON CONFLICT(key) DO NOTHING",
            )
            .bind(strKey, value, newExpiresAt)
            .all();
          const ok = (insert.meta.changes ?? 0) > 0;
          return { ok, val: ok ? updated : current };
        }

        const update = await db
          .prepare(
            "UPDATE kv SET value = ?, expires_at = ?, version = version + 1 WHERE key = ? AND version = ?",
          )
          .bind(value, newExpiresAt, strKey, version)
          .all();
        const ok = (update.meta.changes ?? 0) > 0;
        return { ok, val: ok ? updated : current };
      },
    };
  }

  /** Every live entry under the prefix. */
  async *[Symbol.asyncIterator](): AsyncIterableIterator<
    KvEntryInterface<TVal, KvKeyPart, KvOptions>
  > {
    const prefixStr = encKey(this.prefix);
    const result = await this.db
      .prepare(
        "SELECT key FROM kv WHERE key LIKE ? ESCAPE '\\' AND (expires_at IS NULL OR expires_at > ?)",
      )
      .bind(escapeLike(prefixStr) + "%", Date.now())
      .all();
    for (const row of result.results as { key: string }[]) {
      const rest = row.key.slice(prefixStr.length);
      const slash = rest.indexOf("/");
      const token = slash === -1 ? rest : rest.slice(0, slash);
      if (!token) continue;
      yield this.entry(decPart(token));
    }
  }
}
