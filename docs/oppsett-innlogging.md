# Engangsoppsett: innlogging, synk og katalog

Appen er statisk, men innlogging krever én Netlify-funksjon (`/api/auth`) og
OAuth-apper hos GitHub og Google. Alt under gjøres én gang per deployment.

## 1. GitHub OAuth-app

1. github.com → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. *Homepage URL* og *Authorization callback URL* = site-roten, f.eks.
   `https://<site>.netlify.app/` (callback må være roten — appen håndterer
   `?code=` der).
3. Kopier **Client ID** og generer en **Client Secret**.

## 2. Google Cloud (for Drive-synk og Google-innlogging)

1. [console.cloud.google.com](https://console.cloud.google.com) → nytt prosjekt.
2. **APIs & Services → OAuth consent screen:** type *External*. **Publiser til
   produksjon** — i testmodus utløper refresh tokens etter 7 dager og bare 100
   testbrukere slipper inn. Scopene appen bruker (`openid email profile` +
   `drive.file`) er ikke-sensitive, så publisering krever ingen sikkerhetsrevisjon.
3. **Credentials → Create credentials → OAuth client ID:** type *Web application*,
   *Authorized redirect URI* = site-roten (samme som over).
4. **Enabled APIs:** aktiver **Google Drive API**.
5. **Credentials → Create credentials → API key:** begrens til *Google Drive API*
   og *HTTP referrers* = site-domenet. (Brukes kun til å lese offentlig delte
   temafiler — den kan ikke lese private data.)

## 3. Netlify-miljøvariabler

```bash
npx netlify env:set GITHUB_CLIENT_ID <id>
npx netlify env:set GITHUB_CLIENT_SECRET <secret>
npx netlify env:set GOOGLE_CLIENT_ID <id>
npx netlify env:set GOOGLE_CLIENT_SECRET <secret>
npx netlify env:set GOOGLE_API_KEY <nøkkel>
```

Uten disse skjuler appen login-knappene og faller tilbake til PAT-synk —
alt annet virker som før.

## 4. Katalog-repoet (Utforsk-fanen)

Opprett offentlig repo `hmelberg/flash-decks` (navnet står i
`CATALOG_INDEX_URL` i `index.html`):

```
flash-decks/
├── index.json
├── sprak/
│   └── russian-basics.json
└── statistikk/
    └── probability.json
```

`index.json`-format (`url` er relativ til index-filen):

```json
[
  { "id": "russian-basics", "title": "Russisk for nybegynnere",
    "topic": "Språk", "cards": 94, "author": "hmelberg",
    "url": "sprak/russian-basics.json" },
  { "id": "probability", "title": "Sannsynlighet og statistikk",
    "topic": "Statistikk", "cards": 80, "author": "hmelberg",
    "url": "statistikk/probability.json" }
]
```

Publisering av nye tema = pull request mot dette repoet; eieren modererer
ved å merge.

## 5. Lokal utvikling

- Uten funksjoner: `python3 -m http.server` (login-knappene skjules).
- Med funksjoner: `npx netlify dev` + en `.env` i repo-roten med variablene
  fra punkt 3 (bruk egne test-OAuth-apper med callback `http://localhost:8888/`).
- Tester: `node --test`.
