import type { Handle } from "@remix-run/component";

import { TeamBoard } from "../islands/team_board.tsx";

export const title = "チーム — Task Tree";
export const description = "チームのタスクと依存関係。";

export default function TeamPage(handle: Handle<{ teamId: string }>) {
  return () => <TeamBoard teamId={handle.props.teamId} />;
}
