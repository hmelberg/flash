import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSession, unlockedLessons, progressKey } from "../queue.js";
import { newCardState, DAY } from "../srs.js";

const NOW = Date.parse("2026-07-11T10:00:00Z");
const noShuffle = () => 0; // Fisher-Yates med rng()=0 er deterministisk

function deck() {
  return {
    id: "d",
    title: "Test",
    lessons: [
      { id: "l1", title: "L1", cards: [
        { id: "a", front: "A", back: "1", reverse: true },
        { id: "b", front: "B", back: "2" },
      ]},
      { id: "l2", title: "L2", cards: [
        { id: "c", front: "C", back: "3" },
        { id: "d", front: "D", back: "4" },
      ]},
    ],
  };
}

const st = (over) => ({ ...newCardState(), ...over });

test("progressKey inkluderer /r for speilkort", () => {
  assert.equal(progressKey("d", "a", false), "d/a");
  assert.equal(progressKey("d", "a", true), "d/a/r");
});

test("due plukker forfalte, ikke-suspenderte kort", () => {
  const progress = {
    "d/a": st({ due: NOW - DAY, stability: 3 }),
    "d/b": st({ due: NOW + DAY, stability: 3 }),
  };
  const s = buildSession({ deck: deck(), progress, settings: { newPerDay: 10 }, now: NOW, newLimitUsedToday: 0, rng: noShuffle });
  assert.deepEqual(s.due.map(r => r.cardId), ["a"]);
});

test("never-suspendert kort med passert due kommer med", () => {
  const progress = { "d/a": st({ due: NOW - 1, suspended: "never", stability: 3 }) };
  const s = buildSession({ deck: deck(), progress, settings: { newPerDay: 0 }, now: NOW, newLimitUsedToday: 0, rng: noShuffle });
  assert.equal(s.due.length, 1);
});

test("søsken: bare eldste due vises, det andre begraves", () => {
  const progress = {
    "d/a":   st({ due: NOW - 2 * DAY, stability: 3 }),
    "d/a/r": st({ due: NOW - 1 * DAY, stability: 3 }),
  };
  const s = buildSession({ deck: deck(), progress, settings: { newPerDay: 0 }, now: NOW, newLimitUsedToday: 0, rng: noShuffle });
  assert.equal(s.due.length, 1);
  assert.equal(s.due[0].rev, false);
  assert.equal(s.counts.buried, 1);
});

test("gating: l2 låst til 80 % av l1 har stability >= 7", () => {
  // l1 har 3 refs (a, a/r, b). 2/3 = 67 % < 80 % → låst
  let progress = {
    "d/a":   st({ stability: 10 }),
    "d/a/r": st({ stability: 10 }),
  };
  assert.deepEqual(unlockedLessons(deck(), progress, {}), ["l1"]);
  // 3/3 → åpen
  progress["d/b"] = st({ stability: 7 });
  assert.deepEqual(unlockedLessons(deck(), progress, {}), ["l1", "l2"]);
});

test("manuell opplåsing overstyrer gating", () => {
  const settings = { unlocked: ["d/l2"] };
  assert.deepEqual(unlockedLessons(deck(), {}, settings), ["l1", "l2"]);
});

test("nye kort: rekkefølge, dagsgrense og aldri søsken i samme økt", () => {
  const s = buildSession({ deck: deck(), progress: {}, settings: { newPerDay: 2 }, now: NOW, newLimitUsedToday: 0, rng: noShuffle });
  // l2 er låst; a/r hoppes over fordi a alt er med i økten → a, b
  assert.deepEqual(s.newAvail.map(r => progressKey(r.deckId, r.cardId, r.rev)), ["d/a", "d/b"]);
});

test("nytt speilkort hoppes over når originalen er due i samme økt", () => {
  const progress = { "d/a": st({ due: NOW - DAY, stability: 3 }) };
  const s = buildSession({ deck: deck(), progress, settings: { newPerDay: 10 }, now: NOW, newLimitUsedToday: 0, rng: noShuffle });
  const keys = s.newAvail.map(r => progressKey(r.deckId, r.cardId, r.rev));
  assert.ok(!keys.includes("d/a/r"), "a/r skal ikke være med når a er due");
});

test("brukt dagskvote reduserer nye", () => {
  const s = buildSession({ deck: deck(), progress: {}, settings: { newPerDay: 2 }, now: NOW, newLimitUsedToday: 1, rng: noShuffle });
  assert.equal(s.newAvail.length, 1);
});
