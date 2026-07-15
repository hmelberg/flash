# ⚡ flash

Fleksibel flashcard-app med spaced repetition. Statisk, ingen byggetrinn — eneste server-del er en valgfri, tilstandsløs Netlify-funksjon for OAuth-innlogging. Motoren er generisk; alt innhold ligger i JSON-tema-filer i `decks/`.

**Innebygde demo-tema (engelsk):** Spanish essentials · World capitals · Math essentials.
(`decks/russian.json` og `decks/probability.json` ligger fortsatt i repoet og kan hentes via «Add deck from URL»: `decks/russian.json`.)

## Kjøre

- **Lokalt:** `python3 -m http.server` i denne mappen → `http://localhost:8000` (ES-moduler krever http, ikke `file://`). Innlogging krever `npx netlify dev` i stedet — se [`docs/oppsett-innlogging.md`](docs/oppsett-innlogging.md).
- **Netlify:** koble repoet til et Netlify-site — `netlify.toml` gjør resten. Innlogging/synk krever miljøvariablene i [`docs/oppsett-innlogging.md`](docs/oppsett-innlogging.md); uten dem virker alt annet.
- **GitHub Pages:** fungerer også (Settings → Pages → `main`, rot), men da uten innloggings-funksjonen — synk går via PAT.

## Bruk

- **Økt:** mellomrom/klikk/piler snur kortet; deretter <kbd>mellomrom</kbd>/<kbd>→</kbd>/<kbd>3</kbd> = OK, <kbd>←</kbd>/<kbd>1</kbd> = ikke OK, <kbd>↓</kbd>/<kbd>0</kbd> = kan det, parkér, <kbd>z</kbd> = angre. Rask flyt: space-space per kort du kan (→→ / →← med pilene).
- Svartid brukes automatisk: trege OK-svar får forsiktigere intervaller, raske får litt ekstra.
- Nye kort kommer fra tidligste uferdige leksjon (anbefalt rekkefølge). **Fri flyt er standard**: alle leksjoner er åpne, og øktoppsummeringen tilbyr alltid «＋N more new cards» forbi dagsgrensen. Foretrekker du gradvis opplåsing (~80 % mestring åpner neste leksjon), velg «Guided» under Settings → Lesson flow.
- Kan du noe fra før? «💤 Know it» på nye kort parkerer dem (~6 mnd, så årlig sjekk); i «Browse» kan hele leksjoner parkeres («✔ know this») eller unntas fra ny-kort-flyten («⏭ skip»).
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
      "note": "Valgfri én-linjes beskrivelse",
      "intro": "Valgfri leksjonsside i **markdown** med $matte$ — vises før leksjonens første kort (📖 i «Browse»)",
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

## Innlogging og synk (valgfritt)

Logg inn med **GitHub eller Google** (Innstillinger) — så synkes innstillinger
(inkl. API-nøkkel), fremgang og egne tema til **din egen** lagring: et privat
`flash-data`-repo (GitHub) eller en `flash-data`-mappe i Drive (Google). Ny
enhet = logg inn én gang, så er alt på plass. Ingen sentral database — det
eneste på serversiden er en tilstandsløs OAuth-funksjon
([oppsett](docs/oppsett-innlogging.md)).

Konflikter løses per kort: nyeste repetisjon vinner; for innstillinger vinner
siste lagring. OAuth-tokens forblir i nettleserens localStorage og synkes aldri.

**Alternativ uten innlogging:** «Avansert» under Innstillinger — et eget repo +
en *fine-grained* PAT (Contents: Read and write), som før.

## Deling av tema

- **Lenke:** «Bla» → 🔗 **del** ved egne tema lager en delingslenke
  (`…/#deck=<url>`) — hemmelig gist for GitHub-brukere, offentlig Drive-fil for
  Google-brukere. Mottakeren åpner lenken, ser forhåndsvisning og legger til
  med ett klikk — helt uten konto.
- **Offentlig katalog:** «Utforsk»-fanen viser tema fra
  [`flash-decks`](https://github.com/hmelberg/flash-decks)-repoet, gruppert per
  emne. Bidra med en pull request.

## KI-funksjoner (valgfritt)

Appen er fullt brukbar uten KI. Uten API-nøkkel finnes snarveien
**«📋 Lag kort med en KI-chat»** på hjemsiden: kopier prompten, lim inn i
ChatGPT/Claude/Gemini sammen med temaet ditt, lagre JSON-svaret og hent det inn
med 📄-knappen.

Med API-nøkkel (Innstillinger) velger du leverandør: **Anthropic (Claude)**
eller **OpenAI-kompatibel** tjeneste via base-URL (OpenRouter, Gemini, Groq,
lokal Ollama …; `api.openai.com` direkte støtter ikke nettleserkall/CORS —
bruk f.eks. OpenRouter). Da får du:

- **ℹ️ Mer info** — modal med kortets `info`-felt (markdown/matte) og/eller streamet KI-forklaring, med mulighet for oppfølgingsspørsmål. Forklaringer kan lagres som notat.
- **✨ Generer kort** under «Bla» — beskriv hva du vil lære (antall valgfritt, standard ~100), og KI-en strukturerer kortene i leksjoner/undertema, eller fyller på en eksisterende leksjon. Du kan også **lime inn et dokument** (eller hente en .txt/.md/.pdf-fil) — da trekkes kortene ut av innholdet, med standard ~1 kort per 100 ord. Forhåndsvis, stryk det du ikke vil ha, lagre — og er GitHub-synk satt opp, pushes det nye decket automatisk til repoet ditt. Promptene KI-en får ligger i [`prompts/`](prompts/) (engelsk: `generate-deck.md` + `extract-deck.md`) — de kan også limes inn i en hvilken som helst KI-chat for manuell bruk.
- **✨ Omskriv** på leech-kort — forslag til bedre kortformuleringer.

Nøkkelen sendes kun til KI-leverandøren du velger, og lagres lokalt (pluss i
din egen private lagring hvis du er logget inn). Uten nøkkel er funksjonene skjult.

## Utvikling

- Rene moduler med tester (`node --test`): `srs.js` (planlegger), `queue.js`
  (øktkø), `sync.js` (merge-logikk), `stores.js` (GitHub/Drive-adaptere),
  `ai.js` (KI-klient), `netlify/functions/auth.mjs` (OAuth-utveksling)
- Spec og plan: `docs/superpowers/` · Deploy-oppsett: `docs/oppsett-innlogging.md`
