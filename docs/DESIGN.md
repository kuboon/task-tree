# Task Tree — 設計メモ

チーム用タスク管理ツール。決まったことと、その理由をここに残す。

## 決定事項

- **認証は id.kbn.one**。ブラウザはパスキー + DPoP セッション、MCP は id.kbn.one
  の OAuth 2.1。どちらも同じ `userId`（IdP の `sub`）になる。
- **Cloudflare Workers + D1**、公開 URL は `https://task-tree.kbn.one`。開発と
  テストは Deno ホスト（`web/server/router.tsx`、ローカル SQLite）。
- **チーム → タスク**。タスクの構造は **依存のグラフ**（`dependsOn`、先に終わる
  べきタスク）だけ。循環は拒否する。親子関係（分解の木）は持たない。
- **チームページの並び**:
  着手可能なタスクを左端に置き、その下・右へ「終わると着手
  できるようになるタスク」を展開するツリー表示（開閉可能）。複数の依存先を持つ
  タスクは一番遠い依存先の下に置き、ほかの依存先の下には「再掲」として出す。
- **タスクの属性**: タイトル・説明・状態（未着手 / 進行中 / 完了）・担当者
  （nullable、チームのメンバーから）。優先度・ラベル・期限は持たない。
- **着手可能（ready）** = 完了していない、かつ依存先がすべて完了。
- **メンバー追加は招待リンク**（7 日有効、何人でも使える）。招待リンクは
  メンバーなら誰でも作れる。
- **役割はオーナーとメンバーの 2 つ**。チーム作成者がオーナー。オーナーだけが
  チーム名変更・チーム削除・メンバーを外す、をできる。オーナーは抜けられない
  （抜けるならチームを削除）。抜けた / 外された人の担当は外れる。
- **MCP
  は書き込みも含め、ブラウザでできる操作すべて**。操作の表（`web/server/ops.ts`）
  を一つ持ち、ブラウザ API と MCP ツールの両方がそれを呼ぶので、片方だけに操作が
  増えることが構造上起きない。
- **名前はチームごと**。デフォルトは id.kbn.one
  のニックネーム（サインインのたびに `users` に記録。MCP
  のアクセストークンにはニックネームが無いので上書きしない）。
  チームごとの別名（`team_members.nickname`）があればそれを使う。別名はチーム画面の
  メンバー欄で変えられ、招待から参加するときにも決められる。マイページでは編集しない。
- **RP 署名鍵**（`/.well-known/jwks.json`、サーバー起点の push 通知用）は、
  `RP_SIGNING_KEY_JWK` が無ければ初回に生成して D1 の `kv` に保存し、全 isolate
  で 共有する。

## 認証の流れ

### ブラウザ

1. ナビの「Sign In」→
   `id.kbn.one/authorize?dpop_jkt=…&redirect_uri=<今のページ>`
   （招待リンクから来ても、サインイン後に同じページへ戻る）。
2. 戻ったら `GET id.kbn.one/session`（DPoP）→ `{ userId, jws, nickname }`。
   `jws` は IdP の ES256 署名で `sub` と `cnf.jkt`（このブラウザの鍵）を含む、1
   時間有効。
3. このアプリの API は `POST /api/ops/:name` に `DPoP: <proof>` と
   `Authorization: DPoP <jws>` を付ける。サーバー（`web/server/auth.ts`）は
   proof の検証（`htu` は公開 URL と照合、`jti` の再利用拒否）、`jws` の署名検証
   （IdP の JWKS）、`cnf.jkt` と proof
   の鍵の一致を確かめる。セッションは持たない。

### MCP

1. MCP クライアントが `https://task-tree.kbn.one/mcp` に繋ぐ → 401 +
   `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp"`。
2. メタデータ（RFC 9728）の `authorization_servers` は `https://id.kbn.one`。
   クライアントは id.kbn.one で PKCE + CIMD の認可を行う（パスキーでログイン）。
3. 返ってくるアクセストークン（`at+jwt`、`aud` = MCP の URL、`scope` に
   `mcp`）を `Authorization: Bearer` で送る。

## データモデル（`db/migrations/`）

```
users         id (= IdP userId) PK, nickname, updated_at
teams         id PK, name, created_by, created_at
team_members  team_id, user_id, role (owner|member), joined_at,
              nickname?（このチームでの名前。NULL なら IdP のニックネーム）   PK(team_id, user_id)
team_invites  token PK, team_id, created_by, created_at, expires_at
tasks         id PK, team_id, title, description, status (todo|doing|done),
              assignee_id?, created_by, created_at, updated_at
task_deps     task_id, depends_on_id   PK(task_id, depends_on_id)
kv            DPoP 時代の名残の KV。今は RP 署名鍵だけ
```

- ID は ULID、時刻は epoch ミリ秒。
- 循環の検出は再帰 CTE（`web/server/domain/service.ts`）。
- タスクを消すと、子は消したタスクの親に付け替わる。依存の辺は一緒に消える。
- チームを消すと、タスク・メンバー・招待も FK の `ON DELETE CASCADE` で消える。

## 操作（ブラウザ API = MCP ツール）

`whoami` / `list_teams` / `create_team` / `get_team` / `rename_team` /
`set_team_nickname` / `delete_team` / `leave_team` / `remove_member` /
`create_invite` / `get_invite` / `accept_invite` / `list_tasks` / `get_task` /
`create_task` / `update_task` / `delete_task` / `add_dependency` /
`remove_dependency`

## 画面

- `/` — 所属チームの一覧とチーム作成、MCP の URL
- `/teams/:teamId` —
  依存ツリー（左端が着手可能、下・右へ「終わると着手できるように
  なるタスク」。開閉可能、複数の依存先を持つタスクは一番遠い依存先の下に置き、他は
  「再掲」）。行ごとに状態（押すと次へ）・担当・着手可能 / ほか N 件待ち。選んだ
  タスクの前後のつながりを強調し、右の詳細で編集・状態・担当・依存の追加/削除・
  削除。「自分の担当を強調」「すべて畳む / 開く」「完了 N
  件を表示」。メンバー・この
  チームでの自分の名前・招待リンク。タブのタイトルは「チーム名 - Task Tree」。
  このページだけ本文を広く使う（ページの `wide`）
- `/join/:token` — 招待の受諾（このチームでの名前を決めてから参加）
- `/my` — push 通知の設定（デバイスの登録・テスト・解除）とサインアウト

## これから

- **通知**: 自分が担当になった、待っていたタスクが着手可能になった、を push で
  知らせる（`lib/push/client.ts` は配線済み）。
- **リアルタイム更新**: いまは操作のたびに再読込。複数人で同時に触るなら Durable
  Objects か polling。
- **タスクの並び順**: いまは作成順。手で並べ替えたくなったら `position` を足す。
