# task-tree

チーム用タスク管理ツール。Remix v3 + Deno で書き、Cloudflare Workers + D1 で
動かす（`https://task-tree.kbn.one`）。認証は id.kbn.one。ブラウザと MCP
の両方から同じ操作ができる。

何を作るか・なぜそうしたかは `docs/DESIGN.md`。ここは「どう書くか」。

## 構造

`web/server/app.tsx` がアプリ本体で、ホストに依存しない。ホストごとの入口が
依存物（`AppDeps`: asset の解決、D1 binding、認証）を組み立てて渡す。

- `web/server/domain/service.ts` — **業務ルールはすべてここ**（メンバーシップ、
  オーナー権限、親子と依存の循環禁止、着手可能の判定）。リクエストごとに
  `new Service(db, userId)`。テストは `service.test.ts`（ローカル D1）。
- `web/server/ops.ts` — **操作の表**（名前・説明・zod の入力・実行）。ブラウザ
  （`POST /api/ops/:name`、`controllers/ops.ts`）と MCP（`/mcp`、
  `controllers/mcp.ts`、1 操作 = 1 ツール）の両方がこれを呼ぶ。**操作を足すとき
  はここに足す**。片方だけに生やさない。
- `web/server/auth.ts` — ブラウザ（DPoP proof + IdP の `jws`）と MCP（IdP の
  OAuth アクセストークン）を検証して `userId` を得る。
- `web/server/lib/sql.ts` — D1 binding に SQL を直接投げる薄いヘルパ。データ
  アクセスは data-table のクエリビルダを使わず SQL で書く（再帰 CTE
  が要るため）。 data-table はマイグレーションにだけ使う。
- `web/client/` — ブラウザに渡るもの全て (routes / pages / islands / layout /
  static / sw.js)。`deno.ns` 無しで型チェックされる。`Deno.` を参照しない。
  - 島は `clientEntry(clientModule("islands/x.tsx", "X"), …)` と**安定した ID
    で自分を名乗る**（`client_entry.ts`）。`import.meta.url` は使わない — Worker
    にバンドルすると全モジュールが同じ URL になるため。
  - ページの GET には資格情報が無い（DPoP proof は fetch
    ごとに作る）ので、データは 島が `client/lib/ops.ts` の `callOp()`
    で取る。入出力の型は `server/ops.ts` から来る。
  - テキスト入力は `defaultValue`、select は `key` に現在値を含めて
    `<option selected>`（`value=` で縛らない）。
- `web/server/router.tsx` — **Deno ホスト**（`deno serve` と テスト）。起動時に
  `@remix-kbn/assets-deno` で client を bundle し、`createLocalD1`
  (`node:sqlite`) を D1 の代わりにし、`/assets/*` `/static/*` `/sw.js`
  を自前で配信する。
- `web/server/worker.ts` — **Cloudflare ホスト**。`deno task build` が書いた
  `web/dist/worker.js` が `wrangler.toml` の `main`。chunk / static / sw.js は
  Workers Static Assets（`web/dist/public/`）がプラットフォーム側で応答する。
  島の解決は `assets/manifest.json`（`assets.ts`）。
- `db/migrations/` — `YYYYMMDDHHmmss_name/up.sql` + `down.sql`。Deno ホストは
  起動時に自動適用（`db.ts`）。本番 D1 へは `deno task db migrate --remote`。
- `web/tests/` — lightpanda のブラウザ smoke（`deno task test:browser`）。

## 認証 (id.kbn.one)

- ブラウザ: `client/session.ts` が DPoP 鍵を作り、`${IDP_ORIGIN}/authorize` →
  戻って `${IDP_ORIGIN}/session` で `{ userId, jws, nickname }` を得る。API には
  `DPoP: <proof>` と `Authorization: DPoP <jws>` を付ける。proof の `htu` は
  公開 URL（`RP_ORIGIN` + パス）と照合する。
- MCP: id.kbn.one が OAuth 2.1 認可サーバー、このアプリが保護リソース
  （`/.well-known/oauth-protected-resource/mcp`）。アクセストークンの `aud` は
  `${RP_ORIGIN}/mcp`。
- サーバー → IdP: `lib/push/client.ts` が ES256 鍵で `private_key_jwt`
  クライアントアサーションを作り `POST /rp/notifications` に送る。公開鍵は
  `/.well-known/jwks.json`（`lib/signing-key.ts`。鍵は D1 の `kv` に保存）。

## 環境変数 / バインディング

`web/server/config.ts` に集約。Workers では `fetch(request, env)` の `env` を
`configure(env)` で渡し、Deno では `Deno.env` を読む。

- `IDP_ORIGIN` — IdP の origin（既定 `https://id.kbn.one`）。
- `RP_ORIGIN` — このアプリの公開
  origin（`https://task-tree.kbn.one`）。クライアント アサーションの
  `clientId`、MCP の resource、DPoP の `htu` 照合に使う。未設定なら リクエストの
  origin。
- `RP_SIGNING_KEY_JWK` — 任意。ES256 秘密鍵 (JWK JSON)。無ければ初回に生成して
  D1 の `kv` に保存し、全 isolate で共有する。
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
