import { assertEquals, assertRejects } from "@std/assert";
import { createLocalD1 } from "@remix-kbn/data-table-d1/node";

import { migrateLocalD1 } from "../db.ts";
import { AppError } from "./errors.ts";
import { Service, upsertUser } from "./service.ts";

async function setup() {
  const db = await createLocalD1(":memory:");
  await migrateLocalD1(db);
  await upsertUser(db, "alice", "Alice");
  await upsertUser(db, "bob", "Bob");
  await upsertUser(db, "carol", null);
  return {
    db,
    alice: new Service(db, "alice"),
    bob: new Service(db, "bob"),
    carol: new Service(db, "carol"),
  };
}

async function rejectsWith(code: string, fn: () => Promise<unknown>) {
  const error = await assertRejects(fn, AppError);
  assertEquals(error.code, code);
}

Deno.test("upsertUser: null の nickname は既存の値を消さない", async () => {
  const { db, alice } = await setup();
  await upsertUser(db, "alice", null);
  assertEquals(await alice.me(), { userId: "alice", nickname: "Alice" });
});

Deno.test("チーム: 作成者がオーナーになり、非メンバーには見えない", async () => {
  const { alice, bob } = await setup();
  const team = await alice.createTeam("  開発  ");
  assertEquals(team.name, "開発");
  assertEquals((await alice.listTeams()).map((t) => [t.name, t.role]), [[
    "開発",
    "owner",
  ]]);
  assertEquals(await bob.listTeams(), []);
  await rejectsWith("not_found", () => bob.getTeam(team.id));
  await rejectsWith("invalid", () => alice.createTeam("   "));
});

Deno.test("招待: リンクで参加でき、オーナー専用操作は拒否される", async () => {
  const { alice, bob } = await setup();
  const team = await alice.createTeam("T");
  const invite = await alice.createInvite(team.id);

  const preview = await bob.getInvite(invite.token);
  assertEquals(preview.teamName, "T");
  assertEquals(preview.alreadyMember, false);
  assertEquals(await bob.acceptInvite(invite.token), { teamId: team.id });
  // Accepting twice is harmless.
  await bob.acceptInvite(invite.token);

  const detail = await bob.getTeam(team.id);
  assertEquals(detail.myRole, "member");
  assertEquals(detail.members.map((m) => [m.nickname, m.role]), [
    ["Alice", "owner"],
    ["Bob", "member"],
  ]);
  await rejectsWith("forbidden", () => bob.renameTeam(team.id, "X"));
  await rejectsWith("forbidden", () => bob.deleteTeam(team.id));
  await rejectsWith("not_found", () => bob.getInvite("nope"));
});

Deno.test("メンバー: 抜けると担当が外れる。オーナーは抜けられない", async () => {
  const { alice, bob } = await setup();
  const team = await alice.createTeam("T");
  await bob.acceptInvite((await alice.createInvite(team.id)).token);
  const task = await alice.createTask(team.id, {
    title: "a",
    assigneeId: "bob",
  });
  assertEquals(task.assigneeId, "bob");

  await rejectsWith("forbidden", () => alice.leaveTeam(team.id));
  await bob.leaveTeam(team.id);
  assertEquals((await alice.getTask(team.id, task.id)).assigneeId, null);
  await rejectsWith("not_found", () => bob.listTasks(team.id));
  // A non-member cannot be assigned.
  await rejectsWith(
    "invalid",
    () => alice.updateTask(team.id, task.id, { assigneeId: "bob" }),
  );
});

Deno.test("依存: 着手可能の判定と、循環の拒否", async () => {
  const { alice } = await setup();
  const team = await alice.createTeam("T");
  const design = await alice.createTask(team.id, { title: "design" });
  const build = await alice.createTask(team.id, {
    title: "build",
    dependsOn: [design.id],
  });
  const ship = await alice.createTask(team.id, { title: "ship" });
  await alice.addDependency(team.id, ship.id, build.id);

  const ready = async () =>
    (await alice.listTasks(team.id, { readyOnly: true })).map((t) => t.title);
  assertEquals(await ready(), ["design"]);
  await alice.updateTask(team.id, design.id, { status: "done" });
  assertEquals(await ready(), ["build"]);

  // design ← build ← ship: making design depend on ship closes the loop.
  await rejectsWith(
    "conflict",
    () => alice.addDependency(team.id, design.id, ship.id),
  );
  await rejectsWith(
    "invalid",
    () => alice.addDependency(team.id, ship.id, ship.id),
  );

  const detail = await alice.getTask(team.id, build.id);
  assertEquals(detail.dependsOn, [design.id]);
  assertEquals(detail.dependentIds, [ship.id]);

  await alice.removeDependency(team.id, ship.id, build.id);
  assertEquals((await alice.getTask(team.id, ship.id)).dependsOn, []);
});

Deno.test("親子: 循環の拒否と、削除時の子の付け替え", async () => {
  const { alice } = await setup();
  const team = await alice.createTeam("T");
  const root = await alice.createTask(team.id, { title: "root" });
  const mid = await alice.createTask(team.id, {
    title: "mid",
    parentId: root.id,
  });
  const leaf = await alice.createTask(team.id, {
    title: "leaf",
    parentId: mid.id,
  });

  await rejectsWith(
    "conflict",
    () => alice.updateTask(team.id, root.id, { parentId: leaf.id }),
  );
  await rejectsWith(
    "conflict",
    () => alice.updateTask(team.id, root.id, { parentId: root.id }),
  );
  assertEquals((await alice.getTask(team.id, root.id)).childIds, [mid.id]);

  await alice.deleteTask(team.id, mid.id);
  assertEquals((await alice.getTask(team.id, leaf.id)).parentId, root.id);
});

Deno.test("チーム削除でタスクも消え、別チームのタスクには触れない", async () => {
  const { alice, bob } = await setup();
  const a = await alice.createTeam("A");
  const b = await bob.createTeam("B");
  const taskB = await bob.createTask(b.id, { title: "b" });
  // A task id from another team is not found through this team.
  await rejectsWith("not_found", () => alice.getTask(a.id, taskB.id));
  await rejectsWith(
    "not_found",
    () => alice.createTask(a.id, { title: "x", parentId: taskB.id }),
  );

  await alice.createTask(a.id, { title: "a" });
  await alice.deleteTeam(a.id);
  assertEquals(await alice.listTeams(), []);
});
