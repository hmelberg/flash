# flash — innlogging, GitHub/Drive-synk, deling og KI-agnostikk: implementasjonsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Innlogging med GitHub/Google, synk av innstillinger + API-nøkkel + fremgang + egne tema til brukerens egen lagring, deling av tema via lenker og offentlig katalog, og leverandøragnostisk KI — alt med kun én tilstandsløs Netlify-funksjon som server.

**Architecture:** Statisk SPA (index.html) beholdes. Ny `netlify/functions/auth.mjs` gjør OAuth-utveksling (hemmeligheter i miljøvariabler, ingen lagring). Nye ES-moduler: `stores.js` (lagringsadaptere GitHub/Drive), `sync.js` (ren merge-logikk), `ai.js` (KI-klient Anthropic/OpenAI-kompatibel). index.html importerer modulene og beholder UI/wiring.

**Tech Stack:** Vanilla JS ES-moduler, ingen byggetrinn. Netlify Functions (moderne default-export + `config`). Tester: `node --test` (node:test + assert, som i `test/srs.test.js`), mocket `globalThis.fetch`.

**Spec:** `docs/superpowers/specs/2026-07-14-sync-login-deling-design.md`

## Global Constraints

- Ingen byggetrinn, ingen npm-avhengigheter i klienten. Moduler er rene ES-moduler som fungerer via `<script type="module">`.
- All UI-tekst på norsk, kodekommentarer på norsk (som eksisterende kode).
- Ingen sekreter i repoet: client secrets kun i Netlify-miljøvariabler (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_API_KEY`).
- OAuth-tokens synkes aldri til ekstern lagring; kun whitelisten `SYNCED_SETTINGS` synkes.
- Appen skal fortsatt være fullt brukbar uten API-nøkkel og uten innlogging (localStorage alene).
- Eksisterende PAT-synk skal fortsette å virke (avansert-alternativ).
- Kjør alle tester med `node --test test/` — alle skal passere før hver commit.
- Test av `index.html`-endringer: `python3 -m http.server 8000` (uten funksjoner) og `netlify dev` (med funksjoner).

---

### Task 1: Netlify-oppsett + auth-funksjon

**Files:**
- Create: `netlify.toml`
- Create: `netlify/functions/auth.mjs`
- Test: `test/auth-function.test.js`

**Interfaces:**
- Produces: HTTP-endepunkt `/api/auth`:
  - `GET /api/auth` → `{github_client_id, google_client_id, google_api_key}` (tomme strenger hvis ikke satt)
  - `POST {provider:"github", code}` → `{access_token}` | 400 `{error}`
  - `POST {provider:"google", code, redirect_uri}` → `{access_token, refresh_token, expires_in}` | 400 `{error}`
  - `POST {provider:"google", refresh_token}` → `{access_token, expires_in}` | 400 `{error}`

- [ ] **Step 1: Skriv `netlify.toml`**

```toml
[build]
  publish = "."

[functions]
  directory = "netlify/functions"
```

- [ ] **Step 2: Skriv feilende tester**

`test/auth-function.test.js`:

```js
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
```

- [ ] **Step 3: Kjør testene — forvent feil**

Kjør: `node --test test/auth-function.test.js`
Forventet: FAIL (modulen finnes ikke).

- [ ] **Step 4: Implementer `netlify/functions/auth.mjs`**

```js
// Tilstandsløs OAuth-utveksling: client secrets bor i Netlify-miljøvariabler,
// ingenting lagres. GET gir klienten offentlig konfig (client-id-er).
const env = (k) => (globalThis.Netlify ? Netlify.env.get(k) : process.env[k]) || "";
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method === "GET") {
    return json({
      github_client_id: env("GITHUB_CLIENT_ID"),
      google_client_id: env("GOOGLE_CLIENT_ID"),
      google_api_key: env("GOOGLE_API_KEY"),
    });
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "ugyldig JSON" }, 400); }

  if (body.provider === "github") {
    if (!body.code) return json({ error: "mangler code" }, 400);
    const r = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_id: env("GITHUB_CLIENT_ID"),
        client_secret: env("GITHUB_CLIENT_SECRET"),
        code: body.code,
      }),
    });
    const t = await r.json();
    if (!t.access_token) return json({ error: t.error_description || "GitHub avviste koden" }, 400);
    return json({ access_token: t.access_token });
  }

  if (body.provider === "google") {
    if (!body.code && !body.refresh_token) return json({ error: "mangler code/refresh_token" }, 400);
    const grant = body.refresh_token
      ? { grant_type: "refresh_token", refresh_token: body.refresh_token }
      : { grant_type: "authorization_code", code: body.code, redirect_uri: body.redirect_uri || "" };
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env("GOOGLE_CLIENT_ID"),
        client_secret: env("GOOGLE_CLIENT_SECRET"),
        ...grant,
      }).toString(),
    });
    const t = await r.json();
    if (!t.access_token) return json({ error: t.error_description || t.error || "Google avviste forespørselen" }, 400);
    return json({ access_token: t.access_token, refresh_token: t.refresh_token, expires_in: t.expires_in });
  }

  return json({ error: "ukjent provider" }, 400);
};

export const config = { path: "/api/auth" };
```

- [ ] **Step 5: Kjør testene — forvent PASS**

Kjør: `node --test test/auth-function.test.js` → alle PASS.
Kjør: `node --test test/` → alt annet fortsatt grønt.

- [ ] **Step 6: Commit**

```bash
git add netlify.toml netlify/functions/auth.mjs test/auth-function.test.js
git commit -m "Netlify-funksjon for OAuth-utveksling (GitHub + Google)"
```

---

### Task 2: `sync.js` — ren merge- og parselogikk

**Files:**
- Create: `sync.js`
- Test: `test/sync.test.js`
- (index.html røres IKKE i denne oppgaven — koblingen skjer i Task 6)

**Interfaces:**
- Produces:
  - `SYNCED_SETTINGS: string[]` — nøkler som synkes: `["newPerDay","autoRead","readQuestion","readExample","model","apiKey","aiProvider","aiBaseUrl"]`
  - `mergeProgress(local, remote) → {progress, notes, newUsedByDay}` — `local`/`remote` har samme form; `remote` kan være `null`. Per kort vinner høyest `lastReview`; notes: lokal vinner; newUsedByDay: max per dag. (Samme semantikk som dagens `mergedPayload` i index.html:791-803.)
  - `mergeSettings(local, remote) → {values, updatedAt, source}` — `local = {values, updatedAt}`, `remote = {values, updatedAt} | null`; høyest `updatedAt` vinner; `values` inneholder kun `SYNCED_SETTINGS`-nøkler; `source` er `"local"` eller `"remote"`.
  - `parseShareHash(hash) → string | null` — `"#deck=<uri-enkodet URL>"` → absolutt URL, ellers `null`.

- [ ] **Step 1: Skriv feilende tester**

`test/sync.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { SYNCED_SETTINGS, mergeProgress, mergeSettings, parseShareHash } from "../sync.js";

const L = (over = {}) => ({ progress: {}, notes: {}, newUsedByDay: {}, ...over });

test("mergeProgress: nyeste lastReview vinner per kort", () => {
  const local = L({ progress: { a: { lastReview: 200, reps: 2 }, b: { lastReview: 50, reps: 1 } } });
  const remote = L({ progress: { a: { lastReview: 100, reps: 9 }, b: { lastReview: 90, reps: 5 }, c: { lastReview: 10 } } });
  const m = mergeProgress(local, remote);
  assert.equal(m.progress.a.reps, 2);   // lokal nyere
  assert.equal(m.progress.b.reps, 5);   // remote nyere
  assert.equal(m.progress.c.lastReview, 10); // kun remote
});

test("mergeProgress: remote=null gir lokal payload; notes lokal vinner; newUsedByDay max", () => {
  const local = L({ notes: { x: "lokal" }, newUsedByDay: { "2026-07-14": 3 } });
  assert.deepEqual(mergeProgress(local, null), local);
  const remote = L({ notes: { x: "remote", y: "bare-remote" }, newUsedByDay: { "2026-07-14": 7, "2026-07-13": 2 } });
  const m = mergeProgress(local, remote);
  assert.equal(m.notes.x, "lokal");
  assert.equal(m.notes.y, "bare-remote");
  assert.equal(m.newUsedByDay["2026-07-14"], 7);
  assert.equal(m.newUsedByDay["2026-07-13"], 2);
});

