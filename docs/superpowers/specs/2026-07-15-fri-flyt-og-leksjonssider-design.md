# flash — fri flyt, hopp over kjent stoff, og leksjonssider

**Dato:** 2026-07-15
**Status:** Godkjent i samtale (fri modus som standard, gated som valg, markdown+matte for leksjonssider)

## Mål

Brukeren skal være fri: gjør så mange kort du vil, når du vil, i den rekkefølgen du vil —
det er algoritmens jobb å planlegge repetisjonene rundt det. Kjent stoff skal kunne
parkeres med ett klikk (per kort og per leksjon). Og leksjoner skal kunne ha en
**introduksjonsside** (markdown med matte) som presenterer stoffet som system —
grammatikk, lesetekst, kontekst — før kortene kommer.

## Bakgrunn / vurdering

- Planleggeren er per kort (stability/difficulty per kort, ingen global «evne») — lette
  kort tidlig forgifter ikke planen for senere kort. Problemet er flytkontrollen rundt:
  80 %-gaten tvinger deg gjennom lett stoff, og dagsgrensen blokkerer motiverte økter.
- Øvingsmodus (▶ per leksjon) fungerer allerede på låste leksjoner og planlegger nye
  kort normalt — friheten finnes halvveis; den skal bli førsteklasses.

## Ikke-mål

- Ingen endringer i selve planleggingsalgoritmen (`srs.js`).
- Ingen interaktive dialoger eller testmodus (fase D — senere).
- Ingen HTML-sider som leksjonsinnhold — kun markdown med KaTeX (som `info`-feltet).

## A. Fri flyt (standard) og guidet modus (valg)

Ny innstilling `flowMode`: **`"free"` (standard)** | `"guided"`.

- **Fri modus:** alle leksjoner er åpne. Ingen 🔒, ingen «lås opp»-knapp. Nye kort
  flyter fortsatt i forfatterrekkefølge (tidligste uferdige leksjon først) — rekkefølge
  er anbefaling, ikke port.
- **Guidet modus:** dagens oppførsel (80 % av forrige leksjon på stability ≥ 7 d åpner
  neste; manuell opplåsing finnes fortsatt).
- **Dagsgrensen (`newPerDay`) blir ren pacing, aldri en vegg:** øktoppsummeringen får en
  «＋N nye kort»-knapp (når usette kort finnes) som fortsetter sømløst forbi grensen
  (gjenbruker dagens `extraNew`-mekanisme). Hjemflisens «＋N nye til» beholdes.
- `flowMode` synkes (inn i `SYNCED_SETTINGS`), sammen med `unlocked` og `skipped`
  (se B) — de er brukerintensjon på tvers av enheter.

## B. Hopp over kjent stoff

- **Per leksjon (i Bla-visningen):**
  - **«✔ kan dette»** — parkér: alle kortene i leksjonen får dagens 💤-semantikk
    (`suspended: "never"`, due om 180 d, deretter årlig hale). Lagres i `progress`
    (synkes dermed automatisk). Når alle kort i en leksjon er parkert vises
    **«vekk leksjonen»** i stedet (nullstiller suspensjonen, due = nå, lapses = 0 —
    som dagens per-kort «wake»).
  - **«⏭ hopp over»** (toggle) — leksjonen mates ikke inn i ny-kort-flyten, men
    forfalte kort vises fortsatt. Lagres som `settings.skipped: ["deckId/lessonId"]`.
    I guidet modus regnes en overhoppet leksjon som kvalifisert for gaten (blokkerer
    ikke neste leksjon).
- **Per kort (i økt):** når kortet er **nytt**, får graderingslinjen en tredje knapp
  **«💤 kan det»** (= dagens `never`-gradering, som ellers bare bor i hjørnet).
  `never`-graderinger telles ikke som ok/fail i øktstatistikken (i dag telles de som
  fail — det er feil).

## C. Leksjonssider (`lesson.intro`)

Nytt valgfritt felt i tema-formatet: `lesson.intro` — **markdown med `$matte$`**
(rendres med marked + KaTeX, som `info`-feltet).

- **I økt:** når øktens **første nye kort** fra en leksjon med `intro` dukker opp,
  vises introsiden i stedet for kortet (fullt kortareal, rendret markdown,
  «Fortsett»-knapp). Vises maks én gang per leksjon per økt (`session.introShown`).
  Forfalte kort trigges ikke — introen hører til læringsøyeblikket.
- **I Bla:** leksjoner med `intro` får en 📖-knapp i overskriften som ekspanderer/
  kollapser den rendrede siden — alltid tilgjengelig for gjenlesing.
- **Validering:** `intro` må være streng hvis den finnes.
- **KI-generering:** `GEN_SCHEMA` utvides med `intro` (string | null) per leksjon;
  `prompts/generate-deck.md` instruerer om en valgfri, konsis intro som presenterer
  leksjonens system/mønster (ikke gjenfortelling av kortene). `saveGenerated` tar den med.
- README-tema-formatet dokumenterer feltet.

## Migrering

`flowMode` mangler hos eksisterende brukere → defaultes til `"free"` (bevisst: fri
modus er ny standard). `settings.skipped` defaultes til `[]`. Ingen andre
datamigrasjoner — «kan dette» bruker eksisterende tilstandsfelter.

## Testing

- `queue.js`: fri modus åpner alt; guidet uendret; `skipped` ekskluderer fra ny-flyt
  men ikke fra forfalte; skipped kvalifiserer gate i guidet modus.
- `sync.js`: whitelisten inkluderer `flowMode`/`unlocked`/`skipped`.
- Manuelt i nettleser: innstillings-select, «＋N nye kort» i oppsummering, 💤-knapp på
  nye kort, leksjonshandlinger i Bla, introside i økt og 📖 i Bla.
