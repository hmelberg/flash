# flash — fleksibel flashcard-motor med spaced repetition

**Dato:** 2026-07-11
**Status:** Godkjent design, klar for implementasjonsplan

## Mål

En statisk web-app (GitHub Pages, ingen byggetrinn, ingen server) som gjør det raskt å lære et hvilket som helst tema via flashcards med spaced repetition. Motoren er generisk; alt innhold ligger i separate JSON-tema-filer («decks»). Første to tema: russisk (gloser + grammatikk) og sannsynlighet/statistikk.

## Ikke-mål

- Ingen backend, ingen brukerkontoer, ingen deling mellom brukere.
- Ingen bakoverkompatibilitet med tidligere formater (ingen brukere ennå — erstatt/slett fremfor å migrere).
- Ingen avansert merge-logikk ved synk-konflikt (nyeste tidsstempel vinner per kort).

## Arkitektur

```
flash/
├── index.html          # hele appen: UI, rendering, synk, KI (vanilla JS)
├── srs.js              # ren planleggingsmodul, ingen DOM, enhetstestbar
├── decks/
│   ├── russian.json
│   └── probability.json
└── docs/superpowers/specs/…
```

CDN-avhengigheter (ESM): KaTeX (matematikk), `@anthropic-ai/sdk` (KI-funksjoner).
Web Speech API (`speechSynthesis`) for opplesing — innebygd i nettleseren, ingen avhengighet.

## Tema-format (deck JSON)

```json
{
  "id": "russian-basics",
  "title": "Russisk for nybegynnere",
  "language": { "front": "ru", "back": "en" },
  "explainContext": "The user is learning Russian from English, beginner level.",
  "settings": { "tts": true, "font": "system" },
  "lessons": [
    {
      "id": "l01-alphabet",
      "title": "Alfabetet og første ord",
      "note": "Valgfri intro (markdown), vises når leksjonen åpnes",
      "cards": [
        {
          "id": "voda",
          "front": "вода",
          "back": "water",
          "hint": "Sounds like 'vodka' — literally 'little water'",
          "example": { "text": "Я пью воду.", "translation": "I drink water." },
          "tts": "вода",
          "image": "https://…/water.jpg",
          "reverse": true,
          "tags": ["noun", "food"]
        }
      ]
    }
  ]
}
```

- `front`/`back`: ren tekst, `$…$`/`$$…$$` for KaTeX, eller objekt `{"html": "…"}` for rå HTML (tabeller, lister osv.).
- `reverse: true` genererer speilkortet (back→front) som eget kort med egen SRS-historikk.
- `example` vises på baksiden sammen med svaret (kontekst styrker hukommelsen).
- `tts`: tekst som leses opp med `speechSynthesis`, språkkode fra `language.front`. Autoplay ved avsløring kan slås av/på i innstillinger.
- Grammatikk- og mattekort bruker samme format — `front` er spørsmålet, `back` er svaret (HTML-tabell / KaTeX-formel). Ingen egne korttyper.
- Kort-ID-er må være unike innen decket. Fremgang nøkles på `deckId/cardId[/rev]`.

## Lagring (tre nivåer)

| Nivå | Innhold | Når |
|---|---|---|
| localStorage | fremgang, innstillinger, API-nøkkel, PAT, egne/genererte kort | alltid, automatisk |
| Fil-eksport/-import | JSON-dump av alt | manuelt (backup/flytting) |
| GitHub-repo (valgfritt) | `decks/*.json` + `progress.json` i **brukerens eget repo** via Contents API + PAT | synk-knapp + auto ved øktslutt |

- Fremgang lagres **adskilt fra kortinnhold** (per kort-ID) — tema-filer kan oppdateres uten tap av historikk.
- Konflikt: nyeste `updated`-tidsstempel vinner per kort.
- Sikkerhet: nøkler kun i localStorage. Appen anbefaler fine-grained PAT begrenset til ett repo. API-nøkkel sendes kun til Anthropic, PAT kun til GitHub.

## Innlasting av tema

Tre kilder: (1) innebygde decks fra `decks/`-katalogen, (2) URL til vilkårlig JSON-fil, (3) lokal fil (file picker). Innlastede decks caches i localStorage.

## SRS-planlegger (`srs.js`)

FSRS-inspirert, forenklet. Per kort: `{ stability, difficulty, lastReview, due, reps, lapses, history[] }`.

**To svar-knapper** (besluttet etter vurdering — binær karaktergiving er raskere, mer konsistent og nesten like informativ som graderte skalaer; svartid dekker «nja»-signalet objektivt):