test("mergeSettings: høyest updatedAt vinner, kun whitelist-nøkler", () => {
  const local = { values: { apiKey: "lokal", model: "m1", ghPat: "HEMMELIG", newPerDay: 10, autoRead: false, readQuestion: false, readExample: false, aiProvider: "anthropic", aiBaseUrl: "" }, updatedAt: 100 };
  const remote = { values: { apiKey: "remote", model: "m2", newPerDay: 20 }, updatedAt: 200 };
  const m = mergeSettings(local, remote);
  assert.equal(m.source, "remote");
  assert.equal(m.values.apiKey, "remote");
  assert.equal(m.updatedAt, 200);
  const m2 = mergeSettings({ ...local, updatedAt: 300 }, remote);
  assert.equal(m2.source, "local");
  assert.equal(m2.values.apiKey, "lokal");
  assert.equal(m2.values.ghPat, undefined); // PAT synkes aldri
  for (const k of Object.keys(m2.values)) assert.ok(SYNCED_SETTINGS.includes(k));
});

test("mergeSettings: remote=null gir lokal", () => {
  const m = mergeSettings({ values: { apiKey: "k" }, updatedAt: 0 }, null);
  assert.equal(m.source, "local");
  assert.equal(m.values.apiKey, "k");
});

test("parseShareHash", () => {
  assert.equal(parseShareHash("#deck=" + encodeURIComponent("https://x.no/d.json?a=1")), "https://x.no/d.json?a=1");
  assert.equal(parseShareHash("#home"), null);
  assert.equal(parseShareHash(""), null);
  assert.equal(parseShareHash("#deck=ikke-en-url"), null);
});
```

- [ ] **Step 2: Kjør — forvent FAIL** (`node --test test/sync.test.js`)

- [ ] **Step 3: Implementer `sync.js`**

```js
// Ren synk-logikk — ingen DOM, ingen fetch. Testes med node --test.

export const SYNCED_SETTINGS = [
  "newPerDay", "autoRead", "readQuestion", "readExample",
  "model", "apiKey", "aiProvider", "aiBaseUrl",
];

// Fremgang: per kort vinner høyest lastReview; notater: lokal vinner;
// dagskvote: max per dag. (Flyttet fra index.html sin mergedPayload.)
export function mergeProgress(local, remote) {
  const progress = { ...(remote?.progress || {}) };
  for (const [k, st] of Object.entries(local.progress)) {
    const r = progress[k];
    if (!r || (st.lastReview || 0) >= (r.lastReview || 0)) progress[k] = st;
  }
  const notes = { ...(remote?.notes || {}), ...local.notes };
  const newUsedByDay = { ...(remote?.newUsedByDay || {}) };
  for (const [day, n] of Object.entries(local.newUsedByDay))
    newUsedByDay[day] = Math.max(newUsedByDay[day] || 0, n);
  return { progress, notes, newUsedByDay };
}

// Innstillinger: siste skriving vinner (updatedAt). Kun whitelisten synkes —
// aldri tokens/PAT.
export function mergeSettings(local, remote) {
  const pick = (v) => Object.fromEntries(
    SYNCED_SETTINGS.filter(k => v && v[k] !== undefined).map(k => [k, v[k]]));
  if (remote && (remote.updatedAt || 0) > (local.updatedAt || 0))
    return { values: pick(remote.values), updatedAt: remote.updatedAt, source: "remote" };
  return { values: pick(local.values), updatedAt: local.updatedAt || 0, source: "local" };
}

// "#deck=<uri-enkodet URL>" → absolutt URL, ellers null.
export function parseShareHash(hash) {
  const m = /^#deck=(.+)$/.exec(hash || "");
  if (!m) return null;
  try { return new URL(decodeURIComponent(m[1])).href; } catch { return null; }
}
```

- [ ] **Step 4: Kjør — forvent PASS** (`node --test test/`)

- [ ] **Step 5: Commit**

```bash
git add sync.js test/sync.test.js
git commit -m "sync.js: ren merge-logikk for fremgang og innstillinger, parseShareHash"
```

---

### Task 3: `stores.js` — GitHub-adapter

**Files:**
- Create: `stores.js`
- Test: `test/stores-github.test.js`

**Interfaces:**
- Produces (adapterkontrakt, samme for begge adaptere):
  - `load(path) → Promise<{json, version} | null>` (null ved 404)
  - `save(path, contentStr, version?) → Promise<void>` — kaster `Error` med `e.conflict = true` ved GitHub 409/422, `e.auth = true` ved 401
  - `list(prefix) → Promise<string[]>` — filnavn med prefiks, f.eks. `list("decks/") → ["decks/x.json"]`; tom liste hvis mappen ikke finnes
- Produces i tillegg:
  - `githubStore({token, repo}) → adapter` (`repo` = `"eier/navn"`)
  - `githubUser(token) → Promise<{login, name, avatar_url}>`
  - `ensureGithubRepo(token, login, name = "flash-data") → Promise<string>` — returnerer `"login/navn"`, oppretter privat repo (`auto_init: true`) hvis det ikke finnes
  - `b64enc(str)`, `b64dec(b64)` — UTF-8-sikre base64-hjelpere (flyttes hit fra index.html:752-760)

- [ ] **Step 1: Skriv feilende tester**

`test/stores-github.test.js`:

```js
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
```

- [ ] **Step 2: Kjør — forvent FAIL** (`node --test test/stores-github.test.js`)

- [ ] **Step 3: Implementer GitHub-delen av `stores.js`**

```js
// Lagringsadaptere. Kontrakt (lik for GitHub og Drive):
//   load(path)  → {json, version} | null
//   save(path, contentStr, version?)   — e.conflict ved versjonskonflikt, e.auth ved 401
//   list(prefix) → ["<prefix><navn>", …]
// Adapterne er DOM-frie og tar tokens utenfra — testes med mocket fetch.

export const b64enc = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
export const b64dec = (b64) => {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
};

const GH_HEADERS = (token) => ({ Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" });
const authError = (hvem) => {
  const e = new Error(`${hvem} avviste tokenet (401) — logg inn på nytt.`);
  e.auth = true; return e;
};

export function githubStore({ token, repo }) {
  async function gh(path, opts = {}) {
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      ...opts, headers: { ...GH_HEADERS(token), ...opts.headers },
    });
    if (r.status === 401) throw authError("GitHub");
    return r;
  }
  return {
    async load(path) {
      const r = await gh(path);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`GitHub GET ${path}: HTTP ${r.status}`);
      const j = await r.json();
      return { json: JSON.parse(b64dec(j.content)), version: j.sha };
    },
    async save(path, contentStr, version) {
      const body = { message: `flash sync ${new Date().toISOString()}`, content: b64enc(contentStr) };
      if (version) body.sha = version;
      const r = await gh(path, { method: "PUT", body: JSON.stringify(body) });
      if (!r.ok) {
        const e = new Error(`GitHub PUT ${path}: HTTP ${r.status}`);
        e.conflict = r.status === 409 || r.status === 422;
        throw e;
      }
    },
    async list(prefix) {
      const r = await gh(prefix.replace(/\/$/, ""));
      if (r.status === 404) return [];
      if (!r.ok) throw new Error(`GitHub LIST ${prefix}: HTTP ${r.status}`);
      return (await r.json()).map(f => prefix + f.name);
    },
  };
}

export async function githubUser(token) {
  const r = await fetch("https://api.github.com/user", { headers: GH_HEADERS(token) });
  if (r.status === 401) throw authError("GitHub");
  if (!r.ok) throw new Error(`GitHub /user: HTTP ${r.status}`);
  return await r.json();
}

export async function ensureGithubRepo(token, login, name = "flash-data") {
  const full = `${login}/${name}`;
  const r = await fetch(`https://api.github.com/repos/${full}`, { headers: GH_HEADERS(token) });
  if (r.status === 401) throw authError("GitHub");
  if (r.ok) return full;
  if (r.status !== 404) throw new Error(`GitHub repo-sjekk: HTTP ${r.status}`);
  const c = await fetch("https://api.github.com/user/repos", {
    method: "POST", headers: GH_HEADERS(token),
    body: JSON.stringify({ name, private: true, auto_init: true, description: "flash-data: synk for flash-appen" }),
  });
  if (!c.ok) throw new Error(`Klarte ikke å opprette ${full}: HTTP ${c.status}`);
  return full;
}
```

- [ ] **Step 4: Kjør — forvent PASS** (`node --test test/`)

- [ ] **Step 5: Commit**

```bash
git add stores.js test/stores-github.test.js
git commit -m "stores.js: GitHub-lagringsadapter med load/save/list, repo-oppretting"
```

---

### Task 4: `stores.js` — Google Drive-adapter

**Files:**
- Modify: `stores.js` (legg til nederst)
- Test: `test/stores-drive.test.js`

**Interfaces:**
- Consumes: adapterkontrakten fra Task 3.
- Produces: `driveStore({getToken}) → adapter` — `getToken() → Promise<string>` (gyldig access token; refresh håndteres av kalleren). Filstruktur i Drive: mappe `flash-data` i rot, undermappe `decks`. `path` `"x.json"` → fil i `flash-data`; `"decks/x.json"` → fil i undermappen. `version` = Drive-fil-id (ingen compare-and-swap — synken merger alltid før skriving).

- [ ] **Step 1: Skriv feilende tester**

`test/stores-drive.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { driveStore } from "../stores.js";

