import { test } from "node:test";
import assert from "node:assert/strict";
import { newCardState, schedule, isLeech, isMature, DAY } from "../srs.js";

const NOW = Date.parse("2026-07-11T10:00:00Z");
const rngLow = () => 0;      // fuzz-faktor 0.95
const rngHigh = () => 0.9999; // fuzz-faktor ~1.10
const rngMid = () => 1 / 3;  // fuzz-faktor 1.00

function okN(state, n, { ms = 6000, gapDays = 0 } = {}) {
  let s = state, t = NOW;
  for (let i = 0; i < n; i++) {
    s = schedule(s, "ok", ms, t, rngMid);
    t = s.due + (gapDays * DAY);
  }
  return s;
}

test("nytt kort har forventet starttilstand", () => {
  const s = newCardState();
  assert.equal(s.stability, 0);
  assert.equal(s.reps, 0);
  assert.equal(s.lapses, 0);
  assert.equal(s.suspended, false);
  assert.deepEqual(s.history, []);
});

test("schedule muterer ikke input", () => {
  const s = newCardState();
  const frozen = JSON.stringify(s);
  schedule(s, "ok", 5000, NOW, rngMid);
  assert.equal(JSON.stringify(s), frozen);
});

test("første ok gir 1 dag, andre gir 3 dager", () => {
  let s = schedule(newCardState(), "ok", 5000, NOW, rngMid);
  assert.equal(s.stability, 1);
  assert.ok(Math.abs(s.due - (NOW + 1 * DAY)) < 60_000);
  s = schedule(s, "ok", 5000, NOW + DAY, rngMid);
  assert.equal(s.stability, 3);
});

test("intervall vokser med ok og formel fra tredje repetisjon", () => {
  let s = okN(newCardState(), 3);
  // tredje ok: stability 3 * f, f = 1.4 + 1.6*(1-difficulty), difficulty synker fra 0.3
  assert.ok(s.stability > 6, `stability ${s.stability} bør være > 6`);
  assert.ok(s.stability < 10, `stability ${s.stability} bør være < 10`);
});

test("fail nullstiller mot re-læring og øker difficulty", () => {
  let s = okN(newCardState(), 4);
  const stabBefore = s.stability, diffBefore = s.difficulty;
  s = schedule(s, "fail", 8000, NOW, rngMid);
  assert.equal(s.lapses, 1);
  assert.ok(s.difficulty > diffBefore);
  assert.ok(Math.abs(s.stability - Math.max(0.5, stabBefore * 0.3)) < 1e-9);
  assert.ok(s.due - NOW <= 11 * 60_000, "due ~10 min frem");
});

test("treg ok (>15s) gir mindre vekst enn rask ok", () => {
  const base = okN(newCardState(), 3);
  const slow = schedule(base, "ok", 20_000, NOW, rngMid);
  const normal = schedule(base, "ok", 6000, NOW, rngMid);
  assert.ok(slow.stability < normal.stability);
  assert.ok(slow.difficulty > normal.difficulty);
});

test("rask ok (<4s) på modent kort gir litt ekstra vekst", () => {
  const base = okN(newCardState(), 4); // stability > 7
  assert.ok(base.stability >= 7);
  const fast = schedule(base, "ok", 2000, NOW, rngMid);
  const normal = schedule(base, "ok", 6000, NOW, rngMid);
  assert.ok(fast.stability > normal.stability);
});

test("fuzz holder seg innenfor [0.95, 1.10]", () => {
  const base = okN(newCardState(), 3);
  const lo = schedule(base, "ok", 6000, NOW, rngLow);
  const hi = schedule(base, "ok", 6000, NOW, rngHigh);
  const mid = schedule(base, "ok", 6000, NOW, rngMid);
  assert.ok(Math.abs(lo.stability / mid.stability - 0.95) < 0.01);
  assert.ok(Math.abs(hi.stability / mid.stability - 1.10) < 0.01);
});

test("maks intervall er 365 dager", () => {
  let s = okN(newCardState(), 25);
  assert.ok(s.stability <= 365);
  assert.ok(s.due - s.lastReview <= 365 * DAY + 1000);
});

test("never suspenderer med 180 dager, deretter årlig", () => {
  let s = schedule(okN(newCardState(), 2), "never", 3000, NOW, rngMid);
  assert.equal(s.suspended, "never");
  assert.ok(Math.abs(s.due - (NOW + 180 * DAY)) < 60_000);
  const later = s.due;
  s = schedule(s, "ok", 3000, later, rngMid);
  assert.equal(s.suspended, "never");
  assert.ok(Math.abs(s.due - (later + 365 * DAY)) < 60_000);
});

test("isLeech ved 8 lapses", () => {
  let s = newCardState();
  for (let i = 0; i < 8; i++) s = schedule(s, "fail", 5000, NOW, rngMid);
  assert.equal(isLeech(s), true);
  assert.equal(isLeech(schedule(newCardState(), "fail", 5000, NOW, rngMid)), false);
});

test("isMature ved stability >= 21 dager", () => {
  assert.equal(isMature({ stability: 20.9 }), false);
  assert.equal(isMature({ stability: 21 }), true);
});

test("history logges med tak på 100", () => {
  let s = newCardState();
  for (let i = 0; i < 110; i++) s = schedule(s, "ok", 5000, NOW + i * DAY, rngMid);
  assert.equal(s.history.length, 100);
  const h = s.history.at(-1);
  assert.equal(h.grade, "ok");
  assert.equal(h.ms, 5000);
});
