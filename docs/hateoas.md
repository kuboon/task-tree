# HATEOAS 仕様メモと既存実装の棚卸し

> 調査日: 2026-10-06
>
> **調査の制約**: この調査環境ではネットワーク egress が制限されており、Fielding
> 本人の記事・RFC 原文・Wikipedia・HAL/JSON:API
> の仕様ページに直接アクセスできなかった。 そのため「1. 仕様」は、Web
> 検索で得られた要約と既知の一次資料の内容にもとづいて書いている。
> 引用や細部（特に RFC の節番号）は、下の参考リンクで原文を確認してほしい。

## 1. HATEOAS とは

**HATEOAS = Hypermedia As The Engine Of Application State**
（アプリケーション状態のエンジンとしてのハイパーメディア）。

REST アーキテクチャスタイル（Roy Fielding, 博士論文 2000）の **Uniform Interface
制約** を構成する 4 つの要素のうち、最後のものにあたる。

1. リソースの識別（URI）
2. 表現を通じたリソースの操作
3. 自己記述的メッセージ
4. **アプリケーション状態のエンジンとしてのハイパーメディア**

### 1.1 中心となる考え方

- クライアントは API の入口となる
  URI（と、メディアタイプの理解）だけを知っている。
- サーバーが返す
  **表現（レスポンス）の中に、次に取れる遷移（リンク・フォーム・アクション）が含まれる**。
- クライアントは URI を組み立てず、**サーバーが提示した選択肢から選んで辿る**。
  Web ブラウザで人間がリンクを辿るのと同じ動作を、プログラムでも行う。
- その結果、サーバーは URI
  設計や状態遷移を変えても、クライアントを壊さずに進化させられる（疎結合）。

### 1.2 Fielding の「REST API はハイパーテキスト駆動でなければならない」(2008)

Fielding が、「REST」を名乗りながら HATEOAS を満たさない API
に対して出した声明。要点は次のとおり。

- ハイパーテキストで駆動されていない API は REST API ではない。「例外なし」。
- アプリケーションの状態遷移は、サーバーが直前に返した表現の中の選択肢から
  クライアントが選ぶことで **のみ** 駆動される。
- API の作者は、プロトコル（HTTP）ではなく **メディアタイプとリンク関係 (link
  relation)** の定義に力を注ぐべき。
- クライアントは初期 URI
  以外の固定的な知識（リソース名・階層の事前知識）に依存してはならない。
  - 「`/orders/{id}` の形式を知っている」というドキュメント頼みの組み立ては
    out-of-band な結合であり、REST ではない。
- 型は **メディアタイプ**
  で表し、メディアタイプ仕様がクライアントの処理モデルを定める。

### 1.3 Richardson Maturity Model

Leonard Richardson が示し、Martin Fowler が広めた、Web API の成熟度の 4 段階。

| Level | 内容                                                              |
| ----- | ----------------------------------------------------------------- |
| 0     | 単一エンドポイントに HTTP をトンネルする（POX / RPC 風）          |
| 1     | **リソース** ごとに URI を持つ                                    |
| 2     | **HTTP メソッド・ステータスコード** を意味どおりに使う            |
| 3     | **ハイパーメディアコントロール** (= HATEOAS) をレスポンスに含める |

Fielding の立場では Level 3 に達して初めて REST。実務では Level 2 止まりの API
が大多数で、
「どこまでやるか」はクライアントの性質（自社専用か、第三者が長期に使うか）で決める。

## 2. 仕様として何を決めるか

HATEOAS 自体は **アーキテクチャ制約** であり、単一のワイヤフォーマットを規定する
RFC ではない。 実装時には次の 3 つを決める。

1. **メディアタイプ** —
   レスポンスがどんなハイパーメディアを含むか、クライアントがそれをどう解釈するか。
2. **リンク関係 (link relation type)** — リンクの意味。IANA 登録済みの値か、URI
   形式の拡張関係を使う。
3. **遷移の記述方法** — GET
   で辿るリンクだけか、メソッド・入力フィールドまで記述するか。

