// Ren synk-logikk — ingen DOM, ingen fetch. Testes med node --test.

export const SYNCED_SETTINGS = [
  "newPerDay", "autoRead", "readQuestion", "readExample",
  "model", "apiKey", "aiProvider", "aiBaseUrl", "autoSync",
  "flowMode", "unlocked", "skipped",
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
