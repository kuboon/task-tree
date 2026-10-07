import { css, type Handle } from "@remix-run/component";

import { routes } from "../routes.ts";
import { cardStyle } from "../theme.ts";

export const title = "Task Tree";
export const description =
  "チームでタスクと依存関係を管理するツール。id.kbn.one でサインインし、MCP からも操作できる。";

/** The shell places the sign-in island, so every page boots the runtime. */
export const hydrate = true;

export default function Home(_handle: Handle) {
  return () => (
    <>
      <h1>Task Tree</h1>
      <p>
        チーム用のタスク管理ツール。チームを作り、タスクを登録し、タスク同士の
        依存関係を結ぶ。ブラウザからも、MCP
        クライアントからも同じデータを扱える。
      </p>

      <section mix={cardStyle}>
        <h2>はじめかた</h2>
        <ol mix={listStyle}>
          <li>ナビバー右上の「Sign In」で id.kbn.one にサインインする</li>
          <li>チームを作る（または招待リンクから参加する）</li>
          <li>タスクを登録し、依存関係を結ぶ</li>
        </ol>
        <p>
          <a href={routes.my.href()}>マイページ →</a>
        </p>
      </section>
    </>
  );
}

const listStyle = css({
  paddingLeft: "1.1rem",
  "& li": { marginBlock: "0.4rem" },
});
