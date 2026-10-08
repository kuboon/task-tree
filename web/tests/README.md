# web/tests — ブラウザ smoke

opt-in のブラウザテスト。デフォルトの `deno task test` には含まれず、
`deno task test:browser` で明示的に起動する。lightpanda バイナリは
npm:@lightpanda/browser の postinstall script でビルドされる。

## 前提

- ルーターは起動時に `Deno.bundle` で client を bundle する
  (`web/server/assets_deno.ts`) ので、事前のビルド手順は不要。
- DB はインメモリ (`D1_LOCAL_PATH=:memory:`)。

## カバー範囲

- `browser_home.test.ts` — `/` を開き、`globalThis.__rmxReady` が立つまで待って
  から、ナビバーの `NavAuth` 島が hydrate して有効な「Sign In」ボタンになる事を
  assert する。SSR → chunk の動的 import → `handle.update()` のフル経路を
  exercise する。
