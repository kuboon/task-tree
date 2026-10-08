/** Styles and helpers the task islands share. */

import { css } from "@remix-run/component";

import type { TaskStatus } from "../../server/domain/types.ts";
import { color, radius } from "../tokens.ts";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "未着手",
  doing: "進行中",
  done: "完了",
};

/** How to show a user: their nickname, else the start of their id. */
export function userLabel(
  member: { userId: string; nickname: string | null } | undefined,
  fallbackId?: string | null,
): string {
  if (member?.nickname) return member.nickname;
  const id = member?.userId ?? fallbackId ?? "";
  return id ? `${id.slice(0, 8)}…` : "—";
}

export const mutedStyle = css({ color: color.muted, fontSize: "0.9rem" });

export const rowStyle = css({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "0.5rem",
});

export const inputStyle = css({
  font: "inherit",
  padding: "0.4rem 0.6rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  background: color.bg,
  color: color.fg,
  minWidth: 0,
});

export const growStyle = css({ flex: "1 1 12rem" });

export const selectStyle = css({
  font: "inherit",
  fontSize: "0.85rem",
  padding: "0.25rem 0.4rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
  background: color.bg,
  color: color.fg,
});

export const badgeStyle = css({
  display: "inline-block",
  padding: "0.05rem 0.5rem",
  borderRadius: "999px",
  fontSize: "0.75rem",
  border: `1px solid ${color.border}`,
  color: color.muted,
  whiteSpace: "nowrap",
  '&[data-kind="ready"]': {
    borderColor: "#16a34a",
    color: "#16a34a",
  },
  '&[data-kind="blocked"]': {
    borderColor: "#d97706",
    color: "#d97706",
  },
});

export const listResetStyle = css({
  listStyle: "none",
  margin: 0,
  padding: 0,
});
