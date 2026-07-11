# flash — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Statisk flashcard-app (GitHub Pages) med FSRS-inspirert SRS, JSON-tema-filer, GitHub-synk og valgfri Claude-integrasjon.

**Architecture:** Én `index.html` (UI + lagring + synk + KI) pluss ren, enhetstestet planleggingsmodul `srs.js` (ESM, ingen DOM). Innhold i `decks/*.json`. CDN: KaTeX, `@anthropic-ai/sdk` (ESM).

**Tech Stack:** Vanilla JS (ES-moduler), KaTeX, Web Speech API, GitHub Contents API, Anthropic JS SDK (`dangerouslyAllowBrowser`), node innebygd `node --test` for srs-tester.

## Global Constraints

- Ingen byggetrinn, ingen server, ingen rammeverk. Alt kjører fra `file://` eller GitHub Pages.
- Ingen bakoverkompatibilitet — erstatt/slett fremfor å migrere.
- Nøkler (API-nøkkel, PAT) kun i localStorage; API-nøkkel kun til Anthropic, PAT kun til GitHub.
- KI-funksjoner skjult uten API-nøkkel; appen fullt brukbar uten.
- Modell-standard: `claude-opus-4-8` (endres i innstillinger).
- Spec: `docs/superpowers/specs/2026-07-11-flashcard-engine-design.md` — alle tallverdier (fuzz ±5–10 %, 10 nye/dag, leech ≥8 lapses, gating 80 % med stability ≥ 7d, maks intervall 365d, svartidsterskler 4s/15s) er normative.

---

### Task 1: `srs.js` — planleggingsmodul med tester

**Files:**
- Create: `srs.js`
- Test: `test/srs.test.js` (kjøres med `node --test test/`)

**Interfaces (Produces):**
- `newCardState() -> State` der `State = {stability, difficulty, due, lastReview, reps, lapses, suspended, history[]}`
- `schedule(state, grade, responseMs, now) -> State` — `grade ∈ {"ok","fail","never"}`; ren funksjon, muterer ikke input.
- `isLeech(state) -> bool` (lapses ≥ 8, ikke suspendert)
- `isMature(state) -> bool` (stability ≥ 21 dager)
- `retention(states, now) -> {mature: {ok, total}}` beregnes i UI fra history — IKKE i srs.js (YAGNI).

**Oppførsel (normativ):**
- `fail`: reps++, lapses++, difficulty +0.15 (clamp 0.1–1.0), stability = max(0.5d, stability × 0.3), due = now + 10 min (re-læring i økt håndteres av køen, ikke av srs).
- `ok`: vekstfaktor `f = 1.4 + 1.6 × (1 - difficulty)` (dvs. 1.56–2.84 ved difficulty 0.9–0.1), avtagende: `f = max(1.15, f × (30 / (30 + stabilityDays)))^…` — enklere: `interval' = stability × f`, med `f` redusert 20 % når stability > 60d. difficulty −0.03 (clamp).
- Svartid: `ok` med responseMs > 15000 → vekstfaktor × 0.7 og difficulty +0.05; `ok` med responseMs < 4000 og stability ≥ 7d → vekstfaktor × 1.1.
- Fuzz: ferdig intervall × uniform(0.95, 1.10) — deterministisk testbar via injiserbar `rng`-parameter (default `Math.random`).
- Maks intervall 365 dager. Første `ok` på nytt kort: 1 dag; andre: 3 dager (deretter formel).
- `never`: suspended = "never", due = now + 180d; neste `ok`/vising etter det: due += 365d.
- history: append `{t: now, grade, ms: responseMs}` (maks 100 innslag, eldste kastes).

- [ ] Skriv testene (intervallvekst, fail-oppførsel, svartid begge veier, fuzz-grenser med fast rng, maks intervall, never, leech, umodne/modne, ikke-mutasjon)
- [ ] Kjør `node --test test/` → alle feiler (modul finnes ikke)
- [ ] Implementér `srs.js`
- [ ] Kjør `node --test test/` → alle grønne
- [ ] Commit `feat: srs scheduling module with tests`

### Task 2: `queue.js` — øktkø (ren modul med tester)

**Files:**
- Create: `queue.js`
- Test: `test/queue.test.js`

**Interfaces:**
- Consumes: `State` fra srs.js.
- Produces: `buildSession({deck, progress, settings, now, newLimitUsedToday}) -> {due: cardRef[], newAvail: cardRef[], counts}` og `unlockedLessons(deck, progress) -> lessonId[]`.
  `cardRef = {deckId, cardId, rev: bool}` — `rev` markerer speilkort. Fremgangsnøkkel: `deckId + "/" + cardId + (rev ? "/r" : "")`.

