import { assertEquals, assertStringIncludes } from "@std/assert";
import router from "./router.tsx";

Deno.test("GET / returns the shell with the islands and the runtime script", async () => {
  const res = await router.fetch(new Request("http://x/"));
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("content-type") ?? "", "text/html");
  const html = await res.text();
  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, "Task Tree");
  assertStringIncludes(html, '<script type="module" src="/assets/hydration');
  // Islands resolve to their chunks by their stable ids.
  assertStringIncludes(html, "/assets/islands/nav_auth");
  assertStringIncludes(html, "/assets/islands/teams_home");
  assertStringIncludes(html, "http://x/mcp");
});

Deno.test("GET /teams/:teamId and /join/:token hand the id to their island", async () => {
  const team = await (await router.fetch(new Request("http://x/teams/T1")))
    .text();
  assertStringIncludes(team, "/assets/islands/team_board");
  assertStringIncludes(team, '"teamId":"T1"');

  const join = await (await router.fetch(new Request("http://x/join/abc")))
    .text();
  assertStringIncludes(join, "/assets/islands/join_team");
  assertStringIncludes(join, '"token":"abc"');
});

Deno.test("GET /my embeds idp-origin meta and both cards", async () => {
  const res = await router.fetch(new Request("http://x/my"));
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, '<meta name="idp-origin"');
  assertStringIncludes(html, "/assets/islands/signin_card");
  assertStringIncludes(html, "/assets/islands/push_card");
});

Deno.test("GET /static/app.css and /sw.js are served", async () => {
  const css = await router.fetch(new Request("http://x/static/app.css"));
  assertEquals(css.status, 200);
  assertStringIncludes(await css.text(), "@layer base, rmx, app");

  const sw = await router.fetch(new Request("http://x/sw.js"));
  assertEquals(sw.status, 200);
  assertStringIncludes(sw.headers.get("content-type") ?? "", "javascript");
  assertStringIncludes(await sw.text(), "addEventListener");
});

Deno.test("POST /api/ops/* without credentials is 401", async () => {
  const res = await router.fetch(
    new Request("http://x/api/ops/list_teams", { method: "POST" }),
  );
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error.code, "unauthorized");
});

Deno.test("GET /.well-known/jwks.json publishes the RP key", async () => {
  const res = await router.fetch(
    new Request("http://x/.well-known/jwks.json"),
  );
  assertEquals(res.status, 200);
  const body = await res.json() as { keys: { kty: string }[] };
  assertEquals(body.keys[0].kty, "EC");
});

Deno.test("GET /nope is a 404", async () => {
  const res = await router.fetch(new Request("http://x/nope"));
  assertEquals(res.status, 404);
  await res.body?.cancel();
});
