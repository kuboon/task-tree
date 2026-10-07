import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import router from "./router.tsx";

Deno.test("GET / returns the shell with the sign-in island and the runtime script", async () => {
  const res = await router.fetch(new Request("http://x/"));
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("content-type") ?? "", "text/html");
  const html = await res.text();
  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, "Task Tree");
  assertStringIncludes(html, 'href="/my"');
  assertStringIncludes(html, '<script type="module" src="/assets/hydration');
  // The island resolved to its chunk, by its stable id rather than by import.meta.url.
  assertStringIncludes(html, "/assets/islands/nav_auth");
  assertStringIncludes(html, "NavAuth");
});

Deno.test("GET /my embeds idp-origin meta and both cards", async () => {
  const res = await router.fetch(new Request("http://x/my"));
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, '<meta name="idp-origin"');
  assertStringIncludes(html, "https://id.kbn.one");
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

Deno.test("GET /api/protected without DPoP proof is rejected", async () => {
  const res = await router.fetch(new Request("http://x/api/protected"));
  assert(
    res.status === 401 || res.status === 400,
    `expected 400 or 401, got ${res.status}`,
  );
  await res.body?.cancel();
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