**Oppførsel:**
- `due`: alle kort med `due <= now` og ikke suspendert, stokket (Fisher-Yates, injiserbar rng).
- Søsken-utsettelse: hvis både kort og speilkort er due, tas kun det som har eldst `due`; det andre utsettes til neste økt (flagges, ikke reschedules).
- Gating: leksjon N+1 er åpen når ≥80 % av leksjon N sine kort (inkl. speilkort) har stability ≥ 7d. Leksjon 1 alltid åpen. Manuelt opplåste leksjoner (settings.unlocked[]) alltid åpne.
- `newAvail`: useta kort fra tidligste åpne, uferdige leksjon, i forfatterrekkefølge, maks `settings.newPerDay − newLimitUsedToday`.

- [ ] Tester (due-plukking, søsken, gating-terskel eksakt 80 %, ny-grense, rekkefølge)
- [ ] Rød → implementér → grønn
- [ ] Commit `feat: session queue with gating and sibling burial`

### Task 3: `index.html` — skjelett, lagring, deck-innlasting

**Files:**
- Create: `index.html`

**Produces (interne moduler i `<script type="module">`):**
- `store`: tynn wrapper rundt localStorage under nøkkel `flash:v1` — `{progress: {key: State}, settings, decksCache, meta: {newUsedByDay, lastSync}}`. `store.get()`, `store.patch(fn)`, auto-persist.
- `loadDeck(source)`: source = innebygd navn | URL | File. Validering med presise feilmeldinger (leksjon/kort-indeks). Innebygd manifest: `const BUILTIN = ["russian", "probability"]`.
- Hoved-visninger (enkel hash-router): `#home` (deck-liste + due-tall), `#session`, `#browse/:deckId`, `#stats`, `#settings`.
- Grunn-CSS: mørk/lys via `prefers-color-scheme`, stor korttypografi, touch-vennlige knapper.

- [ ] Bygg skjelett + store + deck-lasting + hjem-visning med «X til repetisjon, Y nye»
- [ ] Manuell sjekk i nettleser (åpne fila, last innebygd deck-stub)
- [ ] Commit `feat: app skeleton, storage, deck loading`

### Task 4: Øktvisning (kort, snuing, karakterer, TTS, angre)

**Files:**
- Modify: `index.html`

**Oppførsel:**
- Rendering av front/back: ren tekst | KaTeX auto-render (`$…$`, `$$…$$`) | `{html}` | bilde | hint (bak «?» før snuing) | example på baksiden.
- Flip: mellomrom/klikk. Karakter: `1`/`←` fail, `3`/`→` ok, `0`/`x` never, `z` angre (gjenoppretter forrige State fra angre-buffer, ett nivå). Svartid måles fra kortvisning til flip.
- Re-læringskø i økt: fail → kortet legges tilbake ~3 posisjoner frem i køen (maks 2 ganger per økt).
- TTS: `speechSynthesis.speak` med `lang = deck.language.front`; autoplay ved flip hvis `settings.tts && deck.settings.tts`; egen 🔊-knapp.
- Øktslutt: oppsummering (antall, riktig-andel, nye lært), oppdater `newUsedByDay`.
- Leech: når `isLeech(state)` slår til første gang vises et diskret banner med «omskriv / suspender / behold».

- [ ] Implementér, test manuelt med stub-deck (alle korttyper: tekst, formel, html, bilde, reverse)
- [ ] Commit `feat: review session UI`

### Task 5: Bla/statistikk/innstillinger

**Files:**
- Modify: `index.html`

- `#browse`: leksjonsliste med lås/åpen-status og fremdrift; kortliste med state (ny/ung/moden/leech/suspendert), un-suspend, manuell opplåsing av leksjon.
- `#stats`: retensjonsrate på modne kort (fra history, siste 30 dager), repetisjoner per dag (siste 14, enkel søylerad), telling ny/ung/moden.
- `#settings`: nye per dag, TTS av/på, autoplay, API-nøkkel, modellvalg, GitHub-repo (`owner/repo`) + PAT, eksport/import av alt (JSON-fil).

- [ ] Implementér, manuell sjekk
- [ ] Commit `feat: browse, stats, settings, export/import`

### Task 6: GitHub-synk

**Files:**
- Modify: `index.html`

