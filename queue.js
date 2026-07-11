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

// Leksjons-ID-er som er åpne: l1 alltid; lN+1 når >= 80 % av lN har stability >= 7d.
// settings.unlocked kan inneholde "deckId/lessonId" for manuell opplåsing.
export function unlockedLessons(deck, progress, settings = {}) {
  const manual = new Set(settings.unlocked || []);
  const open = [];
  let prevOk = true;
  for (const lesson of deck.lessons) {
    const isOpen = prevOk || manual.has(`${deck.id}/${lesson.id}`);
    if (isOpen) open.push(lesson.id);
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

  // Nye: fra tidligste åpne, uferdige leksjon, i rekkefølge
  const limit = Math.max(0, (settings.newPerDay ?? 10) - newLimitUsedToday);
  const newAvail = [];
  for (const r of refs) {
    if (newAvail.length >= limit) break;
    if (!open.has(r.lessonId)) continue;
    const st = progress[progressKey(r.deckId, r.cardId, r.rev)];
    if (!st || st.due === 0) newAvail.push(r);
  }

  return { due, newAvail, counts: { due: due.length, new: newAvail.length, buried } };
}