- **Ikke OK** (`1`/`←`): lapse. Kortet re-vises i samme økt (læringskø: ~1 min, så ~10 min), deretter kort intervall (1 dag). `difficulty` øker, `stability` reduseres kraftig.
- **OK** (`3`/`→`): intervall vokser med faktor avhengig av `stability` og `difficulty` (typisk ×2,5–3 tidlig, avtagende vekst).
- **Svartid som modifikator:** tid fra kortvisning til avsløring logges. OK med svartid over terskel (~15 s, kalibrerbar) får redusert intervallvekst (behandles som «hardt»). Rask OK (<4 s) på modent kort får litt ekstra vekst.
- **«Nesten aldri gjenta»** (`0`/`x`): suspendert med lang hale — re-vises én gang etter ~6 mnd, deretter årlig. Kan angres i kortlisten.
- **Intervall-fuzz:** ±5–10 % tilfeldighet på hvert intervall, så kort lært samme dag ikke klumper seg på samme fremtidige dager.
- **Maks intervall:** 1 år.
- Mellomrom/klikk snur kortet. Alt betjenes med én hånd.
- **Angre siste svar** (`z`): ruller tilbake siste karakter (feiltrykk skjer i énhånds-flyt).

### Kø-regler

- **Nye kort per dag:** myk grense, standard 10 (justerbar) — beskytter mot repetisjonsskred senere.
- **Søsken-utsettelse:** et korts speilkort (`reverse`) vises aldri i samme økt — ellers gir korttidshukommelsen falskt lette svar.
- **Leech-deteksjon:** kort med ≥8 lapses flagges som leech; appen foreslår omskriving (med valgfri KI-hjelp: «foreslå bedre formulering») eller suspendering.

### Statistikk (minimal)

- **Retensjonsrate på modne kort** — kalibreringstall: >~95 % betyr for forsiktige intervaller, <~80 % for aggressive.
- Repetisjoner per dag (enkel liste/graf), antall modne/unge/nye kort.

`srs.js` er en ren modul: `schedule(cardState, grade, responseMs, now) → nyCardState`. Enhetstestes med node (ingen rammeverk, enkel assert-fil).

## Pedagogisk struktur — myk gating

- Leksjoner har forfatterbestemt rekkefølge; hver bygger på de forrige (kumulativt).
- Nye kort introduseres alltid fra **tidligste uferdige leksjon**, i rekkefølge.
- Neste leksjon «åpner» når ~80 % av forrige leksjons kort har `stability` ≥ 7 dager — men brukeren kan alltid hoppe frem manuelt.
- Øktstart viser «X til repetisjon, Y nye tilgjengelige»; brukeren velger bare-repetisjon eller repetisjon + N nye.

## KI-integrasjon (valgfri, egen API-nøkkel)

- Nettleser-direkte kall med offisiell JS-SDK (`dangerouslyAllowBrowser: true`), modell `claude-opus-4-8` (endres i innstillinger).
- **«Forklar mer»** på baksiden: streamer forklaring inn i panel på kortet. Kontekst: front, back, example, deckets `explainContext`. Kan lagres som varig notat på kortet.
- **Generer kort:** dialog (tema, antall, nivå, valgfri instruks) → structured outputs mot kortskjemaet (garantert gyldig JSON) → forhåndsvisning med per-kort stryking → lagres i valgt leksjon (localStorage, synkes til GitHub som andre kort).
- Uten API-nøkkel er KI-funksjonene skjult; appen er fullt brukbar uten.

## Eksempel-decks

1. **`russian.json`** — russisk ↔ engelsk, ~8–10 leksjoner: alfabet/uttale, hilsener, pronomen + å være, substantiv & kjønn, tall, hverdagsverb (presens), kasus-intro (nominativ/akkusativ), mat & adjektiver, spørsmål & preteritum. Gloser med eksempelsetninger + TTS, grammatikkort med HTML-tabeller. `reverse: true` på gloser.
2. **`probability.json`** — sannsynlighet/statistikk, ~8–10 leksjoner: mengder & telling, sannsynlighetsaksiomer, betinget sannsynlighet & Bayes, diskrete fordelinger, kontinuerlige fordelinger, forventning & varians, samvariasjon, store talls lov & CLT, estimering, hypotesetesting. KaTeX-formler, kumulativ oppbygging (Bayes forutsetter betinget, CLT forutsetter forventning/varians osv.).

Begge er omfattende nok til reell bruk (~60–100 kort hver).

## Feilhåndtering

- GitHub-synk: nettverksfeil → beskjed + fortsett lokalt; 401 → be om ny PAT; 409 (SHA-konflikt) → hent på nytt, tidsstempel-merge, skriv igjen.
- KI: `stop_reason`-sjekk, typede SDK-feil (rate limit → beskjed med ventetid), avbrytbar streaming.
- Korrupt deck-JSON: valideres ved innlasting med presis feilmelding (hvilken leksjon/hvilket kort).

## Testing

- `srs.js`: enhetstester (node, enkel assert) — intervallvekst, lapse-oppførsel, svartid-modifikator, «nesten aldri», fuzz-grenser, leech-flagging, gating-terskel.
- Resten: manuell testing i nettleser (Hans tester småting selv, jf. arbeidsflyt).

## Backlog (bevisst utsatt)

- **Typed input:** skrive svaret for tvungen produksjon — sterkere retrieval for gloser, men bryter rask-flyt; kan bli per-kort-valg senere.
- **Lyttekort:** TTS spilles med skjult tekst (tredje kortretning for språk).
- Cloze-kort trenger *ikke* motorstøtte — det er en forfatterteknikk i `front`-feltet; eksempelfilene bruker den der den passer.