**Oppførsel:**
- Contents API: `GET/PUT https://api.github.com/repos/{owner}/{repo}/contents/{path}` med `Authorization: Bearer <PAT>`; base64 innhold; PUT krever `sha` ved oppdatering.
- Filer i brukerens repo: `progress.json` (hele progress+meta), `decks/<id>.json` for egne/redigerte decks.
- Synk-algoritme: hent remote `progress.json` → per kort-nøkkel vinner nyeste `lastReview` → skriv merged tilbake → oppdater lokalt. 409/sha-mismatch: hent på nytt, merge, prøv én gang til. 401: be om ny PAT. Nettverksfeil: melding, fortsett lokalt.
- Auto-synk ved øktslutt hvis konfigurert; manuell «Synk nå»-knapp i settings.

- [ ] Implementér, manuell test mot et testrepo
- [ ] Commit `feat: GitHub sync for progress and decks`

### Task 7: Claude-integrasjon

**Files:**
- Modify: `index.html`

**Oppførsel:**
- SDK fra CDN: `import Anthropic from "https://esm.sh/@anthropic-ai/sdk"`; klient med `{apiKey, dangerouslyAllowBrowser: true}`. Verifiser i nettleser at CORS fungerer; hvis SDK-import feiler fra esm.sh, fall tilbake til rå `fetch` mot `https://api.anthropic.com/v1/messages` med headerne `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`.
- **Forklar mer** (bakside-knapp): streaming (`client.messages.stream`), prompt = kortets front/back/example/hint + `deck.explainContext`, maks ~500 ord, vis inkrementelt, «lagre som notat» → `state.note`. Avbryt-knapp (AbortController).
- **Generer kort** (i #browse): skjema {tema, antall (1–20), nivå, ekstra instruks} → `messages.create` med `output_config.format` (json_schema for `{cards: [{id, front, back, hint?, example?, tts?, reverse?, tags?}]}`, `additionalProperties: false`) → forhåndsvisning med avhuking per kort → lagres i valgt leksjon (nytt eller eksisterende deck i localStorage; synkbar).
- Feil: typede statuser (401 → «sjekk nøkkel», 429 → ventetid fra `retry-after`, `stop_reason === "refusal"` → melding). KI-UI skjules helt uten nøkkel.

- [ ] Implementér, manuell test (Hans har egen nøkkel)
- [ ] Commit `feat: Claude explain + card generation`

### Task 8: Eksempel-decks

**Files:**
- Create: `decks/russian.json` — 9 leksjoner, ~90 kort: alfabet/uttale, hilsener & høflighet, pronomen + быть, substantiv & kjønn, tall 1–100, hverdagsverb presens (жить/говорить/пить/есть/идти …), nominativ vs akkusativ (cloze-kort), mat & adjektiver, spørsmål & preteritum. Gloser: `reverse: true`, `tts`, eksempelsetning. Grammatikk: HTML-tabeller (bøyningsmønstre), cloze i `front`.
- Create: `decks/probability.json` — 9 leksjoner, ~80 kort: mengder & telling, aksiomer & grunnregler, betinget & Bayes, diskrete fordelinger (Bernoulli/binomisk/Poisson), kontinuerlige (uniform/eksponensial/normal), forventning & varians, kovarians & korrelasjon, LLN & CLT, estimering & KI + hypotesetest-intro. KaTeX i front/back, cloze for formler («$\operatorname{Var}(aX+b) = \_\_\_$»), definisjonskort begge veier der det gir mening.

- [ ] Skriv `russian.json`, validér mot loadDeck
- [ ] Skriv `probability.json`, validér
- [ ] Commit `feat: russian and probability example decks`

### Task 9: README + avslutning

**Files:**
- Create: `README.md` — hva appen er, hvordan hoste på GitHub Pages, deck-format-referanse (kopiert fra spec), hvordan sette opp GitHub-synk (PAT-scopes) og KI (nøkkel).

- [ ] Skriv README
- [ ] Kjør `node --test test/` en siste gang → grønt
- [ ] Commit `docs: README` og oppsummer for Hans (inkl. forslag om GitHub-repo + Pages)

## Self-review

- Spec-dekning: alle spec-punkter mappet til task 1–9 (SRS→1, kø/gating/søsken→2, lagring/innlasting→3, økt-UI/TTS/angre/leech-banner→4, statistikk/retensjon→5, synk→6, KI→7, decks→8, docs→9). Backlog-punkter bevisst utelatt.
- Typekonsistens: `State`, `cardRef`, fremgangsnøkkel `deckId/cardId[/r]` brukes likt i task 1–6.
- Ingen placeholders: normative tallverdier står i task-tekstene eller Global Constraints.
