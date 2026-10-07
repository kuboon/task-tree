# task-tree

チーム用のタスク管理ツール。Remix v3 + Deno。

- アカウント認証: [id.kbn.one](https://id.kbn.one)（パスキー + DPoP セッション）
- チームがタスクを複数持ち、タスク同士が依存関係を持つ
- MCP サーバーを内蔵し、エージェントからも同じデータを操作できる

設計メモは [docs/DESIGN.md](./docs/DESIGN.md)、開発のルールは
[CLAUDE.md](./CLAUDE.md) を参照。

## 開発

```bash
deno task dev           # 開発サーバー (http://localhost:8000)
deno task check         # 型チェック + lint + fmt
deno task test          # ユニットテスト
deno task test:browser  # ブラウザ smoke テスト
```
