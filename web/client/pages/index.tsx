import { css, type Handle } from "@remix-run/component";

import { routes } from "../routes.ts";
import { buttonStyle, cardStyle } from "../theme.ts";

export const title = "Task Tree";
export const description =
  "チームでタスクと依存関係を管理するツール。id.kbn.one でサインインし、MCP からも操作できる。";

const INTRO = "チームのタスクを、依存関係でつなげて管理するツールです。" +
  "「これが終わったら次はこれ」を結んでおくと、いま着手できるタスクがひと目でわかります。";

const FEATURES: [string, string][] = [
  [
    "依存ツリー",
    "着手できるタスクが左端に並び、その下・右へ「終わると着手できるようになるタスク」が続きます。",
  ],
  [
    "チーム",
    "招待リンクでメンバーを集め、タスクに担当者を付けられます。チームごとに表示名も変えられます。",
  ],
  ["MCP", "エージェント（Claude など）からも、ブラウザと同じ操作ができます。"],
];

const SIGN_IN =
  "サインインは id.kbn.one のパスキーで行います。チームの一覧と作成はマイページから。";

/** What the app is. Your teams live on the my page. */
export default function Home(handle: Handle<{ origin: string }>) {
  return () => (
    <>
      <h1>Task Tree</h1>
      <p>{INTRO}</p>

      <ul mix={featureListStyle}>
        {FEATURES.map(([name, text]) => (
          <li key={name}>
            <strong>{name}</strong>：{text}
          </li>
        ))}
      </ul>

      <p>{SIGN_IN}</p>
      <a mix={buttonStyle} href={routes.my.href()}>マイページへ</a>

      <section mix={cardStyle}>
        <h2>MCP</h2>
        <p>
          MCP クライアントにこの URL を登録してください。認証は id.kbn.one
          で行います。
        </p>
        <pre
          mix={preStyle}
        ><code>{`${handle.props.origin}/mcp`}</code></pre>
      </section>
    </>
  );
}

const featureListStyle = css({
  display: "grid",
  gap: "0.5rem",
  paddingInlineStart: "1.25rem",
});

const preStyle = css({ overflowX: "auto" });