const res = (obj, status = 200) => ({ ok: status < 300, status, json: async () => obj });

// Enkel fake av Drive-API: mapper og filer i minne.
function fakeDrive({ files = {}, folders = {} } = {}) {
  // folders: {"": "ROT-ID", decks: "DECKS-ID"} — settes når de "finnes" fra før
  const created = [];
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url);
    assert.match(opts.headers.Authorization, /^Bearer T/);
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?q=")) {
      const q = decodeURIComponent(new URL(url).searchParams.get("q"));
      if (q.includes("mimeType='application/vnd.google-apps.folder'")) {
        const name = /name='([^']+)'/.exec(q)[1];
        const key = name === "flash-data" ? "" : name;
        return res({ files: folders[key] ? [{ id: folders[key] }] : [] });
      }
      const parent = /'([^']+)' in parents/.exec(q)[1];
      const name = /name='([^']+)'/.exec(q)?.[1];
      const hits = Object.entries(files)
        .filter(([, f]) => f.parent === parent && (!name || f.name === name))
        .map(([id, f]) => ({ id, name: f.name }));
      return res({ files: hits });
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/") && url.includes("alt=media")) {
      const id = /files\/([^?]+)/.exec(url)[1];
      return { ok: true, status: 200, json: async () => JSON.parse(files[id].content) };
    }
    if (url === "https://www.googleapis.com/drive/v3/files" && opts.method === "POST") {
      const meta = JSON.parse(opts.body); // mappe-oppretting
      const id = "ny-" + meta.name;
      folders[meta.name === "flash-data" ? "" : meta.name] = id;
      created.push({ type: "folder", meta });
      return res({ id });
    }
    if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files?") && opts.method === "POST") {
      created.push({ type: "create", body: opts.body });
      return res({ id: "fil-ny" });
    }
    if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files/") && opts.method === "PATCH") {
      const id = /files\/([^?]+)/.exec(url)[1];
      created.push({ type: "update", id, body: opts.body });
      return res({ id });
    }
    throw new Error("uventet fetch: " + url + " " + (opts.method || "GET"));
  };
  return { created, folders };
}

const st = () => driveStore({ getToken: async () => "T" });

test("load: finner fil via mappe + navn; mangler → null", async () => {
  fakeDrive({ folders: { "": "ROT" }, files: { F1: { name: "progress.json", parent: "ROT", content: '{"a":1}' } } });
  assert.deepEqual(await st().load("progress.json"), { json: { a: 1 }, version: "F1" });
  fakeDrive({ folders: { "": "ROT" } });
  assert.equal(await st().load("progress.json"), null);
});

test("load i undermappe: decks/x.json", async () => {
  fakeDrive({ folders: { "": "ROT", decks: "D" }, files: { F2: { name: "x.json", parent: "D", content: "[1]" } } });
  assert.deepEqual(await st().load("decks/x.json"), { json: [1], version: "F2" });
});

test("save: ny fil → multipart POST; eksisterende (version) → PATCH media", async () => {
  const f = fakeDrive({ folders: { "": "ROT" } });
  await st().save("settings.json", '{"k":1}');
  assert.equal(f.created.at(-1).type, "create");
  assert.match(f.created.at(-1).body, /settings\.json/);
  await st().save("settings.json", '{"k":2}', "F9");
  assert.equal(f.created.at(-1).type, "update");
  assert.equal(f.created.at(-1).id, "F9");
});

test("save oppretter manglende mapper", async () => {
  const f = fakeDrive({});   // ingen mapper finnes
  await st().save("decks/x.json", "[1]");
  const folderNames = f.created.filter(c => c.type === "folder").map(c => c.meta.name);
  assert.deepEqual(folderNames, ["flash-data", "decks"]);
});

test("list: filer i decks-mappen med prefiks", async () => {
  fakeDrive({ folders: { "": "ROT", decks: "D" }, files: {
    F1: { name: "a.json", parent: "D", content: "1" },
    F2: { name: "b.json", parent: "D", content: "2" },
  } });
  assert.deepEqual((await st().list("decks/")).sort(), ["decks/a.json", "decks/b.json"]);
});

test("401 merkes e.auth", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(() => st().load("progress.json"), (e) => e.auth === true);
});
```

Merk til implementøren: fake-en over antar URL-formene implementasjonen under bruker. Hvis en test feiler på «uventet fetch», er det URL-formen som avviker; rett implementasjonen, ikke fake-en, med mindre begge er gale. (Fil-søket i fake-en håndterer både `name='…'`-oppslag og `list` uten navn — begge har `'<id>' in parents`.)

- [ ] **Step 2: Kjør — forvent FAIL** (`node --test test/stores-drive.test.js`)

- [ ] **Step 3: Implementer `driveStore` nederst i `stores.js`**

```js
// Google Drive-adapter. Struktur: mappe "flash-data" i rot, undermappe "decks".
// drive.file-scope: vi ser kun filer appen selv har laget. version = fil-id.
export function driveStore({ getToken }) {
  const folderIds = {};   // "" = flash-data, "decks" = undermappen

  async function req(url, opts = {}) {
    const token = await getToken();
    const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...opts.headers } });
    if (r.status === 401) { const e = new Error("Google avviste tokenet (401) — logg inn på nytt."); e.auth = true; throw e; }
    return r;
  }
  async function query(q) {
    const r = await req(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id,name)")}&pageSize=1000`);
    if (!r.ok) throw new Error(`Drive-søk: HTTP ${r.status}`);
    return (await r.json()).files || [];
  }
  async function folderId(sub, create) {
    const key = sub || "";
    if (folderIds[key]) return folderIds[key];
    const parent = key === "" ? "root" : await folderId("", create);
    if (parent === null) return null;
    const name = key === "" ? "flash-data" : sub;
    const found = await query(`name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`);
    let id = found[0]?.id;
    if (!id) {
      if (!create) return null;
      const r = await req("https://www.googleapis.com/drive/v3/files", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }),
      });
      if (!r.ok) throw new Error(`Drive-mappe: HTTP ${r.status}`);
      id = (await r.json()).id;
    }
    return (folderIds[key] = id);
  }
  const splitPath = (path) => {
    const i = path.indexOf("/");
    return i < 0 ? { sub: "", name: path } : { sub: path.slice(0, i), name: path.slice(i + 1) };
  };
  async function fileId(path, create) {
    const { sub, name } = splitPath(path);
    const parent = await folderId(sub, create);
    if (!parent) return null;
    const found = await query(`name='${name}' and '${parent}' in parents and trashed=false`);
    return found[0]?.id || null;
  }

  return {
    async load(path) {
      const id = await fileId(path, false);
      if (!id) return null;
      const r = await req(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
      if (!r.ok) throw new Error(`Drive GET ${path}: HTTP ${r.status}`);
      return { json: await r.json(), version: id };
    },
    async save(path, contentStr, version) {
      const id = version || await fileId(path, true);
      if (id) {
        const r = await req(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
          method: "PATCH", headers: { "content-type": "application/json" }, body: contentStr,
        });
        if (!r.ok) throw new Error(`Drive PUT ${path}: HTTP ${r.status}`);
        return;
      }
      const { sub, name } = splitPath(path);
      const parent = await folderId(sub, true);
      const boundary = "flashmp";
      const body = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify({ name, parents: [parent] }) +
        `\r\n--${boundary}\r\ncontent-type: application/json\r\n\r\n${contentStr}\r\n--${boundary}--`;
      const r = await req(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`, {
        method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body,
      });
      if (!r.ok) throw new Error(`Drive opprett ${path}: HTTP ${r.status}`);
    },
    async list(prefix) {
      const sub = prefix.replace(/\/$/, "");
      const parent = await folderId(sub, false);
      if (!parent) return [];
      const files = await query(`'${parent}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`);
      return files.map(f => prefix + f.name);
    },
  };
}
```

- [ ] **Step 4: Kjør — forvent PASS** (`node --test test/`)

- [ ] **Step 5: Commit**

```bash
git add stores.js test/stores-drive.test.js
git commit -m "stores.js: Google Drive-adapter (flash-data-mappe, decks-undermappe)"
```

---

### Task 5: `ai.js` — leverandøragnostisk KI-klient

**Files:**
- Create: `ai.js`
- Test: `test/ai.test.js`
- (index.html byttes over i Task 8)

**Interfaces:**
- Produces:
  - `aiMessage(cfg, body, {onText, signal}?) → Promise<{content: [{type:"text", text}], stop_reason}>`
    - `cfg = {aiProvider: "anthropic" | "openai", apiKey, aiBaseUrl}` (`aiBaseUrl` kun brukt for openai; tom → feil)
    - `body` er Anthropic-formet: `{model, max_tokens, system, messages: [{role, content}]}` — openai-stien oversetter (`system` → første melding med `role:"system"`).
    - `onText(delta)` gitt → streaming (SSE); ellers ett svar.
  - `aiError(e) → string` — norsk feilmelding (flyttes fra index.html:854-859, uendret semantikk).
  - Kaster `Error` med `.status` fra HTTP-feil.

- [ ] **Step 1: Skriv feilende tester**

`test/ai.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { aiMessage, aiError } from "../ai.js";

