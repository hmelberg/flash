// queue.js — bygger øktkøen: forfalte kort, nye kort, myk gating, søsken-utsettelse.
// Ren modul, ingen DOM. Se spec for normative verdier.

export function progressKey(deckId, cardId, rev) {
  return `${deckId}/${cardId}${rev ? "/r" : ""}`;
}

// Alle kort-referanser i decket, i forfatterrekkefølge (speilkort rett etter originalen).
export function allRefs(deck) {
  const refs = [];
  for (const lesson of deck.lessons) {
    for (const card of lesson.cards) {
      refs.push({ deckId: deck.id, lessonId: lesson.id, cardId: card.id, rev: false, card });
      if (card.reverse) refs.push({ deckId: deck.id, lessonId: lesson.id, cardId: card.id, rev: true, card });
    }
  }
  return refs;
}

// Leksjons-ID-er som er åpne. Fri modus (standard): alle. Guidet: l1 alltid;
// lN+1 når >= 80 % av lN har stability >= 7d; settings.unlocked ("deckId/lessonId")
// låser opp manuelt, og skipped-leksjoner regnes som kvalifiserte.
export function unlockedLessons(deck, progress, settings = {}) {
  if ((settings.flowMode || "free") !== "guided")
    return deck.lessons.map(l => l.id); // fri modus: alt åpent
  const skipped = new Set(settings.skipped || []);
  const manual = new Set(settings.unlocked || []);
  const open = [];
  let prevOk = true;
  for (const lesson of deck.lessons) {
    const isOpen = prevOk || manual.has(`${deck.id}/${lesson.id}`);
    if (isOpen) open.push(lesson.id);
    if (skipped.has(`${deck.id}/${lesson.id}`)) { prevOk = isOpen; continue; } // hoppet over: teller som kvalifisert
    // beregn om DENNE leksjonen kvalifiserer neste
    const refs = [];
    for (const card of lesson.cards) {
      refs.push(progressKey(deck.id, card.id, false));
      if (card.reverse) refs.push(progressKey(deck.id, card.id, true));
    }
    const learned = refs.filter(k => (progress[k]?.stability ?? 0) >= 7).length;
    prevOk = isOpen && refs.length > 0 && learned / refs.length >= 0.8;
  }
  return open;
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildSession({ deck, progress, settings, now, newLimitUsedToday = 0, rng = Math.random }) {
  const open = new Set(unlockedLessons(deck, progress, settings));
  const refs = allRefs(deck);

  // Forfalte
  let due = refs.filter(r => {
    const st = progress[progressKey(r.deckId, r.cardId, r.rev)];
    return st && st.due > 0 && st.due <= now;
  });

  // Søsken-utsettelse: behold kun eldste due av (kort, speilkort)
  let buried = 0;
  const byCard = new Map();
  for (const r of due) {
    const base = `${r.deckId}/${r.cardId}`;
    const st = progress[progressKey(r.deckId, r.cardId, r.rev)];
    const existing = byCard.get(base);
    if (!existing) {
      byCard.set(base, { r, due: st.due });
    } else {
      buried += 1;
      if (st.due < existing.due) byCard.set(base, { r, due: st.due });
    }
  }
  due = shuffle([...byCard.values()].map(x => x.r), rng);

  // Nye: fra tidligste åpne, uferdige leksjon, i rekkefølge.
  // Søsken-regel gjelder også her: aldri kort + speilkort i samme økt.
  const inSession = new Set(due.map(r => `${r.deckId}/${r.cardId}`));
  const limit = Math.max(0, (settings.newPerDay ?? 10) - newLimitUsedToday);
  const skippedSet = new Set(settings.skipped || []);
  const newAvail = [];
  for (const r of refs) {
    if (newAvail.length >= limit) break;
    if (!open.has(r.lessonId)) continue;
    if (skippedSet.has(`${r.deckId}/${r.lessonId}`)) continue; // hoppet over: ingen nye
    const base = `${r.deckId}/${r.cardId}`;
    if (inSession.has(base)) { buried += 1; continue; }
    const st = progress[progressKey(r.deckId, r.cardId, r.rev)];
    if (!st || st.due === 0) { newAvail.push(r); inSession.add(base); }
  }

  return { due, newAvail, counts: { due: due.length, new: newAvail.length, buried } };
}
