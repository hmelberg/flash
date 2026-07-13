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
