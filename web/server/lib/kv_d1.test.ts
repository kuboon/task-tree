import { assertEquals } from "@std/assert";
import { createLocalD1 } from "@remix-kbn/data-table-d1/node";

import { D1KvRepo } from "./kv_d1.ts";
import { migrateLocalD1 } from "../db.ts";

async function freshRepo<T>(prefix: string[] = ["t"], expireIn?: number) {
  const d1 = await createLocalD1(":memory:");
  await migrateLocalD1(d1);
  return new D1KvRepo<T>(d1, prefix, expireIn ? { expireIn } : {});
}

Deno.test("D1KvRepo: update と get で値を往復できる", async () => {
  const repo = await freshRepo<{ name: string }>();
  const r = await repo.entry("alice").update(() => ({ name: "Alice" }));
  assertEquals(r, { ok: true, val: { name: "Alice" } });
  assertEquals(await repo.entry("alice").get(), { name: "Alice" });
  assertEquals(await repo.entry("nobody").get(), null);
});

Deno.test("D1KvRepo: null を返すと削除される", async () => {
  const repo = await freshRepo<number>();
  await repo.entry("n").update(() => 1);
  await repo.entry("n").update(() => null);
  assertEquals(await repo.entry("n").get(), null);
});

Deno.test("D1KvRepo: expireIn 経過後は null", async () => {
  const repo = await freshRepo<string>(["t"], 10);
  await repo.entry("e").update(() => "soon");
  assertEquals(await repo.entry("e").get(), "soon");
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(await repo.entry("e").get(), null);
});

Deno.test("D1KvRepo: prefix 配下だけをイテレートする", async () => {
  const d1 = await createLocalD1(":memory:");
  await migrateLocalD1(d1);
  const a = new D1KvRepo<string>(d1, ["a"]);
  const b = new D1KvRepo<string>(d1, ["b"]);
  await a.entry("x").update(() => "1");
  await a.entry("y/z_").update(() => "2");
  await b.entry("x").update(() => "3");
  const keys: unknown[] = [];
  for await (const e of a) keys.push(e.key);
  assertEquals(keys.sort(), ["x", "y/z_"]);
});
