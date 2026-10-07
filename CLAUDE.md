# task-tree

チーム用タスク管理ツール。Remix v3 + Deno で書き、Cloudflare Workers + D1 で
動かす。認証は id.kbn.one（パスキー + DPoP セッション）。MCP サーバーを内蔵する
（予定。`docs/DESIGN.md`）。

設計の決定事項と未決の論点は `docs/DESIGN.md`。ここは「どう書くか」。

## 構造

`web/server/app.tsx` がアプリ本体で、ホストに依存しない。ホストごとの入口が
依存物（`AppDeps`: asset の解決、DPoP セッションの保存先）を組み立てて渡す。

- `web/client/` — ブラウザに渡るもの全て (routes / pages / islands / layout /
  static / sw.js)。`deno.ns` 無しで型チェックされる。`Deno.` を参照しない。
  - 島は `clientEntry(clientModule("islands/x.tsx", "X"), …)` と**安定した ID
    で自分を名乗る**（`client_entry.ts`）。`import.meta.url` は使わない — Worker
    にバンドルすると全モジュールが同じ URL になるため。
- `web/server/` — ルーター・API・config。
  - `app.tsx` — ルート定義 (`client/routes.ts`) をコントローラに配線する。
  - `router.tsx` — **Deno ホスト**（`deno serve` と テスト）。起動時に
    `@remix-kbn/assets-deno` で client を bundle し、`createLocalD1`
    (`node:sqlite`) を D1 の代わりにし、`/assets/*` `/static/*` `/sw.js`
    を自前で配信する。
  - `worker.ts` — **Cloudflare ホスト**。`deno task build` が書いた
    `web/dist/worker.js` が `wrangler.toml` の `main`。chunk / static / sw.js は
    Workers Static Assets（`web/dist/public/`）がプラットフォーム側で
    応答する。島の解決は `assets/manifest.json`（`assets.ts`）。
  - `build.ts` — `web/dist/public/` を書く。Worker 本体は `deno bundle`。
  - `lib/kv_d1.ts` — D1 binding 上の `KvRepo`（DPoP セッション用）。
  - `db.ts` — Deno ホストでの起動時マイグレーション。
- `db/migrations/` — `YYYYMMDDHHmmss_name/up.sql` + `down.sql`。本番 D1 へは
  `deno task db migrate --remote`（`@remix-kbn/data-table-d1/cli`）。
- `packages/` — `session-storage-kv`（`SessionStorage` を `KvRepo` で実装）、
  `remix-dpop-session-middleware`（DPoP セッション middleware）。
- `web/tests/` — lightpanda のブラウザ smoke（`deno task test:browser`）。

## 認証 (id.kbn.one)

- ブラウザ: `client/session.ts` が DPoP 鍵を作り、`${IDP_ORIGIN}/authorize` →
  戻って `${IDP_ORIGIN}/session` で `userId` を得る。
- サーバー → IdP: `lib/push/client.ts` が ES256 鍵で `private_key_jwt`
  クライアントアサーションを作り `POST /rp/notifications` に送る。公開鍵は
  `/.well-known/jwks.json` で配布（`lib/signing-key.ts`）。
- MCP: id.kbn.one が OAuth 2.1 認可サーバー。このアプリはリソースサーバーに
  なる（`docs/DESIGN.md` の 2）。

## 環境変数 / バインディング

`web/server/config.ts` に集約。Workers では `fetch(request, env)` の `env` を
`configure(env)` で渡し、Deno では `Deno.env` を読む。

- `IDP_ORIGIN` — IdP の origin（既定 `https://id.kbn.one`）。
- `RP_ORIGIN` — このアプリの公開 origin。クライアントアサーションの
  `clientId`。IdP の `AUTHORIZE_WHITELIST` に要登録。
- `RP_SIGNING_KEY_JWK` — ES256 秘密鍵 (JWK JSON)。**本番では必須**。無いと
  isolate ごとに鍵が生成され、JWKS が揃わない。`wrangler secret put`。
- `D1_LOCAL_PATH` — Deno ホスト専用。SQLite ファイル（既定 `data/app.db`、
  テストは `:memory:`）。
- バインディング（`wrangler.toml`）: `DB`（D1）、`ASSETS`（静的アセット）。

## 開発

```bash
deno task dev           # Deno ホストで開発サーバー (http://localhost:8000)
deno task check         # 型チェック + lint + fmt
deno task test          # ユニットテスト
deno task test:browser  # ブラウザ smoke テスト (lightpanda)
deno task build         # web/dist/ を生成 (public/ + worker.js)
deno task wrangler dev  # Worker としてローカル実行 (要 build)
deno task db migrate    # ローカル SQLite へマイグレーション (--remote で D1)
deno task deploy        # build && wrangler deploy
```

変更前後に `deno task check && deno task test && deno task build` を通す。
Worker 側の挙動を変えたら `deno task wrangler dev` でも確認する。

## コーディング規約

- Deno ファースト（Web API 優先、Node.js API は必要最小限）。`app.tsx` 以下は
  Deno にも Node にも Workers にも依存しない。
- TypeScript strict mode
- テストは `Deno.test()` + `@std/assert`
- ファイル名はスネークケース（例: `kv_d1.ts`）
- ページ/island の見た目は `@remix-run/component` の `css()` mixin と
  `web/client/tokens.ts` のトークンで書く (Tailwind / daisyUI は使わない)
- 追加した `import` はルート `deno.json` にだけ書く。メンバー側には書かない。
- 依存の更新で `minimumDependencyAge` に引っかかる `@kuboon` / `@remix-kbn` は
  `exclude` 済み。
