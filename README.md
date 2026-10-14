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

D1 (`task-tree`) は作成・マイグレーション済み（ID は `cloudflare.config.ts`）。
`task-tree.kbn.one` はカスタムドメインとして `cloudflare.config.ts` の `domains`
にある。設定は wrangler ではなく `cf` CLI と `cloudflare.config.ts`。

```bash
deno task cf auth login   # 初回のみ
deno task deploy     # build && cf deploy
```

新しいマイグレーションは `deno task db migrate --remote` で流す。D1 の
`database_id` は `cloudflare.config.ts` から読む（`--database-id` /
`$CLOUDFLARE_D1_DATABASE_ID` を渡せばそちらが優先）。`--preview`
を付けるとプレビュー用の D1 (`task-tree-preview`) が対象になる。

```bash
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_API_TOKEN=...        # D1 edit 権限
deno task db migrate --remote
deno task db migrate --remote --preview
```

名前から ID を調べたいときは `deno task cf d1 list`。

ローカルで Worker として確かめる:

```bash
deno task build
deno task cf dev
```
