# Task Tree — 設計メモ

チーム用タスク管理ツール。決まっていること、提案、未決の論点をここに集める。
決まったら「決定事項」へ移し、理由を一行残す。

## 決定事項

- **認証は id.kbn.one**。ブラウザはテンプレ既存の DPoP bind フロー
  （`/authorize` → `/session`）でサインインする。
- **server モード**（Deno Deploy）。MCP サーバーとチーム DB はサーバー API が
  要るので static（GitHub Pages）は捨てた。init の内容は `TEMPLATE.md`。
- **チーム → タスク（複数） → 依存関係**。最初に作る機能は「チーム作成」。
- **MCP サーバーを内蔵**する。

## 提案（未決。相談中）

### 1. ユーザー識別とサーバー側の認証

id.kbn.one の `/session` は `{ userId, jws }` を返す。`jws` は IdP が ES256 で
署名した JWT で、`cnf.jkt` にこのブラウザの DPoP 鍵 thumbprint が入っている
（[IdP README](https://github.com/kuboon/id.kbn.one)「RP 側での検証」）。

- ブラウザ → 自サーバーの API は、テンプレの DPoP ミドルウェア（proof 検証 →
  thumbprint）に加えて、**`jws` を IdP の JWKS で検証し `cnf.jkt` が proof の
  thumbprint と一致することを確認**して `userId` を得る。
  - 初回だけ `jws` を `Authorization: Bearer` で送り、DPoP セッションに `userId`
    を保存。以後は proof だけで良い（セッション TTL 内）。
- IdP が返すのは `userId` のみで表示名は無い。**表示名はこのアプリで各自が設定**
  する（`users` テーブル）。未設定なら `userId` の先頭数文字を表示。

### 2. MCP の認証: id.kbn.one を OAuth 2.1 認可サーバーとして使う

id.kbn.one は既に OAuth 2.1 AS を公開している
（`/.well-known/oauth-authorization-server`: PKCE S256、`scope=mcp`、CIMD 対応、
refresh token ローテーション）。アクセストークンは ES256 JWT で `aud` が
リソースサーバー（= このアプリ）、`sub` が `userId`。

このアプリ側（リソースサーバー）に要るもの:

- `GET /.well-known/oauth-protected-resource` —
  `authorization_servers:
  ["https://id.kbn.one"]`、`resource: RP_ORIGIN`
- `POST /mcp`（Streamable HTTP）— `Authorization: Bearer` を IdP の JWKS で検証
  （`iss`=id.kbn.one、`aud`=`RP_ORIGIN`）。無ければ 401 +
  `WWW-Authenticate:
  Bearer resource_metadata="…"`。
- `userId` = `payload.sub`。ブラウザと同じ `users` / `team_members` を参照する
  ので、**MCP から見える範囲は Web と同じ（所属チームのみ）**。

Claude Code / Claude.ai / Cursor 等の MCP クライアントはこの標準フロー （RFC
9728 → RFC 8414 → PKCE）をそのまま辿れるので、**トークンの手動発行や
独自ログインは不要**。IdP 側の `AUTHORIZE_WHITELIST` に `RP_ORIGIN` のホストが
要る（`kuboon-tokyo.deno.net` / `kbn.one` は例示されているので恐らく既に入って
いる）。

MCP 実装は `@modelcontextprotocol/sdk` の `McpServer` +
`WebStandardStreamableHTTPServerTransport`（fetch ベース）を fetch-router
のアクションから呼ぶ想定。Deno で動くことは実装時に確認する。

### 3. データストア: Turso (libSQL) + `@remix-run/data-table`

依存関係のグラフ（「このタスクを塞いでいるもの」「着手可能なタスク」）は JOIN
と再帰 CTE が書けるリレーショナル DB が楽。テンプレに Turso の配線と
非同期アダプタ（`@remix-kbn/data-table-sqlite-turso`）が既にある。
マイグレーションは `jsr:@remix-kbn/data-table-sqlite-turso/cli`。

対案は Deno KV（配線不要、ゼロ設定）。チーム単位でタスク全件を読んでメモリ上で
グラフを組む設計なら十分だが、横断検索やフィルタを足すたびに苦しくなる。

### 4. データモデル（案）

```
users         id (= IdP userId) PK, name, created_at
teams         id PK, name, created_by, created_at
team_members  team_id, user_id, role (owner|member), joined_at   PK(team_id,user_id)
team_invites  token PK, team_id, created_by, expires_at, max_uses?, uses
tasks         id PK, team_id, title, description, status (todo|doing|done),
              assignee_id?, parent_id?, created_by, created_at, updated_at
task_deps     task_id, depends_on_id   PK(task_id, depends_on_id)
```

- `task_deps` は **DAG**。挿入時に循環を拒否する（再帰 CTE で到達判定）。
- `parent_id` は「分解（サブタスク）」用。依存関係とは別物。
  要らなければ落とす（論点 Q1）。
- 「着手可能」= `status != done` かつ `depends_on` が全部 `done`。

### 5. チームへの参加

**招待リンク**（`team_invites.token`、期限付き）を提案。IdP には「ユーザー
検索」が無く `userId` は人間が読める ID ではないので、ID 指定で追加する UI は
使いにくい。owner がリンクを発行 → 受け取った人がサインインして開くと参加。

### 6. 画面（最小）

- `/` — 説明 + サインイン導線
- `/my` — 自分の表示名、所属チーム一覧、チーム作成
- `/teams/:id` — タスク一覧（着手可能 / 進行中 / 完了）、タスク作成、依存の編集
- `/teams/:id/tasks/:taskId` — 詳細、依存の前後
- `/teams/:id/invite` — 招待リンク発行 / `/join/:token` — 参加

### 7. MCP ツール（最小）

`list_teams` / `list_tasks(team, filter)` / `create_task` / `update_task` /
`add_dependency` / `remove_dependency` / `ready_tasks(team)`。
チーム作成・招待は Web だけにする（破壊的・管理系の操作は人間が UI で行う）。

### 8. 通知（後回し）

テンプレの push 連携（`POST /rp/notifications`）をそのまま使い、
「自分がアサインされた」「塞いでいたタスクが完了して着手可能になった」を
通知する。初期スコープ外。

## 未決の論点

- **Q1** 「task-tree」の tree は、親子（サブタスク分解）か、依存関係のグラフか、
  両方か。提案は両方だが、まず依存関係だけでも成立する。
- **Q2** DB は Turso か Deno KV か。提案は Turso。
- **Q3** メンバー追加は招待リンクで良いか。
- **Q4** タスクの属性はこれで足りるか（期限・優先度・ラベル・担当者の要否）。
- **Q5** MCP ツールの範囲（読み取りだけか、書き込みも含むか）。提案は上記 7。
- **Q6** テンプレのデモ機能（blog / showcase / spa / fullscreen / hydration /
  helper）はいつ消すか。提案は「チーム作成」が入った直後に一括で消す。
- **Q7** デプロイ先の URL（`RP_ORIGIN`）。IdP の whitelist に入れる必要がある。

## 実装順（案）

1. ユーザー: `jws` 検証ミドルウェア、`users` テーブル、表示名の設定（`/my`）
2. チーム作成 / 一覧 / 招待リンク
3. タスク CRUD + 依存関係（DAG 制約）+ 着手可能ビュー
4. MCP（`/.well-known/oauth-protected-resource`、`/mcp`、ツール）
5. テンプレのデモ機能の削除、`TEMPLATE.md` 削除、`CLAUDE.md` 書き換え
6. 通知
