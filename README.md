# ⚡ flash

Fleksibel flashcard-app med spaced repetition. Statisk — ingen server, ingen byggetrinn. Motoren er generisk; alt innhold ligger i JSON-tema-filer i `decks/`.

**Innebygde tema:** Russisk for nybegynnere (94 kort) · Sannsynlighet og statistikk (80 kort).

## Kjøre

- **Lokalt:** `python3 -m http.server` i denne mappen → `http://localhost:8000` (ES-moduler krever http, ikke `file://`).
- **GitHub Pages:** push repoet, aktiver Pages (Settings → Pages → Deploy from branch → `main`, rot). Ferdig.

## Bruk

- **Økt:** mellomrom/klikk/piler snur kortet; deretter <kbd>mellomrom</kbd>/<kbd>→</kbd>/<kbd>3</kbd> = OK, <kbd>←</kbd>/<kbd>1</kbd> = ikke OK, <kbd>0</kbd> = nesten aldri gjenta, <kbd>z</kbd> = angre. Rask flyt: space-space per kort du kan (→→ / →← med pilene).
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
          "info": "valgfri utdyping i **markdown** med $matte$ — vises i «Mer info»-modalen (ℹ️)",
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

### Organisering av større samlinger

Tre nivåer, fra fint til grovt:

1. **Leksjoner** er kategoriene *i* et tema — de gir rekkefølge og kumulativ opplåsing. Vil du øve på én kategori isolert (f.eks. bare tall), bruk ▶-knappen ved leksjonen under «Bla» — øvingsmodus tar alle kortene i leksjonen, og re-planlegger bare det du feiler.
2. **`tags`** på kortene for kategorier på tvers av leksjoner (f.eks. "verb").
3. **Flere filer med felles `"subject"`** for store emner: `{"subject": "Russisk", "title": "Gloser", …}` og `{"subject": "Russisk", "title": "Grammatikk", …}` — hjem-siden grupperer fliser under samme overskrift. Hver fil holder sin egen fremgang og gating.

Nye kort og kategorier legges til dynamisk ved å redigere JSON-filen (fremgang ligger adskilt og overlever), via KI-generering («Bla» → ✨), eller ved å laste en ny fil.

## GitHub-synk (valgfritt)

Lagrer fremgang (`progress.json`) og egne/genererte decks i **ditt eget repo**.

1. Lag et (privat) repo, f.eks. `flash-data`.
2. Lag en *fine-grained* PAT begrenset til det repoet, med **Contents: Read and write**.
3. Innstillinger → fyll inn `eier/repo` og PAT → «Synk nå».

Konflikter løses per kort: nyeste repetisjon vinner. PAT lagres kun i nettleserens localStorage.

## KI-funksjoner (valgfritt)

Med en Anthropic API-nøkkel (Innstillinger) får du:

- **ℹ️ Mer info** — modal med kortets `info`-felt (markdown/matte) og/eller streamet KI-forklaring, med mulighet for oppfølgingsspørsmål. Forklaringer kan lagres som notat.
- **✨ Generer kort** under «Bla» — beskriv hva du vil lære (antall valgfritt, standard ~100), og KI-en strukturerer kortene i leksjoner/undertema, eller fyller på en eksisterende leksjon. Du kan også **lime inn et dokument** (eller hente en .txt/.md-fil) — da trekkes kortene ut av innholdet, med standard ~1 kort per 100 ord. Forhåndsvis, stryk det du ikke vil ha, lagre — og er GitHub-synk satt opp, pushes det nye decket automatisk til repoet ditt. Promptene KI-en får ligger i [`prompts/`](prompts/) (engelsk: `generate-deck.md` + `extract-deck.md`) — de kan også limes inn i en hvilken som helst KI-chat for manuell bruk.
- **✨ Omskriv** på leech-kort — forslag til bedre kortformuleringer.

Nøkkelen lagres kun lokalt og sendes kun til Anthropic. Uten nøkkel er funksjonene skjult.

## Utvikling

- `srs.js` (planlegger) og `queue.js` (øktkø) er rene moduler: `node --test test/`
- Spec og plan: `docs/superpowers/`
