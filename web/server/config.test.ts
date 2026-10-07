import { assertEquals } from "@std/assert";
import { loadConfig } from "./config.ts";

Deno.test("loadConfig: env の値をそのまま反映する", () => {
  const config = loadConfig({
    IDP_ORIGIN: "http://localhost:8000",
    RP_ORIGIN: "https://rp.example",
    RP_SIGNING_KEY_JWK: "{}",
  });
  assertEquals(config, {
    idpOrigin: "http://localhost:8000",
    rpOrigin: "https://rp.example",
    rpSigningKeyJwk: "{}",
  });
});

Deno.test("loadConfig: 空の env はデフォルトにフォールバックする", () => {
  const config = loadConfig({});
  assertEquals(config.idpOrigin, "https://id.kbn.one");
  assertEquals(config.rpOrigin, "");
  assertEquals(config.rpSigningKeyJwk, "");
});
