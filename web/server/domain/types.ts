/**
 * What the service hands back — the shapes the browser and MCP clients see.
 *
 * Plain JSON: times are epoch milliseconds, absent references are `null`.
 */

export const TASK_STATUSES = ["todo", "doing", "done"] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

export type TeamRole = "owner" | "member";

export interface Me {
  userId: string;
  nickname: string | null;
}

export interface TeamSummary {
  id: string;
  name: string;
  role: TeamRole;
  memberCount: number;
  createdAt: number;
}

export interface Member {
  userId: string;
  nickname: string | null;
  role: TeamRole;
  joinedAt: number;
}

export interface TeamDetail {
  id: string;
  name: string;
  createdAt: number;
  myRole: TeamRole;
  members: Member[];
}

export interface Invite {
  token: string;
  teamId: string;
  expiresAt: number;
}

export interface InvitePreview {
  teamId: string;
  teamName: string;
  expiresAt: number;
  alreadyMember: boolean;
}

export interface Task {
  id: string;
  teamId: string;
  /** The task this one breaks down; `null` at the top of the tree. */
  parentId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeId: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  /** Tasks that must be done before this one can start. */
  dependsOn: string[];
  /** Not done, and everything it depends on is done. */
  ready: boolean;
}

export interface TaskDetail extends Task {
  /** Tasks whose `parentId` is this one. */
  childIds: string[];
  /** Tasks that depend on this one. */
  dependentIds: string[];
}
