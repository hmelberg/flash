# flash — innlogging, synk via GitHub/Google Drive og deling av tema

**Dato:** 2026-07-14
**Status:** Utkast til godkjenning

## Mål

Brukere skal kunne logge inn med **GitHub eller Google** og få alt sitt — Anthropic
API-nøkkel, innstillinger, fremgang og egne tema — til å følge med på tvers av enheter,
uten å lime inn nøkler og PAT-er på hver maskin. I tillegg skal tema kunne **deles**:
med én person via lenke, og offentlig via en felles katalog organisert i emner.

KI er **valgfritt og leverandøragnostisk**: appen er fullt brukbar uten API-nøkkel
(lagring, synk og deling av kort er kjernen), og de som vil ha KI-funksjoner skal kunne
bruke Anthropic **eller** en OpenAI-kompatibel tjeneste (OpenAI via OpenRouter, Gemini,
Groq, lokal Ollama m.fl.). For brukere uten nøkkel finnes en «lag kort med KI-chat»-
snarvei på hjemsiden: kopier en ferdig prompt (fra `prompts/generate-deck.md` pluss en
instruks om å pakke svaret som komplett tema-JSON), lim inn i valgfri chatbot, og
importer JSON-svaret med den eksisterende filknappen.

Alt dette med **minimal egen infrastruktur**: ingen database, ingen brukerregister,
ingen lagring av andres API-nøkler på serversiden. Brukerens data ligger i brukerens
egen GitHub-konto eller Google Drive. Det eneste som kjører på Netlify utover statiske
filer er **tilstandsløse funksjoner** for OAuth-utveksling (klienthemmeligheter kan
ikke ligge i nettleseren).

## Ikke-mål

- Ingen egen brukerdatabase eller e-post/passord-kontoer (ikke Netlify Identity).
- Ingen proxying av KI-kall via server — nettleseren kaller KI-API-ene direkte som i dag
  (leverandører uten CORS-støtte, som api.openai.com direkte, støttes derfor ikke).
- Ingen kryssmiks av leverandører (Google-innlogging + GitHub-lagring e.l.).
  Identitet og lagring følger hverandre: GitHub-login → GitHub-repo, Google-login → Drive.
- Ingen sanntidssamarbeid eller felles redigering av tema.
- Ingen automatisert innsending til den offentlige katalogen i v1 (publisering skjer via PR).

## Arkitektur

```
flash/                          (statisk som før — Netlify)
├── index.html                  # UI, synk-motor, KI — uendret struktur
├── store-github.js             # lagringsadapter: GitHub (repo via OAuth eller PAT)
├── store-drive.js              # lagringsadapter: Google Drive
├── netlify/functions/
│   └── auth.js                 # tilstandsløs OAuth-utveksling (github + google)
└── netlify.toml                # functions-katalog + redirects
```

Brukerens data (samme filer uansett leverandør):

```
flash-data/                     (privat GitHub-repo ELLER Drive-mappe «flash-data»)
├── settings.json               # model, apiKey, øvrige innstillinger
├── progress.json               # som i dag: progress, notes, newUsedByDay
└── decks/<id>.json             # egne tema
```

Offentlig katalog (eget, offentlig GitHub-repo, f.eks. `flash-decks`):

```
flash-decks/
├── index.json                  # [{id, title, topic, cards, author, url}]
└── <emne>/<id>.json            # temafiler gruppert per emne
```

### Lagringsadapter

Alt over adapternivået (merge-logikk, innstillinger, temahåndtering) er
leverandør-agnostisk. Grensesnittet:

```js
{
  login(),                       // starter OAuth-flyt (full redirect, ikke popup)
  logout(),                      // sletter tokens lokalt
  whoAmI(),                      // {name, avatar} til UI
  load(name),                    // → {json, version} | null
  save(name, contentStr, version),
  list(prefix)                   // → filnavn, f.eks. list("decks/")
}
```