const BODY = { model: "m", max_tokens: 100, system: "SYS", messages: [{ role: "user", content: "hei" }] };

function sseResponse(lines) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: true, status: 200,
    body: { getReader: () => ({ read: async () =>
      i < lines.length ? { done: false, value: enc.encode(lines[i++] + "\n") } : { done: true } }) },
  };
}

test("anthropic: ikke-streamet kall med riktige headere", async () => {
  globalThis.fetch = async (url, opts) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal(opts.headers["x-api-key"], "K");
    assert.equal(opts.headers["anthropic-dangerous-direct-browser-access"], "true");
    assert.equal(JSON.parse(opts.body).system, "SYS");
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "svar" }], stop_reason: "end_turn" }) };
  };
  const m = await aiMessage({ aiProvider: "anthropic", apiKey: "K" }, BODY);
  assert.equal(m.content[0].text, "svar");
});

test("anthropic: streaming samler tekst", async () => {
  globalThis.fetch = async (url, opts) => {
    assert.equal(JSON.parse(opts.body).stream, true);
    return sseResponse([
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"he"}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"i"}}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
    ]);
  };
  let got = "";
  const m = await aiMessage({ aiProvider: "anthropic", apiKey: "K" }, BODY, { onText: t => got += t });
  assert.equal(got, "hei");
  assert.equal(m.content[0].text, "hei");
  assert.equal(m.stop_reason, "end_turn");
});

test("openai: oversetter body og normaliserer svar", async () => {
  globalThis.fetch = async (url, opts) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(opts.headers.Authorization, "Bearer K");
    const b = JSON.parse(opts.body);
    assert.deepEqual(b.messages[0], { role: "system", content: "SYS" });
    assert.deepEqual(b.messages[1], { role: "user", content: "hei" });
    assert.equal(b.max_tokens, 100);
    return { ok: true, status: 200, json: async () =>
      ({ choices: [{ message: { content: "svar" }, finish_reason: "stop" }] }) };
  };
  const m = await aiMessage({ aiProvider: "openai", apiKey: "K", aiBaseUrl: "https://openrouter.ai/api/v1/" }, BODY);
  assert.equal(m.content[0].text, "svar");
  assert.equal(m.stop_reason, "stop");
});

test("openai: streaming (choices delta)", async () => {
  globalThis.fetch = async () => sseResponse([
    'data: {"choices":[{"delta":{"content":"he"}}]}',
    'data: {"choices":[{"delta":{"content":"i"},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    "data: [DONE]",
  ]);
  let got = "";
  const m = await aiMessage({ aiProvider: "openai", apiKey: "K", aiBaseUrl: "https://x/v1" }, BODY, { onText: t => got += t });
  assert.equal(got, "hei");
  assert.equal(m.stop_reason, "stop");
});

test("openai uten baseUrl gir forklarende feil; HTTP-feil får status", async () => {
  await assert.rejects(() => aiMessage({ aiProvider: "openai", apiKey: "K", aiBaseUrl: "" }, BODY), /base-URL/i);
  globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await assert.rejects(() => aiMessage({ aiProvider: "anthropic", apiKey: "K" }, BODY), (e) => e.status === 429);
});

test("aiError oversetter kjente statuser", () => {
  assert.match(aiError({ status: 401 }), /avvist/);
  assert.match(aiError({ status: 429 }), /mange/);
  assert.equal(aiError(new Error("x")), "x");
});
```

- [ ] **Step 2: Kjør — forvent FAIL** (`node --test test/ai.test.js`)

- [ ] **Step 3: Implementer `ai.js`**

```js
// KI-klient uten SDK-avhengighet. Ett grensesnitt, to leverandørstier:
//   anthropic — api.anthropic.com (direkte nettleserkall, som før)
//   openai    — enhver OpenAI-kompatibel /chat/completions (OpenRouter, Gemini,
//               Groq, Ollama …). api.openai.com direkte mangler CORS og virker
//               ikke fra nettleser — bruk OpenRouter e.l.
// body er Anthropic-formet ({model, max_tokens, system, messages}); openai-stien
// oversetter. Svar normaliseres til {content:[{type:"text",text}], stop_reason}.

export function aiError(e) {
  const st = e?.status ?? e?.response?.status;
  if (st === 401) return "API-nøkkelen ble avvist — sjekk innstillinger.";
  if (st === 429) return "For mange forespørsler — vent litt og prøv igjen.";
  return e.message || String(e);
}

async function readSse(r, onEvent) {
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;
      let ev; try { ev = JSON.parse(data); } catch { continue; }
      onEvent(ev);
    }
  }
}

async function httpJson(url, headers, bodyObj, signal) {
  const r = await fetch(url, {
    method: "POST", signal,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(bodyObj),
  });
  if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
  return r;
}

async function anthropicMessage({ apiKey }, body, { onText, signal } = {}) {
  const headers = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  const r = await httpJson("https://api.anthropic.com/v1/messages", headers,
    onText ? { ...body, stream: true } : body, signal);
  if (!onText) return await r.json();
  let text = "", stop = null;
  await readSse(r, (ev) => {
    if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
      text += ev.delta.text; onText(ev.delta.text);
    } else if (ev.type === "message_delta") stop = ev.delta?.stop_reason ?? stop;
  });
  return { content: [{ type: "text", text }], stop_reason: stop };
}

async function openaiMessage({ apiKey, aiBaseUrl }, body, { onText, signal } = {}) {
  if (!aiBaseUrl) throw new Error("Sett base-URL for OpenAI-kompatibel tjeneste i innstillinger (f.eks. https://openrouter.ai/api/v1).");
  const url = aiBaseUrl.replace(/\/$/, "") + "/chat/completions";
  const oaBody = {
    model: body.model, max_tokens: body.max_tokens,
    messages: [...(body.system ? [{ role: "system", content: body.system }] : []), ...body.messages],
    ...(onText ? { stream: true } : {}),
  };
  const r = await httpJson(url, { Authorization: `Bearer ${apiKey}` }, oaBody, signal);
  if (!onText) {
    const j = await r.json();
    const c = j.choices?.[0];
    return { content: [{ type: "text", text: c?.message?.content || "" }], stop_reason: c?.finish_reason ?? null };
  }
  let text = "", stop = null;
  await readSse(r, (ev) => {
    const c = ev.choices?.[0];
    if (c?.delta?.content) { text += c.delta.content; onText(c.delta.content); }
    if (c?.finish_reason) stop = c.finish_reason;
  });
  return { content: [{ type: "text", text }], stop_reason: stop };
}

