import { css, type Handle } from "@remix-run/component";

import { TeamsHome } from "../islands/teams_home.tsx";
import { cardStyle } from "../theme.ts";

export const title = "Task Tree";
export const description =
  "チームでタスクと依存関係を管理するツール。id.kbn.one でサインインし、MCP からも操作できる。";

export default function Home(handle: Handle<{ origin: string }>) {
  return () => (
    <>
      <h1>Task Tree</h1>
      <p>
        チーム用のタスク管理。タスクを親子に分解し、タスク同士の依存関係を結ぶと、
        いま着手できるタスクがわかります。
      </p>
      <TeamsHome />
      <section mix={cardStyle}>
        <h2>MCP</h2>
        <p>
          エージェント（Claude など）からも、ブラウザと同じ操作ができます。MCP
          クライアントにこの URL を登録してください。認証は id.kbn.one
          で行います。
        </p>
        <pre
          mix={preStyle}
        ><code>{`${handle.props.origin}/mcp`}</code></pre>
      </section>
    </>
  );
}

const preStyle = css({ overflowX: "auto" });
