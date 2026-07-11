# ⚡ flash

Fleksibel flashcard-app med spaced repetition. Statisk — ingen server, ingen byggetrinn. Motoren er generisk; alt innhold ligger i JSON-tema-filer i `decks/`.

**Innebygde tema:** Russisk for nybegynnere (94 kort) · Sannsynlighet og statistikk (80 kort).

## Kjøre

- **Lokalt:** `python3 -m http.server` i denne mappen → `http://localhost:8000` (ES-moduler krever http, ikke `file://`).
- **GitHub Pages:** push repoet, aktiver Pages (Settings → Pages → Deploy from branch → `main`, rot). Ferdig.

## Bruk

- **Økt:** mellomrom/klikk snur kortet. <kbd>1</kbd>/<kbd>←</kbd> ikke OK · <kbd>3</kbd>/<kbd>→</kbd> OK · <kbd>0</kbd> nesten aldri gjenta · <kbd>z</kbd> angre.
- Svartid brukes automatisk: trege OK-svar får forsiktigere intervaller, raske får litt ekstra.
- Nye kort kommer fra tidligste uferdige leksjon (kumulativ oppbygging); neste leksjon åpner ved ~80 % mestring, men kan alltid låses opp manuelt under «Bla».
- Kort som feiler ≥8 ganger flagges som *leech* — omskriv eller suspender dem.
- Statistikk-fanen viser retensjonsrate på modne kort: 80–95 % er sunt.

## Tema-format

```json
{
  "id": "mitt-tema",
  "title": "Mitt tema",
  "language": { "front": "ru", "back": "en" },
  "explainContext": "Kontekst til KI-forklaringer (valgfri)",
  "settings": { "tts": true },
  "lessons": [
    {
      "id": "l01", "title": "Første leksjon",
      "note": "Valgfri intro",
      "cards": [
        {
          "id": "unik-id",
          "front": "spørsmål — tekst, $formel$ eller {\"html\": \"…\"}",
          "back": "svar — samme formater",
          "hint": "valgfritt hint (bak en knapp)",
          "example": { "text": "setning der ordet brukes", "translation": "oversettelse" },
          "tts": "tekst som leses opp (Web Speech API, språk fra language.front)",
          "image": "valgfri bilde-URL",
          "reverse": true,
          "tags": ["valgfritt"]
        }
      ]
    }
  ]
}
```

- `reverse: true` lager automatisk speilkortet (svar→spørsmål) med egen historikk. Speilkort vises aldri i samme økt som originalen.
- Formler: KaTeX med `$…$` / `$$…$$`. Cloze-kort skrives som `"front": "Я ___ воду (пить)"`.
- Last tema fra fil eller URL under «Hjem», eller legg dem i `decks/` og registrer navnet i `BUILTIN`-listen i `index.html`.

## GitHub-synk (valgfritt)

Lagrer fremgang (`progress.json`) og egne/genererte decks i **ditt eget repo**.

1. Lag et (privat) repo, f.eks. `flash-data`.
2. Lag en *fine-grained* PAT begrenset til det repoet, med **Contents: Read and write**.
3. Innstillinger → fyll inn `eier/repo` og PAT → «Synk nå».

Konflikter løses per kort: nyeste repetisjon vinner. PAT lagres kun i nettleserens localStorage.

## KI-funksjoner (valgfritt)

Med en Anthropic API-nøkkel (Innstillinger) får du:

- **✨ Forklar mer** på kortets bakside — streamet forklaring, kan lagres som notat.
- **✨ Generer kort** under «Bla» — lag N kort om et tema, forhåndsvis, lagre i valgt leksjon.
- **✨ Omskriv** på leech-kort — forslag til bedre kortformuleringer.

Nøkkelen lagres kun lokalt og sendes kun til Anthropic. Uten nøkkel er funksjonene skjult.

## Utvikling

- `srs.js` (planlegger) og `queue.js` (øktkø) er rene moduler: `node --test test/`
- Spec og plan: `docs/superpowers/`