export async function aiMessage(cfg, body, opts = {}) {
  return cfg.aiProvider === "openai" ? openaiMessage(cfg, body, opts) : anthropicMessage(cfg, body, opts);
}
```

- [ ] **Step 4: Kjør — forvent PASS** (`node --test test/`)

- [ ] **Step 5: Commit**

```bash
git add ai.js test/ai.test.js
git commit -m "ai.js: leverandøragnostisk KI-klient (Anthropic + OpenAI-kompatibel), streaming"
```

---

### Task 6: index.html — synk-motoren over på adapter

**Files:**
- Modify: `index.html` — importlinjene (linje 157-158), DEFAULTS (linje 162-168), hele blokken `/* ========== GitHub-synk ========== */` (linje 751-841), autosynk-kallsteder (linje 577 `maybeAutoSync` er OK som er, 838-841, 1254-1256), lagre-knappen i `viewSettings` (linje 718-731)

**Interfaces:**
- Consumes: `githubStore` fra `stores.js`; `mergeProgress`, `mergeSettings`, `SYNCED_SETTINGS` fra `sync.js`.
- Produces (brukes av Task 7/9/10):
  - `activeStore() → adapter | null` — OAuth-auth hvis satt (Task 7 fyller `store.get().auth`), ellers legacy PAT, ellers `null`
  - `syncNow(statusEl, silent)` — samme signatur som før, nå adapterbasert + innstillings-synk + tema-pull
  - `DEFAULTS` utvidet: toppnivå `auth: null`; `meta.settingsUpdatedAt: 0`; settings utvidet med `aiProvider: "anthropic"`, `aiBaseUrl: ""`

- [ ] **Step 1: Utvid import og DEFAULTS**

Linje 157-158 blir:

```js
import { newCardState, schedule, isLeech, isMature, DAY } from "./srs.js";
import { buildSession, unlockedLessons, allRefs, progressKey } from "./queue.js";
import { githubStore, driveStore, githubUser, ensureGithubRepo } from "./stores.js";
import { SYNCED_SETTINGS, mergeProgress, mergeSettings, parseShareHash } from "./sync.js";
```

DEFAULTS (linje 162-168) blir:

```js
const DEFAULTS = {
  progress: {},
  settings: { newPerDay: 10, autoRead: false, readQuestion: false, readExample: false, unlocked: [],
    model: "claude-opus-4-8", apiKey: "", aiProvider: "anthropic", aiBaseUrl: "",
    ghRepo: "", ghPat: "", autoSync: false },
  auth: null,          // {provider, token, refreshToken?, expiresAt?, user:{name,avatar}, repo?}
  decksCache: {},
  meta: { newUsedByDay: {}, notes: {}, lastSync: 0, settingsUpdatedAt: 0 },
};
```

- [ ] **Step 2: Erstatt synk-blokken (linje 751-841)**

Hele `/* ========== GitHub-synk ========== */`-blokken (b64enc/b64dec, ghCfg, ghFetch, ghGet, ghPut, mergedPayload, syncNow, maybeAutoSync) erstattes med:

```js
/* ========== synk (adapterbasert) ========== */
// Google-token med automatisk refresh implementeres i Task 7; frem til da
// finnes ikke google-auth i praksis (ingen login-UI).
async function googleAccessToken() {
  const a = store.get().auth;
  if (!a || a.provider !== "google") throw new Error("Ikke logget inn med Google.");
  if (Date.now() < (a.expiresAt || 0) - 60000) return a.token;
  const r = await fetch("/api/auth", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "google", refresh_token: a.refreshToken }),
  });
  if (!r.ok) {
    store.patch(s => { s.auth = null; });
    throw new Error("Google-innloggingen er utløpt — logg inn på nytt.");
  }
  const t = await r.json();
  store.patch(s => { s.auth.token = t.access_token; s.auth.expiresAt = Date.now() + (t.expires_in || 3600) * 1000; });
  return t.access_token;
}

function activeStore() {
  const { auth, settings } = store.get();
  if (auth?.provider === "github") return githubStore({ token: auth.token, repo: auth.repo });
  if (auth?.provider === "google") return driveStore({ getToken: googleAccessToken });
  if (settings.ghRepo && settings.ghPat) return githubStore({ token: settings.ghPat, repo: settings.ghRepo });
  return null;
}

async function syncNow(statusEl, silent = false) {
  const say = (m) => { if (statusEl) statusEl.textContent = m; };
  const st = activeStore();
  if (!st) { say("Logg inn (eller sett PAT under Avansert) for å synke."); return; }
  try {
    say("Synker …");
    // 1) fremgang — merge, skriv, prøv én gang til ved versjonskonflikt
    let attempt = 0;
    while (true) {
      const remote = await st.load("progress.json");
      const d = store.get();
      const merged = mergeProgress(
        { progress: d.progress, notes: d.meta.notes, newUsedByDay: d.meta.newUsedByDay },
        remote?.json || null);
      try { await st.save("progress.json", JSON.stringify(merged), remote?.version); }
      catch (e) { if (e.conflict && attempt++ < 1) continue; throw e; }
      store.patch(s => {
        s.progress = merged.progress;
        s.meta.notes = merged.notes;
        s.meta.newUsedByDay = merged.newUsedByDay;
      });
      break;
    }
    // 2) innstillinger — siste skriving vinner
    const remoteS = await st.load("settings.json");
    const d = store.get();
    const m = mergeSettings({ values: d.settings, updatedAt: d.meta.settingsUpdatedAt }, remoteS?.json || null);
    if (m.source === "remote") {
      store.patch(s => { Object.assign(s.settings, m.values); s.meta.settingsUpdatedAt = m.updatedAt; });
    } else if (!remoteS || JSON.stringify(remoteS.json.values) !== JSON.stringify(m.values)) {
      await st.save("settings.json", JSON.stringify({ updatedAt: m.updatedAt, values: m.values }), remoteS?.version);
    }
    // 3) egne tema: dytt lokale …
    for (const deck of decks()) {
      if (!deck.own) continue;
      const path = `decks/${deck.id}.json`;
      const remote = await st.load(path);
      await st.save(path, JSON.stringify(deck, null, 1), remote?.version);
    }
    // … og hent tema som bare finnes eksternt (ny enhet)
    for (const path of await st.list("decks/")) {
      const id = path.slice("decks/".length).replace(/\.json$/, "");
      if (store.get().decksCache[id]) continue;
      const remote = await st.load(path);
      if (remote) {
        try { const deck = validateDeck(remote.json); deck.own = true; cacheDeck(deck); }
        catch { /* ugyldig fil eksternt — hopp over */ }
      }
    }
    store.patch(s => { s.meta.lastSync = Date.now(); });
    say("Synket ✓");
  } catch (e) {
    say("Synk feilet: " + e.message);
    if (!silent && !statusEl) alert("Synk feilet: " + e.message);
  }
}
function maybeAutoSync() {
  const s = store.get().settings;
  if (s.autoSync && activeStore()) syncNow(null, true);
}
```

- [ ] **Step 3: Oppdater kallsteder og lagre-knapp**

- Linje 1254-1256 (i generate-dialogens lagring): erstatt

```js
  const st = store.get().settings;
  if (st.ghRepo && st.ghPat) syncNow(null, true);
```

med

```js
  if (activeStore()) syncNow(null, true);
```

- I `viewSettings` sin `$("#save").onclick` (linje 718-731): legg til `d.meta.settingsUpdatedAt = Date.now();` som siste linje i `store.patch(d => { … })`.

- [ ] **Step 4: Verifiser manuelt**

- `node --test test/` → grønt.
- `python3 -m http.server 8000` → åpne appen: hjem/økt/innstillinger fungerer; «Synk nå» uten PAT gir «Logg inn (eller sett PAT …)». Med gyldig PAT + repo: «Synket ✓», og progress.json/settings.json dukker opp i repoet (settings.json uten ghPat/ghRepo — kontroller!).
- Sjekk i devtools at `localStorage`-migrering gikk bra (gamle data beholdt, nye felter til stede).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Synk-motor over på lagringsadapter: innstillings-synk og tema-pull"
```

---

### Task 7: index.html — OAuth-innlogging og Konto-UI

**Files:**
- Modify: `index.html` — ny klient-auth-blokk (legges rett før synk-blokken fra Task 6), `viewSettings` (linje ~691-716), boot-blokken (linje ~1313-1315)

**Interfaces:**
- Consumes: `/api/auth` (Task 1), `githubUser`/`ensureGithubRepo` (Task 3), `activeStore`/`syncNow` (Task 6).
- Produces (brukes av Task 10): `authConfig() → Promise<{github_client_id, google_client_id, google_api_key} | null>`, `APP_URL()`, `startLogin(provider)`, `store.get().auth` utfylt etter innlogging.

- [ ] **Step 1: Legg til klient-auth-blokk**

Rett før `/* ========== synk (adapterbasert) ========== */`:

```js
/* ========== innlogging (OAuth via /api/auth) ========== */
const APP_URL = () => location.origin + location.pathname;
let authCfgCache;
async function authConfig() {
  if (authCfgCache !== undefined) return authCfgCache;
  try {
    const r = await fetch("/api/auth");
    authCfgCache = r.ok ? await r.json() : null;
  } catch { authCfgCache = null; } // statisk server uten funksjoner
  return authCfgCache;
}

async function startLogin(provider) {
  const cfg = await authConfig();
  if (!cfg) { alert("Innlogging er ikke tilgjengelig på denne serveren."); return; }
  const state = provider + ":" + crypto.randomUUID();
  sessionStorage.setItem("flash:oauthstate", state);
  const ru = encodeURIComponent(APP_URL());
  location.href = provider === "github"
    ? `https://github.com/login/oauth/authorize?client_id=${cfg.github_client_id}&scope=${encodeURIComponent("repo gist")}&state=${state}&redirect_uri=${ru}`
    : `https://accounts.google.com/o/oauth2/v2/auth?client_id=${cfg.google_client_id}&response_type=code&access_type=offline&prompt=consent&scope=${encodeURIComponent("openid email profile https://www.googleapis.com/auth/drive.file")}&state=${state}&redirect_uri=${ru}`;
}