`list()` er ny og nødvendig: dagens synk bare *dytter* egne tema, men på en ny enhet
må appen kunne oppdage hvilke tema som finnes i lagringen og hente dem ned.
Synk-motoren utvides tilsvarende: egne tema pulles hvis de mangler lokalt
(GitHub: list repo-innhold i `decks/`; Drive: list filer i mappen).

- **GitHubStore** er dagens `ghGet`/`ghPut` bak grensesnittet (`version` = sha).
  Fungerer med både OAuth-token og manuell PAT — PAT-feltet beholdes som
  «avansert»-alternativ siden koden allerede finnes.
- **DriveStore** bruker Drive API v3: finn/opprett mappen `flash-data`, filer slås opp
  etter navn i mappen. Drive mangler GitHubs sha-baserte compare-and-swap, men
  synk-motoren merger alltid før skriving (nyeste `lastReview` vinner per kort),
  så det er akseptabelt.

Ved første innlogging oppretter adapteren lagringen selv: GitHubStore lager privat
repo `flash-data` via API-et hvis det ikke finnes; DriveStore lager mappen.

### Autentisering

Én Netlify-funksjon, `auth.js`, med tre operasjoner — alle tilstandsløse
(hemmeligheter i Netlify-miljøvariabler, ingenting lagres):

| Kall | Gjør |
|---|---|
| `/api/auth?provider=github&code=…` | bytter code → access token (GitHub-token utløper ikke) |
| `/api/auth?provider=google&code=…` | bytter code → access + refresh token |
| `/api/auth?provider=google&refresh=…` | bytter refresh token → nytt access token |

- **Flyt:** full-side redirect til leverandøren med tilfeldig `state` (sessionStorage),
  tilbake til `/?auth=<provider>&code=…`, appen kaller funksjonen, lagrer tokens i
  localStorage og gjenopptar.
- **GitHub-scopes:** `repo` (privat repo krever det) + `gist` (til deling, se under).
- **Google-scopes:** `openid email profile` (identitet) + `drive.file` (kun filer appen
  selv har opprettet). `drive.file` er ikke-sensitiv, så OAuth-appen kan publiseres til
  produksjon **uten** Googles sikkerhetsrevisjon. Viktig: appen må settes i produksjon —
  i testmodus dør refresh tokens etter 7 dager.
- **Utløp:** Google access tokens lever ~1 time; ved 401 henter adapteren nytt token via
  refresh-kallet og prøver én gang til. GitHub-tokens behandles som evige; 401 → be om
  ny innlogging.

### KI-motor (leverandøragnostisk)

Alt KI (forklaringer, generering, leech-omskriving) går allerede gjennom ett kall,
`aiMessage()`. Det trekkes ut i en modul `ai.js` med to stier bak samme grensesnitt
(Anthropic-formet forespørsel inn, normalisert svar ut, streaming støttet):

- **Anthropic:** dagens rå `fetch` mot `api.anthropic.com` (SDK-importen fjernes —
  fetch-fallbacken gjør alt SDK-en brukes til).
- **OpenAI-kompatibel:** `POST {baseUrl}/chat/completions` med SSE-streaming.
  Innstillinger: leverandørvalg, base-URL (placeholder `https://openrouter.ai/api/v1`),
  modell og nøkkel. Merk: `api.openai.com` sender ikke CORS-headere og kan ikke kalles
  direkte fra nettleser — dokumenteres i UI-et; OpenRouter/Gemini/Groq/Ollama fungerer.

Nye innstillinger `aiProvider` og `aiBaseUrl` synkes som resten.

### API-nøkkelen

`settings.json` (inkl. `apiKey`) synkes til brukerens egen private lagring — ny enhet
trenger da bare én innlogging, så er nøkkelen på plass. Trusselmodellen er kompromittert
GitHub-/Google-konto eller lekket token; det aksepteres i v1 siden lagringen er brukerens
egen og privat. **Valgfri** herding (fase 4): krypter nøkkelen med passfrase
(WebCrypto: PBKDF2 → AES-GCM); passfrasen tastes én gang per enhet og den dekrypterte
nøkkelen ligger lokalt. Standard er ukryptert — av-kryssingsboks i innstillinger.

