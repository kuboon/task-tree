# TEMPLATE.md — このテンプレから新しいアプリを作る手順

> このファイルは **テンプレから作った派生アプリ用の init 手順**。init
> が終わったら（ステージ 2 の後）
> このファイルごと削除する。テンプレ本体（`kuboon/deno-remix-tmpl`）を保守するときのルールは
> `CLAUDE.md`
> の「テンプレ本体を保守するとき」にあり、ここには書かない（削除されるため）。

派生アプリで作業するエージェントへ: `CLAUDE.md`
冒頭の判定で「派生アプリ」になり、かつこのファイルが 残っているなら、まず下の
**ステップ 0 → ステージ 1** を済ませてから機能開発に入る。 削除（ステージ
2）は実装が一通り終わってから。最初に消すと、あとで使いたくなったとき戻せない。

## ステップ 0: モードを選ぶ（最初の分かれ目）

**server API（`/api/*`、サーバー側の DB・秘密鍵）を使うか。**

|                           | static モード                         | server モード                                   |
| ------------------------- | ------------------------------------- | ----------------------------------------------- |
| 使う条件                  | server API を使わない                 | server API を使う                               |
| 配信                      | SSG → GitHub Pages                    | ライブサーバー（Deno Deploy または Cloudflare） |
| `@remix-kbn/ssg` のビルド | 使う（`deno task build`）             | 使わない（ライブラリとしては残る）              |
| Pages deploy              | する（`.github/workflows/pages.yml`） | **しない**                                      |
| デプロイ設定              | 不要                                  | **必要**（下記）                                |

DPoP セッション（サインイン）と push 通知の購読/テストは **ブラウザ → id.kbn.one
の直接通信**なので、 **static モードでもある程度動く**。static で動かないのは
server API に依存する機能だけ （サーバーからの通知送信 =
`[feature:server-send]`、Turso、DPoP 保護 API）。

### static モードにする

削除: `[feature:server-send]` `[feature:turso]`
`[feature:protected-api]`（下の機能表）。

残す: `.github/workflows/pages.yml`、`mise.toml` の `build`、`router.tsx` の
`fileServer` / `entryPoints`。

消した後に直す場所（scratch worktree で実際に消して `check` / `test` / `build`
を回して確かめた）:

- `routes.ts` から `jwks` と `api`（`post` の import
  も未使用になる）、`router.tsx` の対応する import / `createController` /
  `router.map`
- `push_card.tsx`:
  「サーバーから送信」ボタン、`onServerSend`、`sending`、`readBadgeCount`
  とバッジ入力、`routes` の import（残すと lint の未使用変数で落ちる）
- `pages/index.tsx` の「API エンドポイント」節（`routes.api`
  を参照している。ステージ 1 でトップページを置き換えるなら不要）
- `web/server/router.test.ts` の `/api/*` と `/.well-known/jwks.json` のテスト
- ルート `deno.json`: workspace から `packages/*`、`check` タスクの
  `deno check packages`、不要になった imports（`@kuboon/kv` `@libsql/client`
  `@remix-run/data-table` `@remix-kbn/data-table-sqlite-turso`
  `@remix-run/session` `jose`）

### server モードにする

削除（scratch worktree で実際に消して `check` / `test` と `deno serve` の smoke
を通した）:

- `.github/workflows/pages.yml`、`mise.toml` の `build` タスク
- ルートと `web/server/deno.json` の `build` タスク、`web/server/deno.json` の
  `permissions.build`
- `router.tsx`:
  `fileServer`（`githubPages()`）、`entryPoints`、`FileServerBehavior` /
  `githubPages` / `stripBase` の import、`ogPaths` の import（残すと lint
  の未使用変数で落ちる）
- **base（デプロイ先のサブパス）**: サブパスは Pages の PR
  プレビュー等で生じるもので、ライブサーバーは常にオリジンのルートで配信される。
  テンプレのままでも `dev` 権限が `BASE_URL` を ignore するので server
  では空だが、server モードでは仕組みごと消す:
  - `client/base.ts` を削除し、`base` の import をすべて外す（`routes.ts` は
    `route(base, {` → `route("", {`、`layout.tsx` は `BASE_META_NAME` の
    `<meta>` とそのコメント、`router.tsx` は `export { base }`）
  - `${base}` の前置を外す: `router.tsx`（`/static`、`/og`、`/sw.js`、
    `service-worker-allowed`）、`layout.tsx`（`app.css`、favicon）、`assets.ts`、
    `helper/panel.ts`、`lib/push/manager.ts`、`og/mod.ts`
  - `og/mod.ts`: `stripBase` の import と呼び出し（`serveOgImage` は
    `decodeURIComponent(pathname)`、`imagePath` は
    `decodeURIComponent(pagePath)` のまま使う）、`BASE_URL` を読む
    `siteUrl`（`ogImage` は `path` を返し、カードの footer は `location`）
  - `web/server/deno.json` の `dev` 権限の `BASE_URL`