### 2.1 Web Linking — RFC 8288

リンクの共通モデル。HATEOAS のための **土台になる標準**。

- リンク = **コンテキスト** + **関係型 (rel)** + **ターゲット** + 任意の
  **ターゲット属性**。
- HTTP では `Link` ヘッダで表現できる:

  ```http
  Link: </orders/42>; rel="self", </orders/42/payment>; rel="payment"; title="Pay"
  ```

- HTML では `<a href>` / `<link rel>` が同じモデルに対応する。
- `rel` は IANA の Link Relation Types レジストリに登録された値（`self`, `next`,
  `prev`, `collection`, `item`, `related`, …）か、 URI 形式の拡張関係型を使う。
- **メソッド（POST など）は RFC 8288 の範囲外**。`method`
  のような属性を足すのは独自規約になり、汎用クライアントには通じない。

### 2.2 JSON 向けハイパーメディアフォーマット

| フォーマット        | メディアタイプ                    | 特徴                                                                                   |
| ------------------- | --------------------------------- | -------------------------------------------------------------------------------------- |
| **HAL**             | `application/hal+json`            | 最小。`_links`（rel をキーとするオブジェクト）と `_embedded` だけ。アクション記述なし  |
| **JSON:API**        | `application/vnd.api+json`        | ドキュメント全体を規定（`data` / `relationships` / `links` / `included` / エラー形式） |
| **Siren**           | `application/vnd.siren+json`      | `links` に加え **`actions`**（メソッド・入力フィールド付き）を持つ                     |
| **Collection+JSON** | `application/vnd.collection+json` | コレクション操作と検索テンプレートに特化                                               |
| **JSON-LD / Hydra** | `application/ld+json`             | セマンティック Web 系。API 語彙を記述できる                                            |

HAL の例:

```json
{
  "id": 42,
  "status": "pending",
  "_links": {
    "self": { "href": "/orders/42" },
    "payment": { "href": "/orders/42/payment" },
    "cancel": { "href": "/orders/42" }
  }
}
```

状態が変わるとリンクも変わる（支払い後は `payment` が消え、`receipt`
が現れる、など）のが
ポイント。**リンクの有無がクライアントに「いま何ができるか」を伝える**。

### 2.3 HTML そのもの

HTML は元祖のハイパーメディア。`<a>`（辿る）と `<form>`（method / action /
入力フィールドを記述）で、 リンクと「アクション」の両方を表現できる。htmx
等の「HTML over the wire」は、 HATEOAS を JSON ではなく HTML
で満たす実践と言える。

### 2.4 実装チェックリスト

- [ ] 入口 URI（API ルート）が 1 つあり、そこから主要な遷移を辿れる
- [ ] 各レスポンスに `self` と、現在の状態で **可能な** 遷移だけが含まれる
- [ ] クライアントは URI を組み立てず、`rel` で遷移先を選ぶ
- [ ] `rel` は IANA 登録値か URI 拡張。独自のものは仕様として文書化する
- [ ] メディアタイプを明示し（`Content-Type`）、その仕様がクライアントの処理を定める
- [ ] 状態変更に使うメソッド・入力は、レスポンス内（Siren の `actions` / HTML の
      `<form>` 等）か、 rel の定義側で示す
- [ ] ページネーション・コレクションは `next` / `prev` / `collection` / `item`
      で辿れる
- [ ] 権限のない操作のリンクは出さない（認可自体は必ずサーバーで強制する）

### 2.5 よくある誤解・トレードオフ

- 「JSON に `href` を足せば HATEOAS」ではない。クライアントが
  **実際にそれを辿る** ことが前提。
- URI を事前に知っている SPA /
  自社モバイルアプリには、効果が薄くコストが高いことが多い。
- 共通のクライアントライブラリ（ブラウザのような汎用クライアント）が存在しないと、
  メリットを回収しにくい。

## 3. 既存実装のリスト

