# task-tree

チーム用のタスク管理ツール。Remix v3 + Deno で書き、Cloudflare Workers + D1 で
動かす。

- アカウント認証: [id.kbn.one](https://id.kbn.one)（パスキー + DPoP セッション）
- チームがタスクを複数持ち、タスク同士が依存関係を持つ
- MCP サーバーを内蔵し、エージェントからも同じデータを操作できる（予定）

設計メモは [docs/DESIGN.md](./docs/DESIGN.md)、開発のルールは
[CLAUDE.md](./CLAUDE.md) を参照。

## 開発

```bash
deno task dev           # 開発サーバー (http://localhost:8000、SQLite は data/app.db)
deno task check         # 型チェック + lint + fmt
deno task test          # ユニットテスト
deno task test:browser  # ブラウザ smoke テスト
```

## デプロイ (Cloudflare Workers + D1)

初回:

```bash
deno task wrangler login
deno task wrangler d1 create task-tree     # 出力された database_id を wrangler.toml へ
deno task db migrate --remote              # 要 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID / CLOUDFLARE_API_TOKEN
deno task wrangler secret put RP_SIGNING_KEY_JWK   # ES256 秘密鍵 (JWK JSON)
```

`wrangler.toml` の `RP_ORIGIN` を Worker の公開 origin にし、id.kbn.one の
`AUTHORIZE_WHITELIST` にそのホストを登録する。

以後:

```bash
deno task deploy        # build && wrangler deploy
deno task wrangler dev  # ローカルで Worker として確認 (要 deno task build)
```
