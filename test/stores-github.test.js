import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { githubStore, githubUser, ensureGithubRepo, b64enc, b64dec } from "../stores.js";

let calls;
function route(handlers) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    for (const [pat, fn] of handlers) if (String(url).includes(pat)) return fn(String(url), opts);
    throw new Error("uventet fetch: " + url);
  };
}
const res = (obj, status = 200) => ({ ok: status < 300, status, json: async () => obj });
beforeEach(() => { globalThis.fetch = undefined; });

test("b64 rundtur med norske tegn", () => {
  assert.equal(b64dec(b64enc("blåbærsyltetøy ✓")), "blåbærsyltetøy ✓");
});

test("load: henter og dekoder, 404 gir null", async () => {
  const st = githubStore({ token: "T", repo: "u/flash-data" });
  route([["contents/progress.json", (url, o) => {
    assert.equal(o.headers.Authorization, "Bearer T");
    return res({ content: b64enc('{"a":1}'), sha: "S1" });
  }]]);
  assert.deepEqual(await st.load("progress.json"), { json: { a: 1 }, version: "S1" });
  route([["contents/progress.json", () => res({}, 404)]]);
  assert.equal(await st.load("progress.json"), null);
});

test("save: PUT med sha; 409 merkes conflict; 401 merkes auth", async () => {
  const st = githubStore({ token: "T", repo: "u/flash-data" });
  route([["contents/f.json", (url, o) => {
    const b = JSON.parse(o.body);
    assert.equal(o.method, "PUT");
    assert.equal(b.sha, "S1");
    assert.equal(b64dec(b.content), "innhold");
    return res({}, 200);
  }]]);
  await st.save("f.json", "innhold", "S1");
  route([["contents/f.json", () => res({}, 409)]]);
  await assert.rejects(() => st.save("f.json", "x"), (e) => e.conflict === true);
  route([["contents/f.json", () => res({}, 401)]]);
  await assert.rejects(() => st.save("f.json", "x"), (e) => e.auth === true);
});

test("list: mappeinnhold med prefiks, 404 gir tom liste", async () => {
  const st = githubStore({ token: "T", repo: "u/flash-data" });
  route([["contents/decks", () => res([{ name: "a.json" }, { name: "b.json" }])]]);
  assert.deepEqual(await st.list("decks/"), ["decks/a.json", "decks/b.json"]);
  route([["contents/decks", () => res({}, 404)]]);
  assert.deepEqual(await st.list("decks/"), []);
});

test("githubUser henter /user", async () => {
  route([["api.github.com/user", (url, o) => {
    assert.equal(o.headers.Authorization, "Bearer T");
    return res({ login: "hans", name: "Hans", avatar_url: "http://a" });
  }]]);
  assert.equal((await githubUser("T")).login, "hans");
});

test("ensureGithubRepo: finnes → returnerer navn; 404 → oppretter privat repo", async () => {
  route([["repos/hans/flash-data", () => res({}, 200)]]);
  assert.equal(await ensureGithubRepo("T", "hans"), "hans/flash-data");
  route([
    ["repos/hans/flash-data", () => res({}, 404)],
    ["user/repos", (url, o) => {
      const b = JSON.parse(o.body);
      assert.equal(b.name, "flash-data");
      assert.equal(b.private, true);
      assert.equal(b.auto_init, true);
      return res({}, 201);
    }],
  ]);
  assert.equal(await ensureGithubRepo("T", "hans"), "hans/flash-data");
});
