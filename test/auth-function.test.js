import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import handler from "../netlify/functions/auth.mjs";

process.env.GITHUB_CLIENT_ID = "gh-id";
process.env.GITHUB_CLIENT_SECRET = "gh-secret";
process.env.GOOGLE_CLIENT_ID = "g-id";
process.env.GOOGLE_CLIENT_SECRET = "g-secret";
process.env.GOOGLE_API_KEY = "g-key";

const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = realFetch; });

const post = (body) => handler(new Request("http://x/api/auth", {
  method: "POST", body: JSON.stringify(body),
}));

test("GET returnerer klient-konfig fra miljø", async () => {
  const r = await handler(new Request("http://x/api/auth"));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(),
    { github_client_id: "gh-id", google_client_id: "g-id", google_api_key: "g-key" });
});

test("github: bytter code mot token", async () => {
  globalThis.fetch = async (url, opts) => {
    assert.equal(url, "https://github.com/login/oauth/access_token");
    const b = JSON.parse(opts.body);
    assert.equal(b.client_id, "gh-id");
    assert.equal(b.client_secret, "gh-secret");
    assert.equal(b.code, "abc");
    return { json: async () => ({ access_token: "tok123" }) };
  };
  const r = await post({ provider: "github", code: "abc" });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { access_token: "tok123" });
});

test("github: avvist code gir 400 med feilmelding", async () => {
  globalThis.fetch = async () => ({ json: async () => ({ error: "bad_verification_code", error_description: "The code is incorrect." }) });
  const r = await post({ provider: "github", code: "feil" });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, "The code is incorrect.");
});

test("google: bytter code mot access+refresh", async () => {
  globalThis.fetch = async (url, opts) => {
    assert.equal(url, "https://oauth2.googleapis.com/token");
    const p = new URLSearchParams(opts.body);
    assert.equal(p.get("grant_type"), "authorization_code");
    assert.equal(p.get("code"), "gcode");
    assert.equal(p.get("redirect_uri"), "https://app.example/");
    assert.equal(p.get("client_secret"), "g-secret");
    return { json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3599 }) };
  };
  const r = await post({ provider: "google", code: "gcode", redirect_uri: "https://app.example/" });
  assert.deepEqual(await r.json(), { access_token: "at", refresh_token: "rt", expires_in: 3599 });
});

test("google: refresh_token gir nytt access token", async () => {
  globalThis.fetch = async (url, opts) => {
    const p = new URLSearchParams(opts.body);
    assert.equal(p.get("grant_type"), "refresh_token");
    assert.equal(p.get("refresh_token"), "rt");
    return { json: async () => ({ access_token: "at2", expires_in: 3599 }) };
  };
  const r = await post({ provider: "google", refresh_token: "rt" });
  assert.equal((await r.json()).access_token, "at2");
});

test("ukjent provider og ugyldig JSON gir 400, annet verb 405", async () => {
  assert.equal((await post({ provider: "yahoo" })).status, 400);
  assert.equal((await handler(new Request("http://x/api/auth", { method: "POST", body: "{" }))).status, 400);
  assert.equal((await handler(new Request("http://x/api/auth", { method: "DELETE" }))).status, 405);
});