`@remix-kbn/ssg` の **ビルドは使わない**が、パッケージ自体は残る: `router.tsx`
が `createFileTree`（`@remix-kbn/ssg/site`）を使っている。ssg
を依存から外すなら、これを自前に置き換える。

**デプロイ先（どちらか一つ）**

- **Deno Deploy（検証済み）**: エントリポイントを `web/server/router.tsx`
  にする。環境変数は `CLAUDE.md` の「環境変数」。ビルド時の `Deno.bundle`
  が起動時に走るので、実行環境に read 権限が要る。
- **Cloudflare（未検証・書き換えが必要）**: 現状のルーターは Deno
  専用の部分がある。
  - `Deno.bundle`（`@remix-kbn/assets-deno` が起動時に実行）→ Workers
    では動かない。事前ビルドした chunk
    を静的アセットとして配信し、`render({ assets })` に渡す asset server
    を自前で用意する。
  - `Deno.readTextFile`（`sw.js`、blog の `.md`、og のフォント）→
    ビルド時に埋め込む。
  - `createFileTree`（fs / `node:path`）→ Workers の static assets
    に置き換える。
  - `DenoKvRepo`（`middleware/dpop.ts`）→ `@kuboon/kv` の別実装（Turso
    など）に差し替える。
  - `wrangler` が `jsr:` / `npm:` specifier を解決できるかを先に確認する。
    `@remix-kbn` に Workers
    用アダプタは今のところ無い。実行して確かめていない設定は書かない。

## ステージ 1: 改変 init（使うコードを自分のアプリ用に書き換える）

- [ ] アプリ名: `CLAUDE.md` の見出し、`README.md`、`layout.tsx`
      のブランド名（`Remix3 on Deno Template`）、 `og/mod.ts` の `SITE_NAME`、各
      `pages/*.tsx` の `title`（`— Remix3 on Deno Template`）、`apm.yml`
- [ ] `client/idp.ts` の `IDP_ORIGIN`（サインインを使うなら）。`RP_ORIGIN` は
      IdP の `AUTHORIZE_WHITELIST` に登録が必要
- [ ] `<html lang>`（`layout.tsx`）。ページが日本語なら `ja`
- [ ] `client/static/favicon.svg`、`tokens.ts` / `static/app.css` の配色
- [ ] デモのリンク（`README.md`、`pages/index.tsx`）を自分のデプロイ先の URL に
- [ ] `pages/index.tsx` を自分のトップページに置き換える

## ステージ 2: cleanup（実装後に使わない機能を消す）

`[feature:名前]` は該当する配線行のコメントにある。`grep -rn "feature:blog" web`
でその機能の編集箇所が全部出る。 消した後は
`deno task check && deno task test && deno task build`（static）か
`deno task check && deno task test`
（server）が通ること。落ちるなら、消し残したものがリンクされている。

