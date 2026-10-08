import type { Handle } from "@remix-run/component";

import { JoinTeam } from "../islands/join_team.tsx";

export const title = "チームへの招待 — Task Tree";
export const description = "Task Tree のチームに招待されています。";

export default function JoinPage(handle: Handle<{ token: string }>) {
  return () => (
    <>
      <h1>チームへの招待</h1>
      <JoinTeam token={handle.props.token} />
    </>
  );
}
