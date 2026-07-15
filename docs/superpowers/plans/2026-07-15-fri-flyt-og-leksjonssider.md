# flash — fri flyt, hopp over kjent stoff, leksjonssider: implementasjonsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fri modus som standard (alle leksjoner åpne, dagsgrense = pacing, «＋N nye» i oppsummering), parkér kjent stoff per kort/leksjon, hopp over leksjoner, og markdown-introsider per leksjon.

**Architecture:** Ingen endring i `srs.js`. `queue.js` får `flowMode`/`skipped`-logikk. `sync.js` utvider whitelisten. Resten er UI i `index.html`. Spec: `docs/superpowers/specs/2026-07-15-fri-flyt-og-leksjonssider-design.md`.

**Tech Stack:** som før — vanilla JS, `node --test`.

## Global Constraints

- All UI-tekst på **engelsk** (app-språket etter 2026-07-15); kodekommentarer norsk.
- `node --test` grønt før hver commit; `node --check` på uttrukket inline-modul etter index.html-endringer.
- `flowMode` default `"free"`, `skipped` default `[]`; `SYNCED_SETTINGS` += `flowMode`, `unlocked`, `skipped`.

---

### Task 1: queue.js — fri modus og skipped

**Files:** Modify `queue.js` · Test `test/queue.test.js`

**Interfaces:** `unlockedLessons(deck, progress, settings)` → alle leksjons-id-er når `settings.flowMode !== "guided"`. `buildSession` hopper over leksjoner i `settings.skipped` («deckId/lessonId») i ny-kort-løkken; forfalte påvirkes ikke. I guidet modus kvalifiserer skipped-leksjoner gaten.

- [ ] Skriv feilende tester i `test/queue.test.js`: (a) fri modus (default og eksplisitt) åpner alle leksjoner uansett fremgang; (b) `flowMode: "guided"` gir dagens gating (eksisterende tester settes til guided der de tester gating); (c) skipped-leksjon gir ingen nye kort men forfalte vises; (d) i guided kvalifiserer skipped gaten for neste leksjon.
- [ ] Implementér:

```js
export function unlockedLessons(deck, progress, settings = {}) {
  if ((settings.flowMode || "free") !== "guided")
    return deck.lessons.map(l => l.id);            // fri modus: alt åpent
  const skipped = new Set(settings.skipped || []);
  const manual = new Set(settings.unlocked || []);
  const open = [];
  let prevOk = true;
  for (const lesson of deck.lessons) {
    const isOpen = prevOk || manual.has(`${deck.id}/${lesson.id}`);
    if (isOpen) open.push(lesson.id);
    if (skipped.has(`${deck.id}/${lesson.id}`)) { prevOk = isOpen; continue; } // teller som kvalifisert
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
```

I `buildSession`-ny-løkken, etter `if (!open.has(r.lessonId)) continue;`:

```js
    if (skippedSet.has(`${r.deckId}/${r.lessonId}`)) continue; // hoppet over: ingen nye
```

med `const skippedSet = new Set(settings.skipped || []);` øverst.

- [ ] `node --test` grønt → commit `queue.js: fri modus som standard, skipped-leksjoner`.

---

### Task 2: Innstillinger — flowMode/skipped i DEFAULTS, synk-whitelist, UI

**Files:** Modify `sync.js`, `index.html` (DEFAULTS + Learning-seksjonen + save-handler) · Test `test/sync.test.js`

- [ ] `sync.js`: `SYNCED_SETTINGS` += `"flowMode", "unlocked", "skipped"`. Test: whitelisten inneholder dem.
- [ ] `index.html` DEFAULTS-settings: `flowMode: "free", skipped: []` (behold `unlocked: []`).
- [ ] Learning-seksjonen i `viewSettings` får:

```html
<label>Lesson flow</label>
<select id="s-flowmode">
  <option value="free" ${s.flowMode !== "guided" ? "selected" : ""}>Free — all lessons open (default)</option>
  <option value="guided" ${s.flowMode === "guided" ? "selected" : ""}>Guided — lessons unlock step by step (80 % mastery)</option>
</select>
```

og i save-handler: `d.settings.flowMode = $("#s-flowmode").value;`