OAuth-tokens synkes **aldri** — de er per enhet, i localStorage.

## Deling

1. **Lenkedeling (grunnmuren):** appen håndterer `#deck=<url-enkodet URL>` ved oppstart —
   henter JSON via eksisterende `loadDeckFromUrl`, viser forhåndsvisning
   (tittel + antall kort) og «Legg til»-knapp. Fungerer for alle, uten innlogging.
2. **Del-knapp på egne tema:**
   - GitHub-bruker: opprett hemmelig gist, kopier `https://<site>/#deck=<raw-gist-url>`.
   - Google-bruker: last opp kopi til Drive, sett «alle med lenken kan lese», lenken
     bruker `https://www.googleapis.com/drive/v3/files/<id>?alt=media&key=<API-nøkkel>`
     (offentlig, referer-begrenset Google API-nøkkel innebygd i appen — den kan kun
     lese filer som allerede er offentlige).
3. **Offentlig katalog:** ny «Utforsk»-visning henter `index.json` fra `flash-decks`-repoet
   (raw-URL, ingen innlogging) og viser tema gruppert per emne med tittel, kortantall og
   forfatter — ett klikk for å legge til. Publisering i v1: PR mot repoet (appen lenker til
   en forhåndsutfylt «ny fil»-side på GitHub); eieren modererer ved å merge.

## Feilhåndtering

- 401 fra lagring → Drive: automatisk refresh + ett nytt forsøk; deretter/GitHub:
  «Logg inn på nytt»-melding (aldri stille tap av synk).
- Offline / synk feiler → localStorage er fortsatt sannheten; merge ved neste synk
  (dagens oppførsel, uendret).
- `#deck=`-URL som ikke svarer eller ikke validerer som tema → tydelig feilmelding,
  ingenting importeres.
- OAuth avbrutt/`state` stemmer ikke → tilbake til innstillinger med feilmelding.

## Testing

- Enhetstester (som `test/srs.test.js`): merge-logikken (uendret, men nå testet),
  adapter-kontrakt mot mocket `fetch` — samme testsett kjøres mot begge adaptere.
- Manuell matrise per leverandør: første innlogging (lagring opprettes), «ny enhet»
  (inkognito → alt på plass etter innlogging), Google-token utløpt (refresh),
  delingslenke i inkognito, katalogvisning uten innlogging.

## Engangsoppsett (manuelt, utenfor koden)

1. GitHub OAuth-app (callback = site-URL) → client id/secret i Netlify-miljøvariabler.
2. Google Cloud-prosjekt: OAuth-samtykkeskjerm (produksjon), OAuth-klient (web),
   referer-begrenset API-nøkkel for offentlig fillesing.
3. Opprett offentlig `flash-decks`-repo med `index.json` og de to innebygde temaene
   som startinnhold.

## Faser

1. **Adapter + GitHub-login:** trekk ut lagringsadapter, `auth.js`-funksjonen,
   GitHub OAuth, synk av `settings.json`. (PAT-veien beholdes.)
2. **Google Drive:** DriveStore, refresh-håndtering, GCP-oppsett.
3. **Deling:** `#deck=`-håndtering med forhåndsvisning, del-knapp (gist/Drive),
   «Utforsk»-katalog med emner.
4. **KI-agnostikk + prompt-snarvei:** `ai.js` med Anthropic/OpenAI-kompatibel sti,
   nye KI-innstillinger, «lag kort med KI-chat»-dialog med kopierbar prompt.
5. *(Valgfri)* passfrase-kryptering av API-nøkkelen.

Hver fase er selvstendig nyttig og kan slippes alene.