async function handleOAuthCallback() {
  const q = new URLSearchParams(location.search);
  const code = q.get("code"), state = q.get("state");
  if (!code || !state) return;
  history.replaceState(null, "", APP_URL() + location.hash); // fjern code fra URL-en
  const expected = sessionStorage.getItem("flash:oauthstate");
  sessionStorage.removeItem("flash:oauthstate");
  if (state !== expected) { alert("Innlogging avbrutt: state stemmer ikke."); return; }
  const provider = state.split(":")[0];
  try {
    const r = await fetch("/api/auth", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, code, redirect_uri: APP_URL() }),
    });
    const t = await r.json();
    if (!r.ok) throw new Error(t.error || `HTTP ${r.status}`);
    if (provider === "github") {
      const u = await githubUser(t.access_token);
      const repo = await ensureGithubRepo(t.access_token, u.login);
      store.patch(s => { s.auth = { provider, token: t.access_token,
        user: { name: u.name || u.login, avatar: u.avatar_url || "" }, repo }; });
    } else {
      const ur = await fetch("https://www.googleapis.com/oauth2/v3/userinfo",
        { headers: { Authorization: `Bearer ${t.access_token}` } });
      const u = ur.ok ? await ur.json() : {};
      store.patch(s => { s.auth = { provider, token: t.access_token,
        refreshToken: t.refresh_token || "",
        expiresAt: Date.now() + (t.expires_in || 3600) * 1000,
        user: { name: u.name || u.email || "Google-bruker", avatar: u.picture || "" } }; });
    }
    syncNow(null, true); // hent alt til den nye enheten med en gang
  } catch (e) { alert("Innlogging feilet: " + e.message); }
}
```

- [ ] **Step 2: Konto-seksjon i `viewSettings`**

Erstatt `<h2>GitHub-synk (valgfritt)</h2>` + de fire GitHub-linjene (linje 704-711) med:

```html
<h2>Konto og synk</h2>
<div id="acct"><p class="muted small">Laster …</p></div>
<label><input type="checkbox" id="s-autosync" ${s.autoSync ? "checked" : ""} style="width:auto"> Synk automatisk etter hver økt</label>
<p><button id="syncnow">Synk nå</button>
   <span class="muted small">${last ? "sist synket " + new Date(last).toLocaleString("no") : "aldri synket"}</span></p>
<p id="syncstatus" class="small"></p>
<details style="margin:.6rem 0">
  <summary class="muted small">Avansert: synk med egen PAT (uten innlogging)</summary>
  <p class="muted small">Bruk en fine-grained PAT begrenset til ett repo (Contents: read/write). Lagres kun lokalt.</p>
  <label>Repo (eier/navn)</label><input id="s-repo" value="${esc(s.ghRepo)}" placeholder="hmelberg/flash-data">
  <label>Personal Access Token</label><input id="s-pat" type="password" value="${esc(s.ghPat)}">
</details>
```

og legg til etter `app.innerHTML = …`-blokken i `viewSettings`:

```js
  renderAccount($("#acct"));
```

med denne funksjonen rett etter `viewSettings`:

```js
async function renderAccount(el) {
  const a = store.get().auth;
  if (a) {
    el.innerHTML = `<p>${a.user.avatar ? `<img src="${esc(a.user.avatar)}" alt="" style="width:24px;height:24px;border-radius:50%;vertical-align:middle"> ` : ""}
      Logget inn som <strong>${esc(a.user.name)}</strong> (${a.provider === "github" ? "GitHub" : "Google"}) —
      innstillinger, API-nøkkel, fremgang og egne tema synkes hit.
      <button id="logout" class="linkish">Logg ut</button></p>`;
    $("#logout", el).onclick = () => { store.patch(s => { s.auth = null; }); viewSettings(); };
    return;
  }
  const cfg = await authConfig();
  if (!cfg || (!cfg.github_client_id && !cfg.google_client_id)) {
    el.innerHTML = `<p class="muted small">Innlogging er ikke satt opp på denne serveren — bruk PAT under «Avansert» hvis du vil synke.</p>`;
    return;
  }
  el.innerHTML = `<p>
      ${cfg.github_client_id ? `<button id="login-gh">Logg inn med GitHub</button>` : ""}
      ${cfg.google_client_id ? `<button id="login-g">Logg inn med Google</button>` : ""}</p>
    <p class="muted small">Alt lagres i din egen GitHub / Google Drive — ingen sentral database.</p>`;
  const gh = $("#login-gh", el); if (gh) gh.onclick = () => startLogin("github");
  const g = $("#login-g", el); if (g) g.onclick = () => startLogin("google");
}
```

- [ ] **Step 3: Boot-rekkefølge**

Boot-blokken (linje ~1313) blir:

```js
/* ========== boot ========== */
await handleOAuthCallback();
await loadBuiltins();
render();
```

- [ ] **Step 4: Verifiser manuelt**

- `node --test test/` → grønt.
- `python3 -m http.server 8000` (ingen funksjoner): Innstillinger viser «Innlogging er ikke satt opp …» — appen fungerer ellers som før.
- `netlify dev` med `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` satt i `.env` (en test-OAuth-app med callback `http://localhost:8888/`): full innlogging → `flash-data`-repo opprettes, «Logget inn som …» vises, synk går. (Google-flyten testes tilsvarende når GCP-oppsettet i Task 13 er gjort — funksjonaliteten er klar nå.)
- Logg ut → login-knappene er tilbake, PAT-fallback virker fortsatt.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "OAuth-innlogging (GitHub/Google) med Konto-seksjon i innstillinger"
```

---

### Task 8: index.html — KI-innstillinger og bytte til ai.js

**Files:**
- Modify: `index.html` — KI-blokken i `viewSettings` (linje 700-703 + lagre-handler 718-731), Claude-blokken (linje 843-906: `aiAvailable`, `getSdk`, `aiError`, `aiMessage`), importlinje

**Interfaces:**
- Consumes: `aiMessage`, `aiError` fra `ai.js` (Task 5).
- Produces: `aiMessage(body, opts)` beholder sin GAMLE signatur internt i appen (kallstedene på linje ~962, ~1131, ~1272 er uendret) — den blir en tynn wrapper som henter cfg fra settings.

- [ ] **Step 1: Bytt ut KI-klienten**

- Importlinjene utvides med:

```js
import { aiMessage as aiCall, aiError } from "./ai.js";
```

- Slett `getSdk`-funksjonen, `sdkModule`-variabelen, `aiError`-funksjonen og hele den gamle `aiMessage`-implementasjonen (linje 846-906). Behold `aiAvailable()`. Legg inn wrapper:

```js
function aiAvailable() { return !!store.get().settings.apiKey; }
function aiMessage(body, opts = {}) {
  const { aiProvider, apiKey, aiBaseUrl } = store.get().settings;
  return aiCall({ aiProvider, apiKey, aiBaseUrl }, body, opts);
}
```

(Kallstedene bruker `aiMessage({model, max_tokens, system, messages}, {onText})` som før — ingen endring der. `aiError` kommer nå fra modulen.)

- [ ] **Step 2: KI-innstillinger i `viewSettings`**

Erstatt KI-seksjonen (linje 700-703):

```html
<h2>KI (valgfritt)</h2>
<p class="muted small">Appen virker fint uten — dette skrur på forklaringer, kortgenerering og omskriving.
   Nøkkelen sendes kun til KI-leverandøren du velger${store.get().auth ? ", og synkes til din egen lagring" : " og lagres kun i denne nettleseren"}.</p>
<label>Leverandør</label>
<select id="s-aiprovider">
  <option value="anthropic" ${s.aiProvider !== "openai" ? "selected" : ""}>Anthropic (Claude)</option>
  <option value="openai" ${s.aiProvider === "openai" ? "selected" : ""}>OpenAI-kompatibel (OpenRouter, Gemini, Groq, Ollama …)</option>
</select>
<div id="s-baseurlrow" class="${s.aiProvider === "openai" ? "" : "hidden"}">
  <label>Base-URL</label><input id="s-baseurl" value="${esc(s.aiBaseUrl)}" placeholder="https://openrouter.ai/api/v1">
  <p class="muted small">api.openai.com kan ikke kalles direkte fra nettleser (CORS) — bruk f.eks. OpenRouter.</p>