- [ ] Tester + `node --check` → commit `Innstilling for fri/guidet flyt; synk flowMode/unlocked/skipped`.

---

### Task 3: Økt — «＋N nye kort» i oppsummering, 💤-knapp på nye kort, never-statistikk

**Files:** Modify `index.html` (`gradeCard`, `undoLast`, `viewSession` gradebar, `viewSummary`)

- [ ] `gradeCard`/`undoLast`: `never` telles ikke i ok/fail/total: i gradeCard, pakk stats-oppdateringene i `if (grade !== "never") { … }`; i undoLast tilsvarende `if (u.grade !== "never") { … }`.
- [ ] Gradebar (kun når kortet er nytt — `!state || state.due === 0` er tilgjengelig i `viewSession`):

```js
${session.flipped ? `
  <div class="gradebar">
    <button class="fail" data-grade="fail" title="← or 1">✕ Not OK</button>
    ${(!state || state.due === 0) ? `<button data-grade="never" title="I already know this — park it (~6 months)">💤 Know it</button>` : ""}
    <button class="ok" data-grade="ok" title="space, → or 3">✓ OK</button>
  </div>` : ""}
```

- [ ] `viewSummary`: før `session = null`, regn ut tilgjengelige nye (`buildSession({deck: session.deck, progress, settings, now: Date.now(), newLimitUsedToday: 0})`) og vis ved > 0:

```html
<p style="text-align:center"><button class="primary" id="sum-more">＋${n} more new cards</button>
   <button onclick="location.hash='#home'">Back home</button></p>
```

`#sum-more` → `startSession(deckId, true, true)` (extraNew). Husk å ta vare på `deckId` før `session = null`.

- [ ] Tester + `node --check` + rask manuell sjekk → commit `Økt: fortsett med flere nye kort; 💤 «Know it» på nye kort`.

---

### Task 4: Bla — leksjonshandlinger (kan dette / hopp over / vekk)

**Files:** Modify `index.html` (`viewBrowse` deck-detalj: leksjonsoverskriften + wiring)

- [ ] I leksjonsoverskriften (etter ▶/unlock-knappene): beregn per leksjon `allSuspended` (alle refs har `suspended`) og `isSkipped` (`settings.skipped`), og render:

```js
${allSuspended
  ? `<button class="small" data-wakelesson="${esc(l.id)}">wake lesson</button>`
  : `<button class="small" data-know="${esc(l.id)}" title="Park all cards (~6 months, then yearly)">✔ know this</button>`}
<button class="small" data-skip="${esc(l.id)}" title="No new cards from this lesson (reviews still shown)">${isSkipped ? "⏭ skipped ✓" : "⏭ skip"}</button>
```

- [ ] Wiring:

```js
app.querySelectorAll("[data-know]").forEach(b => b.onclick = () => {
  const l = deck.lessons.find(x => x.id === b.dataset.know);
  const now = Date.now();
  store.patch(s => {
    for (const c of l.cards) for (const rev of c.reverse ? [false, true] : [false]) {
      const key = progressKey(deck.id, c.id, rev);
      const st = s.progress[key] || newCardState();
      st.suspended = "never"; st.due = now + 180 * DAY;
      s.progress[key] = st;
    }
  });
  render();
});
app.querySelectorAll("[data-wakelesson]").forEach(b => b.onclick = () => {
  const l = deck.lessons.find(x => x.id === b.dataset.wakelesson);
  store.patch(s => {
    for (const c of l.cards) for (const rev of c.reverse ? [false, true] : [false]) {
      const st = s.progress[progressKey(deck.id, c.id, rev)];
      if (st?.suspended) { st.suspended = false; st.due = Date.now(); st.lapses = 0; }
    }
  });
  render();
});
app.querySelectorAll("[data-skip]").forEach(b => b.onclick = () => {
  const key = `${deck.id}/${b.dataset.skip}`;
  store.patch(s => {
    const i = s.settings.skipped.indexOf(key);
    i >= 0 ? s.settings.skipped.splice(i, 1) : s.settings.skipped.push(key);
    s.meta.settingsUpdatedAt = Date.now();
  });
  render();
});
```

(`newCardState` er allerede importert i index.html.)