対象: このリポジトリ（`kuboon/hateoas`）。中身は Remix v3 + Deno
のテンプレート（`deno-remix-tmpl`）で、 **HATEOAS 専用の実装（HAL
等のハイパーメディア JSON や `Link` ヘッダ）はまだ存在しない**。 下記は、HATEOAS
の観点で関連する既存要素の棚卸し。

### 3.1 リポジトリ構成

| パス                                      | 内容                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `packages/remix-dpop-session-middleware/` | DPoP (RFC 9449) セッション middleware（fetch-router 用）             |
| `packages/session-storage-kv/`            | `@remix-run/session` の `SessionStorage` を `KvRepo` で実装          |
| `web/client/`                             | ブラウザに渡るもの全て（routes / pages / islands / layout / static） |
| `web/server/`                             | router・asset bundler・API・config・OG 画像                          |
| `web/tests/`                              | ブラウザ smoke テスト（lightpanda）                                  |
| `.github/workflows/`                      | `pages.yml`（Pages デプロイ）, `test.yml`                            |

### 3.2 HATEOAS に関連する既存要素

| 要素                                 | 場所                                                       | HATEOAS との関係                                                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ルート定義の一元化**               | `web/client/routes.ts`                                     | 全 URL を 1 か所で定義し、`routes.my.href()` のように **リンクをルート定義から生成**。「URI をクライアントが手で組み立てない」ための土台として再利用できる。 |
| **ルート → コントローラの対応付け**  | `web/server/router.tsx` (`router.map`)                     | すべてのルートにアクションが必須（欠落するとビルド時に例外）。レスポンスに載せるリンクの網羅性を保ちやすい。                                                 |
| **HTML ページ（リンク / フォーム）** | `web/client/pages/*`, `layout.tsx`                         | HTML レスポンスはもともとハイパーメディア。`index` から各ページへ遷移。                                                                                      |
| **リンクを辿る静的クロール**         | `@remix-kbn/ssg` + `router.tsx` の `entryPoints`           | 入口 `/` から **リンクだけを辿って** 全ページを生成する。ハイパーテキスト駆動の「クライアント」の実例。`/api/*` はリンクされないので静的化されない。         |
| **`.well-known` ディスカバリ**       | `GET /.well-known/jwks.json` (`controllers/well_known.ts`) | 既知 URI による発見（RFC 8615）。HATEOAS の「入口」とは別だが、機械可読なディスカバリの先例。                                                                |
| **SPA 内ナビゲーション**             | `web/client/spa/*`, `routes.spa.show`                      | クライアントルーターが URL を解釈。リンク主導の遷移だが、遷移先は事前知識。                                                                                  |
| **ブログ記事**                       | `web/server/blog/*`, `routes.blog`                         | `index`（一覧）→ `show`（個別）の階層。`collection`/`item` 相当の構造。                                                                                      |
| **`<link rel>` の使用**              | `layout.tsx`                                               | `stylesheet` / `icon` / `modulepreload` のみ。API 向け rel は無い。                                                                                          |

### 3.3 JSON API エンドポイント（現状はハイパーメディア無し）

いずれも `/api/*` 配下で **サーバー専用**（静的ビルドには出さない）。

| エンドポイント               | 実装                            | 認証         | 現状のレスポンス                       | HATEOAS 化の余地                        |
| ---------------------------- | ------------------------------- | ------------ | -------------------------------------- | --------------------------------------- |
| `GET /api/protected`         | `controllers/api/controller.ts` | DPoP         | `thumbprint`, `sessionData`, `message` | `self`、更新用リンク（POST 先）を返せる |
| `POST /api/protected`        | 同上                            | DPoP         | 更新後のセッション                     | `self` を返す                           |
| `POST /api/notify`           | `controllers/api/notify.ts`     | なし（デモ） | 通知送信結果                           | 結果リソースへのリンク等                |
| `GET /api/turso`             | `controllers/api/turso.ts`      | なし         | 累計 visit 数                          | `self` 等                               |
| `GET /.well-known/jwks.json` | `controllers/well_known.ts`     | なし         | `application/jwk-set+json`             | 対象外（仕様で形式が決まっている）      |

