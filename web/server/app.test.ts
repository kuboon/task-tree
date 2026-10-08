/**
 * Both front doors end to end, against a stand-in IdP: tokens are signed with a key made here, and
 * the authenticator is handed that key instead of fetching id.kbn.one's JWKS.
 *
 * The browser side uses the real DPoP client (`@kuboon/dpop`, with an in-memory key store and
 * `router.fetch` as its transport), so the proofs are the ones a browser would send.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exportJWK, generateKeyPair, importJWK, SignJWT } from "jose";
import { init, InMemoryKeyRepository } from "@kuboon/dpop";
import { createLocalD1 } from "@remix-kbn/data-table-d1/node";

import { createApp } from "./app.tsx";
import type { AppAssets } from "./assets.ts";
import { createAuthenticator } from "./auth.ts";
import { migrateLocalD1 } from "./db.ts";

const IDP = "https://idp.test";
const ORIGIN = "http://app.test";

const idpKeys = await generateKeyPair("ES256");
const idpPublic = await importJWK(await exportJWK(idpKeys.publicKey), "ES256");

const assets: AppAssets = {
  getScriptEntry: (entry) =>
    Promise.resolve({
      href: `/assets/${entry}`,
      preloads: [],
      importMap: { imports: {} },
    }),
};

async function setup() {
  const db = await createLocalD1(":memory:");
  await migrateLocalD1(db);
  const router = createApp({
    assets,
    db,
    auth: createAuthenticator({ idpOrigin: IDP, keys: () => idpPublic }),
  });
  return router;
}

const now = () => Math.floor(Date.now() / 1000);

/** A browser for `userId`: its own DPoP key, and the session token the IdP signs for it. */
async function browser(
  router: Awaited<ReturnType<typeof setup>>,
  userId: string,
) {
  const { fetchDpop, thumbprint } = await init({
    keyStore: new InMemoryKeyRepository(),
    fetch: (input, init) => router.fetch(new Request(input, init)),
  });
  const jws = await new SignJWT({ cnf: { jkt: thumbprint }, nickname: userId })
    .setProtectedHeader({ alg: "ES256" })
    .setIssuer(IDP)
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(now() + 3600)
    .sign(idpKeys.privateKey);
  return async (name: string, input: unknown, token = jws) => {
    const res = await fetchDpop(`${ORIGIN}/api/ops/${name}`, {
      method: "POST",
      headers: {
        authorization: `DPoP ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    return { status: res.status, body: await res.json() };
  };
}

function accessToken(userId: string, aud = `${ORIGIN}/mcp`) {
  return new SignJWT({ scope: "mcp", client_id: "https://client.test/cimd" })
    .setProtectedHeader({ alg: "ES256", typ: "at+jwt" })
    .setIssuer(IDP)
    .setSubject(userId)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(now() + 3600)
    .sign(idpKeys.privateKey);
}

async function mcpCall(
  router: Awaited<ReturnType<typeof setup>>,
  token: string | null,
  method: string,
  params: unknown,
) {
  const res = await router.fetch(
    new Request(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  const text = await res.text();
  return { res, text };
}

Deno.test("ops: DPoP + IdP トークンで操作でき、結果は利用者ごとに分かれる", async () => {
  const router = await setup();
  const alice = await browser(router, "alice");
  const bob = await browser(router, "bob");

  const created = await alice("create_team", { name: "開発" });
  assertEquals(created.status, 200);
  const teamId = created.body.result.id as string;

  assertEquals((await alice("whoami", {})).body.result, {
    userId: "alice",
    nickname: "alice",
  });
  assertEquals((await bob("list_teams", {})).body.result, []);
  assertEquals((await bob("get_team", { teamId })).status, 404);

  const invite = await alice("create_invite", { teamId });
  assertStringIncludes(invite.body.result.url, `${ORIGIN}/join/`);
  await bob("accept_invite", { token: invite.body.result.token });

  const task = await bob("create_task", {
    teamId,
    title: "設計",
    assigneeId: "alice",
  });
  assertEquals(task.status, 200);
  assertEquals(task.body.result.ready, true);

  const bad = await alice("create_task", { teamId, title: "" });
  assertEquals(bad.status, 400);
  assertEquals(bad.body.error.code, "invalid");
  assertEquals((await alice("no_such_op", {})).status, 404);
});

Deno.test("ops: 資格情報が無い・鍵が違う・発行者が違うと 401", async () => {
  const router = await setup();
  const res = await router.fetch(
    new Request(`${ORIGIN}/api/ops/list_teams`, { method: "POST", body: "{}" }),
  );
  assertEquals(res.status, 401);
  await res.body?.cancel();

  // Alice's token presented with Bob's DPoP key.
  const alice = await browser(router, "alice");
  const bob = await browser(router, "bob");
  const aliceToken = await new SignJWT({ cnf: { jkt: "someone-else" } })
    .setProtectedHeader({ alg: "ES256" })
    .setIssuer(IDP)
    .setSubject("alice")
    .setExpirationTime(now() + 60)
    .sign(idpKeys.privateKey);
  assertEquals((await bob("list_teams", {}, aliceToken)).status, 401);

  const otherIdp = await generateKeyPair("ES256");
  const forged = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256" })
    .setIssuer(IDP)
    .setSubject("alice")
    .setExpirationTime(now() + 60)
    .sign(otherIdp.privateKey);
  assertEquals((await alice("list_teams", {}, forged)).status, 401);
});

Deno.test("mcp: トークン無しは 401 と resource_metadata、メタデータは IdP を指す", async () => {
  const router = await setup();
  const { res } = await mcpCall(router, null, "tools/list", {});
  assertEquals(res.status, 401);
  assertStringIncludes(
    res.headers.get("www-authenticate") ?? "",
    `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
  );

  const prm = await router.fetch(
    new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`),
  );
  assertEquals(await prm.json(), {
    resource: `${ORIGIN}/mcp`,
    authorization_servers: ["https://id.kbn.one"],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
    resource_name: "Task Tree",
  });

  // A token for another resource is refused.
  const elsewhere = await accessToken("alice", "https://other.test/mcp");
  assertEquals(
    (await mcpCall(router, elsewhere, "tools/list", {})).res.status,
    401,
  );
});

Deno.test("mcp: ブラウザと同じ操作がツールとして並び、同じデータに届く", async () => {
  const router = await setup();
  const token = await accessToken("alice");

  const init = await mcpCall(router, token, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  assertEquals(init.res.status, 200, init.text);
  assertStringIncludes(init.text, '"task-tree"');

  const list = await mcpCall(router, token, "tools/list", {});
  assertEquals(list.res.status, 200, list.text);
  for (const name of ["create_team", "list_tasks", "add_dependency"]) {
    assertStringIncludes(list.text, `"${name}"`);
  }

  const call = await mcpCall(router, token, "tools/call", {
    name: "create_team",
    arguments: { name: "エージェントのチーム" },
  });
  assertEquals(call.res.status, 200, call.text);
  assertStringIncludes(call.text, "エージェントのチーム");

  // The browser sees the team the agent made.
  const alice = await browser(router, "alice");
  const teams = (await alice("list_teams", {})).body.result as {
    name: string;
  }[];
  assertEquals(teams.map((t) => t.name), ["エージェントのチーム"]);

  // Errors come back as tool errors, not transport errors.
  const denied = await mcpCall(router, token, "tools/call", {
    name: "get_team",
    arguments: { teamId: "nope" },
  });
  assert(denied.text.includes('"isError":true'), denied.text);
});