- [ ] I fri modus skjules 🔒/«lås opp» automatisk (alle leksjoner er åpne via `unlockedLessons`) — verifiser.
- [ ] Tester + `node --check` + manuell sjekk → commit `Bla: parkér/vekk leksjon og hopp over ny-kort-flyt`.

---

### Task 5: Leksjonssider — `lesson.intro`

**Files:** Modify `index.html` (`validateDeck`, `viewSession`, `viewBrowse`)

- [ ] `validateDeck`: etter cards-sjekkene: `if (l.intro != null && typeof l.intro !== "string") fail(\`lesson '${l.id}': 'intro' must be a string\`);`
- [ ] `viewSession`: rett etter `const ref = currentRef(); if (!ref) return viewSummary();` — introside før første NYE kort i leksjonen:

```js
  const lesson = session.deck.lessons.find(l => l.id === ref.lessonId);
  const refState = store.get().progress[progressKey(ref.deckId, ref.cardId, ref.rev)];
  session.introShown ??= new Set();
  if (lesson?.intro && (!refState || refState.due === 0) && !session.introShown.has(lesson.id)) {
    app.innerHTML = `<div class="smeta"><span class="deckname">${esc(session.deck.title)}</span></div>
      <div class="cardwrap"><div class="card" style="cursor:default;text-align:left">
        <h2 style="margin-top:0">📖 ${esc(lesson.title)}</h2><div id="introbody" class="mdbox"></div>
      </div></div>
      <p style="text-align:center"><button class="primary" id="introgo">Continue to the cards →</button></p>`;
    mdRender($("#introbody"), lesson.intro);
    $("#introgo").onclick = () => { session.introShown.add(lesson.id); render(); };
    return;
  }
```

(NB: `mdRender` er definert lenger ned i fila — funksjonsdeklarasjoner hoistes, OK.)

- [ ] `viewBrowse` leksjonsoverskrift: `${l.intro ? `<button class="iconbtn" data-intro="${esc(l.id)}" title="Read the lesson intro">📖</button>` : ""}` + skjult `<div class="mdbox hidden" data-introbody="${esc(l.id)}"></div>` etter `note`-avsnittet; wiring toggler `.hidden` og kaller `mdRender` første gang.
- [ ] Tester + `node --check` + manuell sjekk (legg midlertidig `intro` på en russisk-leksjon i devtools/lokal fil) → commit `Leksjonssider: markdown-intro i økt og Bla`.

---

### Task 6: KI-generering og dokumentasjon av formatet

**Files:** Modify `index.html` (`GEN_SCHEMA`, `saveGenerated`, `PROMPT_SUFFIX`), `prompts/generate-deck.md`, `README.md`

- [ ] `GEN_SCHEMA` lesson-properties: `intro: { anyOf: [{ type: "string" }, { type: "null" }] }`, `required: ["id", "title", "note", "intro", "cards"]`.
- [ ] `saveGenerated`: `if (gl.intro) lesson.intro = gl.intro;` (ved ny-leksjon-grenen).
- [ ] `prompts/generate-deck.md`: nytt punkt under output-format: valgfritt `intro`-felt per leksjon — konsis markdown (~100–250 ord, `$math$` ok) som presenterer leksjonens system/mønster (grammatikkregelen, notasjonen, konteksten); null når kortene taler for seg selv. `PROMPT_SUFFIX`-wrapperen er uendret (lessons arves).
- [ ] `README.md` tema-format: `"intro": "valgfri markdown-side som vises før leksjonens kort"` i eksempelet + én forklarende linje; nevn fri/guidet flyt og «know this»/skip under Bruk.
- [ ] Tester → commit `KI-generering og README: lesson.intro, fri flyt dokumentert`.

---

### Task 7: Verifisering og utrulling

- [ ] `node --test` (alt grønt) + `node --check` på inline-modulen.
- [ ] Manuell nettleser-runde (lokal server): fri modus uten 🔒; guided-select gir 🔒 tilbake; 💤-knapp kun på nye kort; «＋N more new cards» i oppsummering fortsetter økten; know/skip/wake i Bla; introside i økt + 📖 i Bla; delingslenke fungerer fortsatt.
- [ ] Merge til main, push (deploy).