| 機能             | 消すファイル                                                                                                          | 配線（編集箇所）                                                                                                                                                                                                                                      | 依存する機能            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `hydration-demo` | `client/pages/hydration.tsx`、`client/islands/{counter,total,store}.ts(x)`、`web/tests/browser_hydration.test.ts`     | `routes.ts`、`router.tsx`、`layout.tsx` の nav                                                                                                                                                                                                        | —                       |
| `blog`           | `client/pages/blog/`、`server/blog/`、`client/islands/share.tsx`                                                      | `routes.ts`、`router.tsx`（`blogController`）、`layout.tsx` の nav、`app.css` の share 規則、`theme.ts` の `proseStyle`、`deno.json` の `@kuboon/md` `@kuboon/share-element` `@std/front-matter`                                                      | —                       |
| `showcase`       | `client/pages/showcase.tsx`、`client/islands/showcase/`、`server/versions.ts`                                         | `routes.ts`、`router.tsx`、`assets.ts` の `islands/showcase/*.tsx`、`layout.tsx` の nav、`deno.json` の `@remix-run/ui`、`router.test.ts` の `/showcase` 行                                                                                           | —                       |
| `fullscreen`     | `client/pages/fullscreen.tsx`、`client/islands/fullscreen-game.tsx`                                                   | `routes.ts`、`router.tsx`、`layout.tsx` の nav、`PageModule` の `viewport`/`bare`                                                                                                                                                                     | —                       |
| `spa`            | `client/pages/spa.tsx`、`client/spa/`                                                                                 | `routes.ts`、`router.tsx`（`spa` controller、`spaRuntime`）、`assets.ts` の `spa/entry.ts`、`runtime.ts`、`layout.tsx` の `documentLinks` と nav、`nav_auth.tsx` の `documentLinks`、`deno.json` の `@remix-run/spa`                                  | —                       |
| `helper`         | `client/helper/`                                                                                                      | `assets.ts` の `helper/panel.ts`、`runtime.ts` の `helper`、`layout.tsx` の Help ボタンと `ClientRuntime.helper`、`hydration.ts` の `installHelper()`、`spa/entry.ts`、`router.tsx` の `entryPoints` 末尾、`deno.json` の `@remix-kbn/helper-agent/*` | —                       |
| `signin`         | `client/islands/{nav_auth,signin_card}.tsx`、`client/session.ts`、`client/idp.ts`、`client/pages/my.tsx`              | `routes.ts` の `my`、`layout.tsx` の `<NavAuth>`、`router.tsx`、`deno.json` の `@kuboon/dpop`                                                                                                                                                         | `push` は signin に依存 |
| `push`           | `client/islands/push_card.tsx`、`client/lib/push/`、`client/sw.js`                                                    | `router.tsx` の `/sw.js` ルートと `entryPoints`、`pages/my.tsx` の `<PushCard>`                                                                                                                                                                       | `signin`                |
| `server-send`    | `server/lib/push/`、`server/lib/signing-key*`、`server/controllers/api/notify.ts`、`server/controllers/well_known.ts` | `routes.ts` の `jwks` と `api.notify`、`router.tsx`、`push_card.tsx` の「サーバーから送信」、`server/config.ts` の `RP_*`                                                                                                                             | `push`、server モード   |
| `turso`          | `server/lib/turso/`、`server/controllers/api/turso.ts`、`web/tests/turso_*`                                           | `routes.ts` の `api.turso`、`router.tsx`、`server/config.ts` の `TURSO_*`、`deno.json` の `@libsql/client` `@remix-run/data-table` `@remix-kbn/data-table-sqlite-turso`                                                                               | server モード           |
| `protected-api`  | `server/controllers/api/controller.ts`、`server/middleware/dpop.ts`、`packages/*`                                     | `routes.ts` の `api.protected`、`router.tsx`、`deno.json` の `@scope/*` と workspace                                                                                                                                                                  | server モード           |

`api` の中身が全部消えたら、`routes.ts` の `api` 自体と `router.tsx` の `api`
controller も消す。 `og/`（社会カード）は全ページが使うので残す。要らなければ
`ogImage()` の呼び出しと `og/` と `canvaskit-wasm` ごと消す。

### 最後の手順（init の締め）

- [ ] この `TEMPLATE.md` を削除する
- [ ] `CLAUDE.md`
      の「テンプレ本体を保守するとき」の節と、冒頭の「このリポジトリは何か」の判定を、
      自分のアプリの説明に置き換える（`TEMPLATE.md` が無く origin
      が違う状態が、そのまま「普通のアプリ」になる）
- [ ] `README.md` の `TEMPLATE.md` へのリンクを削除する
- [ ] `grep -rn "feature:" web` で残ったタグ付きコメントを整理する

## 覚えておくこと

- `@remix-run/render-middleware` と `@remix-run/spa` は 1.0.0 まで、
  `render-middleware@0.3.3`（`ui@0.11` と組み合わせると `<body>` が空で返る）と
  `spa@0.1.4`（takeover 後に `<body>` を空にする）を避けるため exact pin
  していた。1.0.0 では `^1.0.0` で、`/blog` の HTML に本文があり
  `deno task test:browser`
  （`web/tests/spa_navigation.test.ts`）が通ることを確認済み。上げるときは同じ
  二点を確認する。
- コンポーネントランタイムは `@remix-run/component`（`ui`
  ではない）。`@remix-run/ui` は headless プリミティブ（`/accordion` `/anchor`
  `/animation` `/combobox` `/listbox` `/menu` `/popover` `/select` `/tabs`
  `/toggle`）だけで、styled コンポーネントは無い。showcase はこの 10
  個すべてのデモを持ち、見た目は app 側の `css()`。`ui@0.11` にあった styled の
  Button / Input / Checkbox / Radio / Breadcrumbs は `0.12`
  で消えたので、デモも無い。
- SPA ページ（`@remix-run/spa`）はブラウザ側でシェルを描画し、island を hydrate
  できない。そのため `layout.tsx` は `documentLinks` のとき `NavAuth` の代わりに
  `/my` への素のリンクを出す。
- 追加した `import` は `deno.json`（ルート）にだけ書く。メンバー側の `deno.json`
  には書かない。
