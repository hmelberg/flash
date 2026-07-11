// srs.js — ren FSRS-inspirert planlegger. Ingen DOM, ingen sideeffekter.
// Se docs/superpowers/specs/2026-07-11-flashcard-engine-design.md for normative verdier.

export const DAY = 24 * 60 * 60 * 1000;
const MAX_INTERVAL_DAYS = 365;
const MAX_HISTORY = 100;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function newCardState() {
  return {
    stability: 0,      // dager
    difficulty: 0.3,   // 0.1–1.0
    due: 0,            // ms epoch (0 = aldri vist)
    lastReview: null,
    reps: 0,
    lapses: 0,
    suspended: false,  // false | "never"
    history: [],
  };
}

export function schedule(state, grade, responseMs, now, rng = Math.random) {
  const s = structuredClone(state);
  s.reps += 1;
  s.lastReview = now;
  s.history.push({ t: now, grade, ms: responseMs });
  if (s.history.length > MAX_HISTORY) s.history.splice(0, s.history.length - MAX_HISTORY);

  if (grade === "never") {
    s.suspended = "never";
    s.due = now + 180 * DAY;
    return s;
  }

  if (grade === "fail") {
    s.lapses += 1;
    s.difficulty = clamp(s.difficulty + 0.15, 0.1, 1.0);
    s.stability = Math.max(0.5, s.stability * 0.3);
    s.due = now + 10 * 60 * 1000;
    return s;
  }

  // grade === "ok"
  if (s.suspended === "never") {
    s.due = now + 365 * DAY; // årlig hale etter første 6-mnd-visning
    return s;
  }

  let intervalDays;
  if (s.stability === 0) {
    intervalDays = 1;
  } else if (s.stability <= 1) {
    intervalDays = 3;
  } else {
    let f = 1.4 + 1.6 * (1 - s.difficulty);
    if (s.stability > 60) f *= 0.8;
    if (responseMs > 15_000) {
      f *= 0.7;
      s.difficulty = clamp(s.difficulty + 0.05, 0.1, 1.0);
    } else if (responseMs < 4_000 && s.stability >= 7) {
      f *= 1.1;
    }
    intervalDays = s.stability * f * (0.95 + rng() * 0.15); // fuzz
  }
  s.difficulty = clamp(s.difficulty - 0.03, 0.1, 1.0);
  intervalDays = Math.min(intervalDays, MAX_INTERVAL_DAYS);
  s.stability = intervalDays;
  s.due = now + intervalDays * DAY;
  return s;
}

export function isLeech(state) {
  return !state.suspended && state.lapses >= 8;
}

export function isMature(state) {
  return state.stability >= 21;
}
