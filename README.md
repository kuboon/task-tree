# task-tree

チーム用のタスク管理ツール。Remix v3 + Deno で書き、Cloudflare Workers + D1 で
動かす。公開 URL: <https://task-tree.kbn.one>

- アカウント認証: [id.kbn.one](https://id.kbn.one)（パスキー + DPoP セッション）
- チームがタスクを複数持ち、タスク同士が依存関係を持つ
- MCP サーバーを内蔵し、エージェントからもブラウザと同じ操作ができる

設計メモは [docs/DESIGN.md](./docs/DESIGN.md)、開発のルールは
[CLAUDE.md](./CLAUDE.md) を参照。

## 開発

```bash
deno task dev           # 開発サーバー (http://localhost:8000、SQLite は data/app.db)
deno task check         # 型チェック + lint + fmt
deno task test          # ユニットテスト
deno task test:browser  # ブラウザ smoke テスト
```

## MCP

MCP クライアントに `https://task-tree.kbn.one/mcp` を登録する（Streamable
HTTP）。認証は OAuth で、id.kbn.one のパスキーでログインする。例:

```bash
claude mcp add --transport http task-tree https://task-tree.kbn.one/mcp
```

## デプロイ (Cloudflare Workers + D1)

D1 (`task-tree`) は作成・マイグレーション済み（ID は `wrangler.toml`）。
`task-tree.kbn.one` はカスタムドメインとして `wrangler.toml` の `routes`
にある。

```bash
deno task wrangler login   # 初回のみ
deno task deploy           # build && wrangler deploy
```

新しいマイグレーションは `deno task db migrate --remote` で流す（要
`CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_D1_DATABASE_ID` /
`CLOUDFLARE_API_TOKEN`）。

ローカルで Worker として確かめる:

```bash
deno task build
deno task wrangler d1 execute task-tree --local --file db/migrations/<name>/up.sql
deno task wrangler dev
```