</div>
<label>API-nøkkel</label><input id="s-key" type="password" value="${esc(s.apiKey)}" placeholder="sk-…">
<label>Modell</label><input id="s-model" value="${esc(s.model)}">
```

og wiring etter `app.innerHTML`:

```js
  $("#s-aiprovider").onchange = () => $("#s-baseurlrow").classList.toggle("hidden", $("#s-aiprovider").value !== "openai");
```

I `$("#save").onclick`-patchen: legg til

```js
      d.settings.aiProvider = $("#s-aiprovider").value;
      d.settings.aiBaseUrl = $("#s-baseurl").value.trim();
```

og endre modell-fallbacken til `d.settings.model = $("#s-model").value.trim() || (d.settings.aiProvider === "openai" ? "" : "claude-opus-4-8");`

- [ ] **Step 3: Verifiser manuelt**

- `node --test test/` → grønt.
- I appen: uten nøkkel — ingen KI-knapper (som før). Med Anthropic-nøkkel: «Mer info»/✨-generering fungerer med streaming som før. Bytt leverandør til OpenAI-kompatibel uten base-URL → forklarende feilmelding fra `ai.js` i dialogen.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "KI-innstillinger med leverandørvalg; aiMessage via ai.js, SDK-import fjernet"
```

---

### Task 9: Deling — `#deck=`-lenker med forhåndsvisning

**Files:**
- Modify: `index.html` — ny funksjon `handleShareHash` (legges ved deck-innlastingsfunksjonene, etter `loadDeckFromFile` linje ~223), boot-blokken

**Interfaces:**
- Consumes: `parseShareHash` (sync.js), `validateDeck`, `cacheDeck`, `openDialog` (index.html:908).
- Produces: åpning av `https://<site>/#deck=<uri-enkodet JSON-URL>` viser forhåndsvisning og importerer ved bekreftelse.

- [ ] **Step 1: Implementer `handleShareHash`**

```js
async function handleShareHash() {
  const url = parseShareHash(location.hash);
  if (!url) return;
  location.hash = "#home";
  let deck;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    deck = validateDeck(await r.json());
  } catch (e) { alert("Klarte ikke å hente det delte temaet: " + e.message); return; }
  const nCards = deck.lessons.reduce((n, l) => n + l.cards.length, 0);
  const finnes = !!store.get().decksCache[deck.id];
  const dlg = openDialog(`<div style="padding:1.2rem">
    <h2 style="margin-top:0">📬 Delt tema</h2>
    <p><strong>${esc(deck.title)}</strong> — ${deck.lessons.length} leksjoner, ${nCards} kort.</p>
    ${finnes ? `<p class="small" style="color:var(--danger)">Du har allerede et tema med id «${esc(deck.id)}» — det blir erstattet (fremgangen beholdes).</p>` : ""}
    <div style="display:flex;gap:.6rem;justify-content:flex-end;margin-top:.8rem">
      <button onclick="this.closest('dialog').close()">Avbryt</button>
      <button class="primary" id="share-add">Legg til</button></div></div>`);
  $("#share-add", dlg).onclick = () => { cacheDeck(deck); dlg.close(); render(); };
}
```

- [ ] **Step 2: Kall i boot**

```js
await handleOAuthCallback();
await loadBuiltins();
await handleShareHash();
render();
```

- [ ] **Step 3: Verifiser manuelt**

- `python3 -m http.server 8000` → åpne `http://localhost:8000/#deck=` + `encodeURIComponent("http://localhost:8000/decks/russian.json")` (lag lenken i devtools-konsollen). Forvent dialog «Delt tema … 94 kort» med erstatt-advarsel; «Legg til» → temaet på hjemsiden. Ugyldig URL → alert med feilmelding.
- `node --test test/` → grønt.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Delingslenker: #deck=<url> med forhåndsvisning før import"
```

---

### Task 10: Del-knapp for egne tema (gist / Drive)

**Files:**
- Modify: `index.html` — `viewBrowse` temaliste (linje 597-604) og ny funksjon `shareDeck` (legges ved `handleShareHash`)

**Interfaces:**
- Consumes: `store.get().auth`, `googleAccessToken` (Task 6), `authConfig` (Task 7), `APP_URL`.
- Produces: knapp «del» ved egne tema i Bla-listen → delingslenke på utklippstavlen.

- [ ] **Step 1: Knapp i temalisten**

I `viewBrowse` (linje 597-600) endres radmalen til:

```js
    const rows = decks().map(d =>
      `<div class="deckrow"><a href="#browse/${encodeURIComponent(d.id)}"><strong>${esc(d.title)}</strong></a>
       <span class="counts">${d.lessons.reduce((n, l) => n + l.cards.length, 0)} kort · ${d.lessons.length} leksjoner
       ${d.own ? `· <span class="badge">eget</span> <button class="small" data-share="${esc(d.id)}">🔗 del</button>` : ""}</span></div>`).join("");
```

og etter `const g = $("#genbtn"); …`-linjen (linje 603):

```js
    app.querySelectorAll("[data-share]").forEach(b => b.onclick = () => shareDeck(b.dataset.share));
```

- [ ] **Step 2: Implementer `shareDeck`**

```js
async function shareDeck(id) {
  const deck = store.get().decksCache[id];
  const a = store.get().auth;
  if (!deck) return;
  if (!a) { alert("Logg inn med GitHub eller Google (Innstillinger) for å dele."); return; }
  try {
    let rawUrl;
    const content = JSON.stringify(deck, null, 1);
    if (a.provider === "github") {
      const r = await fetch("https://api.github.com/gists", {
        method: "POST",
        headers: { Authorization: `Bearer ${a.token}`, Accept: "application/vnd.github+json" },
        body: JSON.stringify({ public: false, description: `flash-tema: ${deck.title}`,
          files: { [`${deck.id}.json`]: { content } } }),
      });
      if (!r.ok) throw new Error(`GitHub gist: HTTP ${r.status}`);
      rawUrl = (await r.json()).files[`${deck.id}.json`].raw_url;
    } else {
      const token = await googleAccessToken();
      const boundary = "flashshare";
      const body = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify({ name: `flash-delt-${deck.id}.json` }) +
        `\r\n--${boundary}\r\ncontent-type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
      const cr = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` },
        body,
      });
      if (!cr.ok) throw new Error(`Drive: HTTP ${cr.status}`);
      const fid = (await cr.json()).id;
      const pr = await fetch(`https://www.googleapis.com/drive/v3/files/${fid}/permissions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      });
      if (!pr.ok) throw new Error(`Drive-deling: HTTP ${pr.status}`);
      const cfg = await authConfig();
      if (!cfg?.google_api_key) throw new Error("Serveren mangler GOOGLE_API_KEY — kan ikke lage offentlig lenke.");
      rawUrl = `https://www.googleapis.com/drive/v3/files/${fid}?alt=media&key=${cfg.google_api_key}`;
    }
    const link = `${APP_URL()}#deck=${encodeURIComponent(rawUrl)}`;
    await navigator.clipboard.writeText(link);
    alert("Delingslenke kopiert til utklippstavlen:\n\n" + link);
  } catch (e) { alert("Deling feilet: " + e.message); }
}
```

- [ ] **Step 3: Verifiser manuelt**

- Med GitHub-innlogging: «🔗 del» på et eget tema → lenke på utklippstavlen; åpne lenken i inkognito → forhåndsvisning + import fungerer (gist-raw har CORS: `Access-Control-Allow-Origin: *`).
- `node --test test/` → grønt.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Del-knapp for egne tema: hemmelig gist (GitHub) / offentlig Drive-fil (Google)"
```

---

### Task 11: «Utforsk»-katalog med emner

**Files:**
- Modify: `index.html` — nav-header (linje 148-153), router (linje 1287-1288), ny `viewExplore`

**Interfaces:**
- Consumes: `loadDeckFromUrl` (linje 214). Katalogformat: `index.json` = `[{id, title, topic, cards, author, url}]`; `url` kan være relativ til index-filen.
- Produces: `CATALOG_INDEX_URL`-konstant, fane «Utforsk».

- [ ] **Step 1: Nav og router**

Etter `<a href="#browse" data-nav="browse">Bla</a>` (linje 150):

```html
  <a href="#explore" data-nav="explore">Utforsk</a>
```

Router-mappen (linje 1287-1288) utvides:

```js
  ({ home: viewHome, session: viewSession, browse: viewBrowse,
     explore: viewExplore, stats: viewStats, settings: viewSettings }[v] || viewHome)();
```

- [ ] **Step 2: Implementer `viewExplore`** (legges etter `viewBrowse`)

