import type { Handle } from "@remix-run/component";

import { TeamBoard } from "../islands/team_board.tsx";

/** Until the team loads; `TeamBoard` then sets `<チーム名> - Task Tree`. */
export const title = "Task Tree";
export const description = "チームのタスクと依存関係。";
/** The tree and the detail panel sit side by side. */
export const wide = true;

export default function TeamPage(handle: Handle<{ teamId: string }>) {
  return () => <TeamBoard teamId={handle.props.teamId} />;
}
