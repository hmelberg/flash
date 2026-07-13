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