```js
/* ========== utforsk (offentlig katalog) ========== */
const CATALOG_INDEX_URL = "https://raw.githubusercontent.com/hmelberg/flash-decks/main/index.json";

async function viewExplore() {
  app.innerHTML = `<h1>Utforsk</h1><p class="muted">Henter katalog …</p>`;
  let index;
  try {
    const r = await fetch(CATALOG_INDEX_URL, { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    index = await r.json();
  } catch (e) {
    app.innerHTML = `<h1>Utforsk</h1>
      <p class="muted">Klarte ikke å hente katalogen (${esc(e.message)}). Prøv igjen senere.</p>`;
    return;
  }
  if (currentView() !== "explore") return; // brukeren navigerte videre mens vi ventet
  const topics = {};
  for (const d of index) (topics[d.topic || "Annet"] ??= []).push(d);
  const mine = store.get().decksCache;
  app.innerHTML = `<h1>Utforsk</h1>` + Object.entries(topics).map(([topic, ds]) => `
    <h2>${esc(topic)}</h2>
    <div class="deckgrid">${ds.map(d => `<div class="decktile">
      <h3>${esc(d.title)}</h3>
      <p class="muted small">${d.cards ?? "?"} kort${d.author ? " · " + esc(d.author) : ""}</p>
      <div class="tilebtns">${mine[d.id]
        ? `<span class="muted small">✓ lagt til</span>`
        : `<button class="primary" data-cat="${esc(new URL(d.url, CATALOG_INDEX_URL).href)}">Legg til</button>`}</div>
      </div>`).join("")}</div>`).join("")
    + `<p class="muted small" style="margin-top:1.5rem">Har du laget et tema andre kan ha glede av?
       <a href="${CATALOG_INDEX_URL.replace("raw.githubusercontent.com", "github.com").replace("/main/index.json", "")}" target="_blank">Send en pull request til katalogen</a>.</p>`;
  app.querySelectorAll("[data-cat]").forEach(b => b.onclick = async () => {
    try { await loadDeckFromUrl(b.dataset.cat); location.hash = "#home"; }
    catch (e) { alert("Klarte ikke å hente temaet: " + e.message); }
  });
}
```

- [ ] **Step 3: Verifiser manuelt**

- Uten at katalog-repoet finnes ennå: «Utforsk» viser feilmeldingen pent (404). Lag en midlertidig lokal test: bytt `CATALOG_INDEX_URL` til `decks-index-test.json` i arbeidstreet med `[{"id":"russian","title":"Russisk","topic":"Språk","cards":94,"url":"decks/russian.json"}]`, sjekk visning + «Legg til» + «✓ lagt til», og tilbakestill konstanten etterpå (test-filen commites ikke).
- `node --test test/` → grønt.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Utforsk-fane: offentlig temakatalog fra flash-decks-repo, gruppert per emne"
```

---

### Task 12: «Lag kort med KI-chat» — kopierbar prompt på hjemsiden

**Files:**
- Modify: `index.html` — `viewHome` (linje 420-441) + ny funksjon `promptDialog`

**Interfaces:**
- Consumes: `prompts/generate-deck.md` (finnes i repoet, hentes relativt), `openDialog`.
- Produces: knapp på hjemsiden → dialog med forklaring + «Kopier prompt».

- [ ] **Step 1: Knapp i `viewHome`**

I `addrow`-diven (linje 433-438), legg til en linje etter den:

```html
    <p class="small" style="margin-top:.6rem"><button class="linkish" id="promptbtn">📋 Lag kort med en KI-chat (uten API-nøkkel)</button></p>
```

og i `wireHome()`:

```js
  $("#promptbtn").onclick = () => promptDialog();
```

- [ ] **Step 2: Implementer `promptDialog`** (legges etter `wireHome`)

```js
/* --- kopierbar prompt: lag kort i valgfri chatbot, importer JSON-svaret --- */
const PROMPT_SUFFIX = `

## Final output wrapper (important)

Wrap your entire output as ONE complete deck object, ready to save as a .json file:

{
  "id": "<short-kebab-slug for the topic>",
  "title": "<deck title in the learner's language>",
  "language": { "front": "<ISO code>", "back": "<ISO code>" },
  "settings": { "tts": <true if language cards, else false> },
  "lessons": [ …as specified above… ]
}

Output ONLY the JSON (no markdown fences, no commentary).`;

async function promptDialog() {
  let base = "";
  try {
    const r = await fetch("prompts/generate-deck.md", { cache: "no-cache" });
    if (r.ok) base = await r.text();
  } catch { /* håndteres under */ }
  if (!base) { alert("Fikk ikke hentet prompten — prøv igjen på nett."); return; }
  const full = base + PROMPT_SUFFIX;
  const dlg = openDialog(`<div style="padding:1.2rem;max-width:34rem">
    <h2 style="margin-top:0">📋 Lag kort med en KI-chat</h2>
    <p class="small">Du trenger ingen API-nøkkel: bruk ChatGPT, Claude, Gemini eller en annen chat du allerede har.</p>
    <ol class="small">
      <li>Kopier prompten under.</li>
      <li>Lim den inn i chatboten sammen med temaet ditt (f.eks. «norsk–spansk reiseordforråd»)
          eller teksten/notatene kortene skal lages fra.</li>
      <li>Lagre svaret som en <code>.json</code>-fil og hent den inn med 📄-knappen på hjemsiden.</li>
    </ol>
    <div style="display:flex;gap:.6rem;justify-content:flex-end;margin-top:.8rem">
      <button onclick="this.closest('dialog').close()">Lukk</button>
      <button class="primary" id="copyprompt">Kopier prompt</button></div></div>`);
  $("#copyprompt", dlg).onclick = async () => {
    await navigator.clipboard.writeText(full);
    $("#copyprompt", dlg).textContent = "Kopiert ✓";
  };
}
```

- [ ] **Step 3: Verifiser manuelt**

- Hjemsiden viser knappen; dialogen forklarer flyten; «Kopier prompt» → lim inn i en editor og sjekk at både basen fra `prompts/generate-deck.md` og wrapper-suffikset er med. Test hele flyten én gang: lim i en chatbot, lagre JSON, importer med 📄 — `validateDeck` skal godta resultatet.
- `node --test test/` → grønt.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Hjemside: kopierbar prompt for kortgenerering i valgfri KI-chat"
```

---

### Task 13: Dokumentasjon og engangsoppsett

**Files:**
- Modify: `README.md`
- Create: `docs/oppsett-innlogging.md`

**Interfaces:**
- Consumes: alt over.
- Produces: dokumentert oppsett; sjekkliste for de manuelle engangsstegene.

- [ ] **Step 1: `docs/oppsett-innlogging.md`**

Skriv en punktvis guide (norsk) som dekker:

1. **GitHub OAuth-app:** github.com → Settings → Developer settings → OAuth Apps → New. Homepage = site-URL, callback = site-URL (roten, f.eks. `https://<site>.netlify.app/`). Kopier client id/secret.
2. **Google Cloud:** nytt prosjekt → «OAuth consent screen» (External, produksjon — i testmodus dør refresh tokens etter 7 dager) → OAuth-klient (Web application, redirect = site-URL) → aktiver «Google Drive API» → lag API-nøkkel begrenset til Drive API + HTTP-referrer = site-domenet.
3. **Netlify-miljøvariabler:** `npx netlify env:set GITHUB_CLIENT_ID …` osv. for alle fem (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_API_KEY`).
4. **Katalog-repoet:** opprett offentlig repo `hmelberg/flash-decks` med `index.json` (format: `[{id, title, topic, cards, author, url}]`, `url` relativ til index-filen) og temafiler i emnemapper. Start med de to innebygde temaene.
5. **Lokal utvikling:** `netlify dev` + `.env` med test-OAuth-apper som peker på `http://localhost:8888/`.

- [ ] **Step 2: README-oppdatering**

Oppdater `README.md`: kort avsnitt under «Bruk» om innlogging/synk (GitHub/Google, hva som synkes, PAT-alternativet), deling (`#deck=`-lenker, del-knappen, Utforsk-katalogen), KI-leverandørvalg (inkl. CORS-merknaden om api.openai.com) og prompt-knappen. Nevn `docs/oppsett-innlogging.md` for drift/deploy. Fjern/juster setningen om at appen er «ingen server» slik at den nevner den valgfrie auth-funksjonen på Netlify.

- [ ] **Step 3: Kjør alt en siste gang**

`node --test test/` → alt grønt. Rask røyk-test i nettleser (`python3 -m http.server`).

- [ ] **Step 4: Commit**

```bash
git add README.md docs/oppsett-innlogging.md
git commit -m "Dokumentasjon: innlogging/synk/deling + engangsoppsett for OAuth og katalog"
```