エラーは `Response.json({ message }, { status })` の素朴な形式。

### 3.4 周辺の基盤（再利用できるもの）

- `@remix-run/fetch-router` — 型付きルート、`createController`、ミドルウェア。
- DPoP セッション — 状態を持つ API のアクセス制御（リンクの出し分けに使える）。
- `KvRepo`（`@kuboon/kv`）— memory / Deno KV / Turso。リソース状態の保存先。
- 2 つのデプロイモード — static（SSG → Pages）と server（Deno Deploy）。HATEOAS
  API は server 側に置く。

### 3.5 ギャップ（未実装）

- ハイパーメディア形式（HAL / Siren / JSON:API 等）のレスポンス
- `Link` ヘッダ（RFC 8288）の付与・パース
- API ルート（入口）リソース — 現状は `/api/*` の URL を事前に知る必要がある
- カスタム `rel` の定義文書と、メディアタイプの選定
- 状態に応じてリンクを出し分けるロジック
- 汎用ハイパーメディアクライアント（リンクを辿る側）
- HATEOAS 用のテスト

## 4. 次の一歩の提案

1. **メディアタイプを決める**: 最小は
   HAL。アクション（メソッド/入力）まで要るなら Siren。
2. `routes.ts` の `href()` を使って、**リンク生成ヘルパ**（`self` +
   状態別リンク）を作る。
3. `/api` を **入口リソース** にし、`/api/protected` などへの `rel`
   付きリンクを返す。
4. `Link` ヘッダと本文リンクの両方を、テスト（`Deno.test` +
   `@std/assert`）で検証する。
5. static モードに `/api/*` を出さない既存方針（`CLAUDE.md`）を崩さない。

## 参考リンク

### 一次資料

- Roy T. Fielding, _Architectural Styles and the Design of Network-based
  Software Architectures_ (2000), Chapter 5 — REST:
  <https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm>
- Roy T. Fielding, _REST APIs must be hypertext-driven_ (2008):
  <https://roy.gbiv.com/untangled/2008/rest-apis-must-be-hypertext-driven>
- RFC 8288 — _Web Linking_: <https://www.rfc-editor.org/rfc/rfc8288>
- IANA Link Relations レジストリ:
  <https://www.iana.org/assignments/link-relations/link-relations.xhtml>
- RFC 8615 — _Well-Known URIs_: <https://www.rfc-editor.org/rfc/rfc8615>
- RFC 9110 — _HTTP Semantics_: <https://www.rfc-editor.org/rfc/rfc9110>

### 解説

- Martin Fowler, _Richardson Maturity Model_:
  <https://martinfowler.com/articles/richardsonMaturityModel.html>
- Wikipedia, _HATEOAS_: <https://en.wikipedia.org/wiki/HATEOAS>
- Django REST framework, _REST, Hypermedia & HATEOAS_:
  <https://www.django-rest-framework.org/topics/rest-hypermedia-hateoas/>
- BCS, _Hypermedia controls in REST — the final hurdle_:
  <https://www.bcs.org/articles-opinion-and-research/hypermedia-controls-in-rest-the-final-hurdle>
- Rahul Nath, _Not All That Returns JSON is RESTful: Understanding HATEOAS_:
  <https://www.rahulpnath.com/blog/not-all-that-returns-json-is-restful-understanding-hateoas/>
- Code Maze, _Implementing HATEOAS in ASP.NET Core Web API_:
  <https://code-maze.com/hateoas-aspnet-core-web-api/>
- OneUptime, _How to Implement HATEOAS in REST APIs_:
  <https://oneuptime.com/blog/post/2026-01-26-rest-api-hateoas/view>

### フォーマット仕様

- HAL: <https://stateless.group/hal_specification.html>
- JSON:API: <https://jsonapi.org/format/>
- Siren: <https://github.com/kevinswiber/siren>
- Collection+JSON: <http://amundsen.com/media-types/collection/>
- Hydra: <https://www.hydra-cg.com/spec/latest/core/>
