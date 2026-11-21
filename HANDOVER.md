# ParkPilot: overdrachtsdocument

Eerste versie 21 november 2026. **Laatst bijgewerkt: 21 november 2026, 13:10** (zie logboek, hoofdstuk 16). Doel: een nieuwe Claude-chat, ook in een ander account, kan hiermee zonder voorkennis verder bouwen. Alles wat nodig is staat hier of in de repo. Lees dit eerst helemaal, vooral de hoofdstukken 2, 3, 4.1, 12 en **15**.

**Vaste afspraak:** Claude werkt dit document bij na elke wijziging, beslissing of nieuwe kennis, in dezelfde beurt, zowel in het claude.ai-project "ParkPilot" (`claude/ParkPilot-HANDOVER.md`) als in de repo (`HANDOVER.md`). Wat Claude leert over Remco's werkwijze en voorkeuren, en alles wat hij een "framework feature" noemt, gaat naar hoofdstuk 15.

---

## 1. In het kort

**ParkPilot** is een mobile-first PWA (iPhone, "Zet op beginscherm") voor Disneyland Paris, technisch uitbreidbaar naar andere parken. Je volgt favoriete attracties en shows, ziet live wachttijden, storingen, showtijden en afstanden, en bouwt een persoonlijk dagprogramma.

- **Eigenaar/gebruiker:** Remco (GitHub: `RemcoNLD`). Nederlandstalig. Gebruikt de app zelf, en hooguit mensen die hij kent.
- **Live:** https://parkpilot.remco-dv.workers.dev
- **Repo:** https://github.com/RemcoNLD/parkpilot (publiek). Cloudflare Workers Builds bouwt en deployt automatisch bij elke commit.
- **Stack:** Vite + TypeScript (vanilla, geen framework) · één Cloudflare Worker (API + statische assets) · Cloudflare D1 (SQLite) · live data van ThemeParks.wiki.
- **Versie in de code:** `0.12.0` (`packages/shared/src/version.ts` en `package.json`), live gezet 21 nov 2026 ~13:10, nog niet door Remco bevestigd. 0.9.0 (single rider) bevestigd met "Werkt".
- **Bij elke nieuwe versie:** nummer ophogen in `version.ts` + `package.json` **én** een regel toevoegen bovenaan `apps/web/src/changelog.ts` (in de app: Instellingen > Wat is er nieuw). Korte, gewone taal, gericht op wat Remco ziet.
- **Fase:** fase 1 (basis + veel extra's) is af. Fase 2 (vertrekmeldingen, Web Push, looproutes) is nog niet begonnen.
- **Werkwijze sinds 21 nov 2026:** Claude commit zelf naar GitHub; Remco werkt vanaf zijn telefoon (zie 4.1).

---

## 2. Hoe Remco werkt, en wat hij van Claude verwacht

Dit is het belangrijkste hoofdstuk voor een nieuwe chat. De groeiende, volledige lijst staat in **hoofdstuk 15**; hier de kern.

- **Taal:** altijd Nederlands, direct en zonder omhaal. Geen lange recaps.
- **Kritisch zijn:** Remco zei letterlijk: "Wees kritisch als ik vragen stel want ik kan het niet altijd helemaal goed inschatten." Als een idee weinig oplevert, zeg dat eerlijk (voorbeeld: de geforceerde verversknop levert hooguit een halve minuut op omdat de bron zelf minuten oud is). Verzin niets: noem wat je niet kon controleren.
- **Hij kan niet met een terminal werken.** Hij wil geen commando's uitvoeren.
- **Hij werkt vanaf zijn telefoon.** Claude commit zelf naar GitHub (4.1); Remco vraagt, kijkt in de live app en keurt goed. Alleen als de koppeling niet werkt geldt de oude zip-route:
  1. Claude levert een **volledige `parkpilot.zip`**.
  2. Remco pakt die uit en sleept de mappen/bestanden naar de GitHub web-UI (Add file → Upload files).
  3. Cloudflare bouwt automatisch. Hij kijkt of de build "Ready" is.
  - Mapstructuur telt (eerder ontbrak `apps/web/index.html` of stonden bestanden in de root). Verwijderde/hernoemde bestanden verwijdert upload niet.
- **Hij werkt met screenshots** (vaak van een smal desktopvenster of telefoon) en beschrijft in korte zinnen wat hij wil. Interpreteer royaal, maar bouw niet meer dan gevraagd.
- **Versienummer:** altijd in de app zichtbaar (kop + voet + instellingen). Verhoog het bij elke app-levering, zodat hij kan controleren welke versie live staat.
- **Wat hij mooi/niet mooi vindt:** zie hoofdstuk 10 en 15. Lees die vóór je UI aanpast.
- Zijn tooncheck-vragen ("Is dat een idee?") zijn echte vragen. Eerst beantwoorden, pas bouwen als hij dat duidelijk vraagt ("Niet uitvoeren" betekent echt niet uitvoeren).
- **Dit document altijd bijwerken** (zie de vaste afspraak bovenaan).

---

## 3. Werkomgeving van Claude (sandbox) en beperkingen

Wat in de sessies tot nu toe gold (kan anders zijn in een nieuwe chat, controleer het):

- Projectmap: `/home/claude/parkpilot`, een clone van de repo. **Bron van waarheid is de GitHub-repo.** Begin een nieuwe chat met `add_repo` (RemcoNLD/parkpilot, push) en `git clone --depth 1`.
- **Bash had geen algemeen netwerk.** Geen `npm install`, geen `vite build`, geen `wrangler`. Wel `tsc` en Node 22 (met `node:sqlite`). Git naar GitHub loopt via een eigen proxy en werkt wel (4.1). Package-installs vereisen dat Remco netwerktoegang in zijn instellingen aanzet (werkt pas in een nieuwe chat).
- **WebFetch/WebSearch** werken, maar `api.themeparks.wiki` stond niet op de allowlist en Wikipedia was niet bereikbaar. Live API-gedrag is nooit zelf gezien, alleen afgeleid uit documentatie en screenshots van Remco.
- **Gevolg:** de frontend is wel getypecheckt maar **nooit gebouwd of in een browser uitgeprobeerd door Claude**. Zeg dat eerlijk in elke oplevering ("niet op een telefoon bekeken").
- Typecheck frontend: zit nu in `bash tools/test-worker.sh` (stap "typecheck app", via `tools/tsconfig.web.json` + `tools/vite-shim.d.ts`). De oude filtermethode (`tsc -p apps/web | grep ...`) verborg echte fouten omdat de ontbrekende vite-types de check verstoorden; niet meer gebruiken.
- **Worker typecheck + test:** `bash tools/test-worker.sh`. Doet: typecheck van `worker/src` met `tools/cf-shim.d.ts` (minimale Cloudflare-typen, geen `npm install` nodig), compileert naar `.test-build/` (CommonJS, staat in `.gitignore`) en draait `tools/worker-test.cjs`: nep-D1 met `node:sqlite` en de echte migraties, nep-`fetch` voor ThemeParks.wiki met vaste nepdata op de Parijse datum. **Verwacht: drie geslaagde typechecks (worker, app), 31 × `ok` en "alles ok".** Opnieuw opgebouwd op 21 nov 2026 (de oude `tools/` stond nooit in de repo). Gedekt: health/versie, parken, entiteiten, live (alleen lezen), schema, profiel, favorieten, voorkeuren, koppelcodes (sterk, eigen, 409, 404, rate limit), tracking-modi (uit / overdag met park dicht / open), cron-schrijfgedrag, wijzigingsdetectie, historie, showprogramma (bron vandaag, verwacht morgen), datumgrenzen. Showtijden in de nepdata staan om 12:00 en 23:00 Parijse tijd, zodat de test rond middernacht niet omvalt.
- tsc in de sandbox was versie 7 (Go-versie): `moduleResolution: node` bestaat daar niet meer; de test-tsconfig laat die optie daarom weg.
- Gebruikte ontwerpconventie: geen framework; DOM-helpers `h()` en `svg()` in `apps/web/src/dom.ts`.
- Dit document staat in het claude.ai-project én als `HANDOVER.md` in de repo. Houd beide gelijk; het projectdocument is leidend als ze verschillen.

---

## 4. Deploy-pipeline en bekende valkuilen

- Cloudflare Worker `parkpilot` is gekoppeld aan de GitHub-repo via **Workers Builds**.
  - Build command: `npm run build` (= `vite build apps/web`).
  - Deploy command: `npm run deploy:cloudflare` (= `wrangler deploy && wrangler d1 migrations apply DB --remote`).
  - Root directory: repo-root. `package.json` moet in de root van de repo staan.
- D1 wordt automatisch aangemaakt door wrangler (binding `DB` zonder `database_id`). Migraties in `worker/migrations/` draaien bij elke deploy (0001 t/m 0005).
- `wrangler.toml`: `[assets]` met `run_worker_first = ["/api/*"]` en `not_found_handling = "single-page-application"`; cron `*/5 * * * *`.
- Gezien in het verleden:
  - "package.json not found": bestanden stonden in een submap van de repo.
  - "Missing script deploy:cloudflare": oude `package.json`. "Retry build" bouwt dezelfde commit, dus zinloos; er moet een nieuwe commit komen.
  - "Could not resolve entry module apps/web/index.html": `index.html` ontbrak.
  - github.dev werkte niet.

### 4.1 Claude commit zelf (actief sinds 21 nov 2026)
**Hoe het is gekoppeld (route die werkte):**
1. Remco opende claude.ai/code en verbond GitHub (niet via "Add custom connector", dat is de verkeerde plek).
2. Daarna moest de **Claude GitHub App** nog op de repo worden geïnstalleerd: https://github.com/apps/claude/installations/select_target → RemcoNLD → parkpilot. Zonder die app kan Claude alleen lezen.
3. In de chat: `add_repo` (owner RemcoNLD, repo parkpilot, access push), dan `git clone --depth 1 https://github.com/RemcoNLD/parkpilot /home/claude/parkpilot`.

**Werkt / werkt niet (getest 21 nov 2026):**
- Clone en `git push` van een branch: **werkt** (`git -c push.negotiate=true push -u origin BRANCH`).
- Een remote branch verwijderen (`git push --delete`) en schrijven via `gh api`: **geblokkeerd** door de proxy. Claude kan dus geen branches opruimen; dat moet Remco in GitHub doen (Branches → prullenbak).
- Rechtstreeks naar `main` pushen: **werkt** (getest 21 nov 2026, commit f2ec320).

**Afspraak:** wijzigingen gaan rechtstreeks naar `main` (meteen live, net als vroeger met uploads); elke app-versie is zichtbaar genummerd. Bij grote of risicovolle wijzigingen eerst overleggen. Als `main` geblokkeerd blijkt: push naar een branch `claude/...` en Remco voegt de pull request samen in de GitHub-app.

---

## 5. Architectuur en bestandskaart

```
parkpilot/
├─ package.json, wrangler.toml, README.md, HANDOVER.md, .gitignore
├─ packages/shared/src/
│   ├─ index.ts        gedeelde types en DEFAULT_PREFERENCES, TrackingMode
│   └─ version.ts      APP_VERSION
├─ worker/
│   ├─ migrations/     0001_init … 0005_show_locations.sql
│   └─ src/
│       ├─ index.ts        router (fetch + scheduled)
│       ├─ parks.ts        parkconfiguratie (dlp-disneyland, dlp-studios)
│       ├─ themeparks.ts   upstream-client, ID-resolutie, getEntities/getLive/getSchedule
│       ├─ tracker.ts      wachttijd-historie, tracking-modus, cron (trackAll)
│       ├─ shows.ts        showtijden bewaren + programma per dag + verwachting
│       ├─ auth.ts, recovery.ts, util.ts
├─ apps/web/
│   ├─ index.html, vite.config.ts, tsconfig.json
│   ├─ public/ manifest.webmanifest, sw.js, iconen
│   └─ src/
│       ├─ main.ts   (≈1300 regels) state, render, alle schermen
│       ├─ api.ts, dom.ts, format.ts, geo.ts, logic.ts, theme.ts
│       ├─ icons.ts, art.ts (park-skyline), kindart.ts (illustraties detailvenster)
│       ├─ info.ts   omschrijvingen/lengtes/gebied/jaar
│       ├─ changelog.ts  versiegeschiedenis voor "Wat is er nieuw"
│       ├─ sim.ts    simulatiestand (verzonnen data)
│       └─ style.css
└─ tools/  test-worker.sh, worker-test.cjs, tsconfig.worker.json, tsconfig.test.json, tsconfig.web.json, cf-shim.d.ts, vite-shim.d.ts
```

De oude losse bestanden in de repo-root (`dom.ts`, `main.ts` enz. van de eerste uploads) zijn op 21 nov 2026 verwijderd; ze werden niet door de build gebruikt. `.gitignore` toegevoegd (node_modules, dist, .wrangler, .test-build).

### Worker
- `GET /api/health` → `{ok, version}`
- `GET /api/parks`, `GET /api/parks/:id/entities` (vult kijkplekken van gebruikers in bij shows zonder bronlocatie: `locationSource: 'user'`, `locationAccuracy`, `locationUpdatedAt`; cache 120 s, was 3600)
- `GET /api/parks/:id/live[?fresh=1]`: live data, verrijkt met "gewijzigd"-gegevens uit D1. Alleen lezen. `fresh=1` slaat de ThemeParks-cache over (max 1x per 10 s per park per isolate).
- `GET /api/parks/:id/schedule`: openingstijden vandaag + komende dagen.
- `GET /api/parks/:id/shows?date=JJJJ-MM-DD` (vandaag t/m +13 dagen): programma per dag, tijden gemerkt `bron` of `verwacht`.
- `GET /api/parks/:id/history/:entityId?since=today|hours=N`: wachttijdverloop uit `wait_log`.
- `POST /api/profile`, `/api/profile/redeem`, `/api/profile/recovery-code`.
- `GET/PUT/DELETE /api/favorites/...`, `GET/PUT /api/preferences/:parkId`.
- `PUT/DELETE /api/locations/:parkId/:entityId` (profiel nodig): kijkplek van een show opslaan/verwijderen, zie 6.8. PUT met `{lat, lng, accuracy, replace}`; bestaat er al een plek en is `replace` niet `true`, dan `409 location_exists` met `current`. Alleen shows zonder bronlocatie (`409 has_source_location`), binnen 3 km van het parkcentrum (`400 too_far_from_park`), 30 per uur per profiel.
- `GET/PUT /api/settings/tracking`: `off | park-hours | always`, server-breed.
- `scheduled()` draait `trackAll` elke 5 minuten.

### Database (D1)
`profiles`, `devices`, `favorites`, `preferences`, `rate_limits` (0001) · `wait_state`, `wait_log` (0002, 7 dagen) · `show_seen` (0003, 60 dagen) · `app_settings` (0004) · `user_locations` (0005: kijkplekken, één per show, met `accuracy_m`, `profile_id`, `updated_at`).

### Authenticatie (anoniem)
- Geen account. `POST /api/profile` geeft `deviceId.token`, bewaard in localStorage. Bearer-token, SHA-256-hashes in D1.
- **Koppelcode** laat hetzelfde profiel op meerdere toestellen werken. Eigen codes 4 tot 24 tekens; `409 code_taken` als bezet; "sterke" code is 12 tekens. Rate limit via D1. Zwakke codes zijn te raden: bewust geaccepteerd voor persoonlijk gebruik.

### Tracking (kostenbewust, zie hoofdstuk 8)
- Alleen de **cron** schrijft naar `wait_state`/`wait_log`, volgens de tracking-modus (`off`; `park-hours` = 30 min voor opening tot 30 min na sluiting; `always`).
- Showtijden elk uur in `show_seen`.
- De live-route leest D1, schrijft niet.

### Frontend-state en opslag
- localStorage: `pp.cache.<park>`, `pp.parks`, `pp.park`, `pp.pos`, `pp.theme`, `pp.density`, `pp.sim`, `pp.issuesSeen.<park>` (+ `.sim.`). Alles in try/catch via een `store` helper.
- Service worker (`public/sw.js`): app-schil offline; `/api/*` niet bewaard. Navigatie netwerk-eerst met 5 s time-out, rest stale-while-revalidate.

---

## 6. Wat de app nu doet (gewenst gedrag, per scherm)

### 6.1 Opstarten
- Standaard park: **Disney Adventure World** (`dlp-studios`). Alleen een handmatige parkkeuze wordt onthouden.
- Start in **Mijn programma** als er favorieten zijn, anders in het **Overzicht**. Niet onthouden.
- Thema volgt het systeem met een wisselknop. Tekstgrootte "Compact"/"Comfortabel" (knop "Aa", ~20% groter via CSS `zoom`) wordt onthouden.

### 6.2 Overzicht
- Kop met parknaam, open/dicht-status, skyline-art, drie tegels:
  - **Storingstegel (links):** drie grote getallen, **geen labels**: groen = open, rood = storing, grijs = onderhoud. Park dicht: open = 0, storing = "–". Tik opent de **storingspagina** (Storing / Onderhoud / Tijdelijk dicht met duur, "al minstens …" als het al liep vóór de meting). **Knippert rood** bij iets nieuws sinds het laatste bezoek.
  - Midden en rechts: gemiddelde en kortste wachttijd, **zonder "min"**.
- Segmentknop **Overzicht | Mijn programma**, tabs Attracties / Shows / Volgend, sorteerchips (Wachttijd, Afstand, Naam), filter "Alleen open" (houdt rekening met gesloten park). Shows-tab heeft een **dagkeuze** (zie 7.3).
- Rij: ring met wachttijd (<20 groen, <45 oranje, anders rood), naam, soortregel, afstand/looptijd, bronleeftijd. Storing = rood uitroepteken zonder ring; onderhoud = grijze moersleutel zonder ring; park dicht = gedimd met maantje.
- **Tik op wachttijd/showtijd** klapt de rij uit. Bij attracties met single rider staat bovenin het uitklappen "Single rider" met de wachttijd (alleen getal, kleur per niveau) of "geen wachttijd bekend"; alleen als de attractie open is en het park open. Geldt in Overzicht én Mijn programma (`singleRiderLine()`). Ook in het detailvenster bij de feiten. **Tik op de naam** opent het detailvenster.
- **Geen omschrijvingen in lijsten.**

### 6.3 Mijn programma
- Kleine kop: "‹ Overzicht", park en "bij <dichtstbijzijnde attractie binnen 400 m>", ↻ en instellingen. Compacte sorteerschakelaar en bronleeftijd rechts (rood als niet vers; offline-melding).
- Alleen favorieten. **Shows bovenaan** (Wachttijd/Naam); bij **Afstand** alles door elkaar.
- **Shows inklappen (sinds 0.7.0):** knopje "Shows" naast de sorteerschakelaar (alleen als je shows volgt) of tik op de kop "Shows ▾". Ingeklapt staat er één tikbare regel "Shows (N) ▸" bovenaan, ook bij Afstand. Onthouden in localStorage `pp.planShows`. Op een smal scherm mag de bronleeftijd naar een tweede regel.
- **Attractierij:** naam, afstand/looptijd eronder, rechts wachttijd **groot, alleen getal**, ▲ rood / ▼ groen met verschil.
- **Wachttijd attracties extra groot (sinds 0.11.4):** 54 px (was 44), klasse `.pwait-xl`; shows en woorden (dicht/storing) houden hun maat.
- **Single rider (sinds 0.11.0, positie 0.11.2, badge 0.11.4):** klein getal **rechtsboven** de grote wachttijd in een **witte badge** (15 px, vet, afgeronde hoek, lichte schaduw), getal in niveaukleur. Op wit worden vaste donkere niveaukleuren gebruikt (#0f7d57 / #94600a / #c9301f), ook in het donkere thema, anders is oranje/geel op wit onleesbaar. **Sinds 0.11.5:** rechts van het grote getal een vaste strook (42 px) met onder elkaar: single-rider-badge boven, verschil (▲/▼) onder, links uitgelijnd op dezelfde lijn. Het verschil staat dus niet meer links van de wachttijd (meer ruimte voor de naam). `planLayout.side` = ergens single rider of een verschil → strook bij alle rijen (ook show-tijden bij Afstand). Remco bevestigde met screenshot (12:02) dat de bron voor DLP echte single-rider-getallen levert (bijv. Flight Force 50/30, Frozen 120/50). **Geen label** (Remco: "Het is wel duidelijk. Dus alleen getallen."). Alleen als de bron een getal geeft, de attractie open is en het park open. Grote wachttijd blijft even groot. Klasse `.pnumcol`/`.psr`. 0.11.1 had het eronder (-7px); Remco wilde het rechtsboven en strakker. In 0.11.2 schoof de grote wachttijd daardoor naar links bij rijen met single rider; Remco: "alles moet verticaal altijd netjes uitlijnen". **Sinds 0.11.3:** `planLayout` (berekend in `planNodes()`): als er ergens single rider is, krijgt elk groot getal rechts een vrije strook van 22 px (`.pnumcol.gutter`) waarin het single-rider-getal absoluut staat; alle grote getallen krijgen dezelfde minimale breedte (aantal cijfers van het breedste getal, in `ch`), rechts uitgelijnd. Daardoor staan grote getallen én pijltjes recht onder elkaar. Show-tijden aan het eind (sortering Afstand) krijgen dezelfde strook, zodat de rechterrand gelijk blijft. Woorden (dicht, storing) houden hun eigen breedte, rechts uitgelijnd. Delta (▲/▼) staat sinds 0.11.2 op dezelfde basislijn als de grote wachttijd (`.prow .pright { align-items: baseline }`).
- **Afgelopen shows** (geen tijden meer vandaag) blijven staan: gedimd, "–" en "geen shows meer vandaag", onderaan de shows (bij Wachttijd). Shows die niet meer in de bron staan, worden niet getoond. Remco vroeg 21 nov 2026 of afgelopen shows weggaan; voorstel om ze in te klappen ligt bij hem.
- **Showrij:** eerstvolgende tijd groot links, naam en "over 14 min" plus vertrektijd, rechts "daarna". Uitklappen toont alle tijden (geweest grijs, eerstvolgende onderstreept, "NU"-streepje).
- **Afstand-sortering:** groot afstandsblok vooraan ("150 m" + "2 min lopen"); bij shows starttijd groot aan het eind.
- Ververst elke minuut (Overzicht: 2 min), alleen zichtbaar + online. ↻ forceert (en werkt ook de locatie één keer bij).

### 6.3b Vegen in Mijn programma (sinds 0.8.0)
- **Naar links vegen = afstrepen als gezien**, met bevestiging (keuzemenu onderin: "Afstrepen als gezien" / "Annuleren"). Afgestreept: naam doorgestreept, rij half doorzichtig, blijft op zijn plek staan. Nog eens naar links: "Afstrepen ongedaan maken".
  - Opslag: localStorage `pp.done.<park>` = `{date, ids}`; geldt alleen voor vandaag (Parijse datum) en **alleen op dit toestel** (niet gedeeld via de koppelcode). Bewuste eenvoud; delen kan later via de server.
- **Naar rechts vegen = navigeren**: keuzemenu "Lopen naar <naam>" met Apple Kaarten / Google Maps / Annuleren.
  - Apple: `https://maps.apple.com/?daddr=LAT,LNG&dirflg=w`. Apple Kaarten opent met de looproute; **direct starten kan Apple niet via een link**, je tikt zelf op "Ga".
  - Google: eerst `comgooglemaps://?daddr=…&directionsmode=walking` (de app); als de PWA na 1,5 s nog zichtbaar is (app niet geïnstalleerd), de website `https://www.google.com/maps/dir/?api=1&destination=…&travelmode=walking&dir_action=navigate`. Of de Google-app meteen de navigatie start, is niet gecontroleerd.
  - Zonder bekende locatie van de attractie/show: melding dat navigeren niet kan.
- Techniek: `withSwipe()` in `main.ts` met pointer events, `touch-action: pan-y` (verticaal scrollen blijft werken), drempel 80 px, max 140 px uitslag. Tijdens een veeg wordt `render()` uitgesteld (`swipeBusy`/`renderPending`), anders zou de automatische verversing de rij onder je vinger vervangen. Na een veeg wordt de tik op de rij 400 ms genegeerd. Keuzemenu: `actionSheet()` (herbruikbaar, CSS `.asheet*`).
- **Afgestreepte verbergen (sinds 0.10.0):** knopje "Gezien" naast "Shows" (alleen zichtbaar als er vandaag iets is afgestreept). Uit = afgestreepte rijen weg; onderaan één tikbare regel "Afgestreept (N) ▸" die ze weer toont. Onthouden in `pp.planDone`. Werkt bij alle sorteringen en samen met shows inklappen.
- Niet gebouwd (mogelijke vervolgstappen): afstrepen delen tussen toestellen; dezelfde acties als knoppen in het detailvenster (voor wie niet veegt).

### 6.3a Locatie (sinds 0.6.0)
- **Eenmalig per keer dat de app opent** (`posAskedThisSession` in `main.ts`), daarna gaat de gps uit. Op Remco's verzoek (21 nov 2026). Daarvoor vroeg de app bij elke verversing (elke 1 à 2 min) opnieuw een gps-positie op.
- Opnieuw bepalen alleen bij: ↻ (forceRefresh), "Gebruik mijn locatie", of de app helemaal afsluiten en opnieuw openen. Een positie in localStorage (`pp.pos`) blijft 10 minuten bruikbaar.
- Gevolg: afstanden, looptijden, "bij <attractie>" en vertrektijden blijven gebaseerd op de plek waar je de app opende tot je ↻ tikt. Bewuste afweging; zo uitgelegd aan Remco en in Instellingen > Locatie.
- Let op iOS: een PWA die naar de achtergrond gaat en terugkomt, telt niet als "opnieuw openen". Pas na volledig afsluiten wordt de locatie opnieuw gevraagd.

### 6.4 Detailvenster
Illustratie per soort (eigen SVG's), grote wachttijd/status, grafiek "Verloop vandaag" (schaal **rechts**, 0/20/45/max), feiten, omschrijving (min. lengte alleen waar bevestigd, tip, gebied, openingsjaar), showtijden, favoriet-knop.

### 6.5 Grafiek
Trapjes in niveaukleur, grijs bij dicht/onderhoud, **storingen als lichtrode zone + gestippelde rode lijn onderin**, "Storing: N keer, samen X". Resolutie ~5 min. Minder dan twee punten: "wordt opgebouwd".
- **Bekende vertraging** (gezien door Remco 21 nov 2026, screenshot Cars ROAD TRIP: 30 ▼20, grafiek eindigt op 50): het getal en het pijltje komen uit de live-route (bron vs. laatst opgeslagen staat, direct); de grafiek uit `wait_log`, dat alleen de cron elke 5 min schrijft, plus 60 s cache in de app (`loadHistory`) en 30 s HTTP-cache. De grafiek kon dus tot ~6 min achterlopen. **Opgelost in 0.10.1:** `withLiveTail()` in `main.ts` voegt de actuele live-stand als laatste punt toe als die afwijkt van het laatste opgeslagen punt (tijdstip = `changedAt` van de live-route, anders nu). Alleen in de app, geen extra schrijfacties. Geldt voor uitklappen en detailvenster, niet in de simulatie.

### 6.6 Instellingen
Thema, tekstgrootte, sortering, aankomstmarge, looptempo, koppelcode, **Geschiedenis bijhouden** (Uit / Alleen overdag / Altijd), **Simulatie**, "Kopieer lijst zonder omschrijving", en onderaan de knop **"Versie 0.6.0 · zoek update"** (sinds 0.6.0): vraagt `/api/health` zonder cache op, laat de service worker op updates controleren, en herlaadt de app als de server een andere versie meldt; anders "Je hebt de nieuwste versie". Offline: duidelijke melding. Functie `checkForUpdate()` in `main.ts`. Daaronder een inklapbaar **"Wat is er nieuw"** (sinds 0.7.0) uit `changelog.ts`; versies vóór 0.6.0 zijn samengevat uit dit document (0.5.0 en "Eerder"), zonder datum omdat die niet bekend is.

### 6.8 Kijkplek van een show vastleggen (sinds 0.12.0)
- Voor shows **zonder locatie in de bron** (dan geen afstand, vertrektijd of navigatie). Remco legt ter plekke de beste kijkplek vast; die geldt **voor alle gebruikers** (server, tabel `user_locations`).
- **Lang drukken** (0,6 s stil, `withLongPress()` in `main.ts`) op de showrij in Overzicht (lijst en showkaart) en Mijn programma. Bewegen >10 px annuleert, dus scrollen en vegen blijven werken. Alleen bij shows waar `canSetSpot()` geldt (show, geen bronlocatie). Rij licht op tijdens het vasthouden (`.lp-hold`).
- Flow: menu "Je plek bepalen…" (Annuleren) → verse gps-meting (`getPrecisePosition()`, `maximumAge: 0`, met nauwkeurigheid) → **altijd bevestigen** met de nauwkeurigheid (±N m); boven 40 m de tip om even te wachten. **Bestaat er al een plek** (Remco, 12:58: "Vraag wel even bevestiging als er al een locatie is"): de bevestiging toont de nauwkeurigheid van de oude én de nieuwe plek, hoe lang geleden de oude is vastgelegd en de afstand ertussen; keuzes Vervangen / Kijkplek verwijderen / Annuleren. De server dwingt dit af (`replace: true` nodig); legt iemand anders intussen een plek vast, dan toont de app die en vraagt opnieuw.
- Detailvenster: feit "Kijkplek" (niet bekend + uitleg dat je de show kunt indrukken, of: door een bezoeker vastgelegd, ±N m, wanneer).
- Bronlocaties worden nooit overschreven. Iedereen met een profiel kan een plek wijzigen of verwijderen (geen beheerder); prima voor persoonlijk gebruik, bij breder delen beperken.
- Niet in de simulatiestand (verzonnen locatie). De gemeten plek wordt ook je eigen positie.
- Andere gebruikers zien een nieuwe plek pas als hun app de entiteiten opnieuw laadt (bij openen/parkwissel; cache max. 2 min).

### 6.7 Simulatiestand
Doet alsof je in het park staat ("Ik sta bij …"): park open, eigen locatie, verzonnen wachttijden die elke 5 min verschuiven, enkele storingen/onderhoud, showtijden per 45 min, verzonnen dagverloop. Oranje balk "SIMULATIE" met Stop. Echte cache blijft; programma voor morgen blijft echt.

---

## 7. Data, bronnen en wat we weten (en niet weten)

### 7.1 ThemeParks.wiki API v1
- In gebruik: `/destinations`, `/entity/{id}/children`, `/entity/{id}/live`, `/entity/{id}/schedule`.
- Live: status (OPERATING/DOWN/CLOSED/REFURBISHMENT), `queue.STANDBY.waitTime`, `queue.SINGLE_RIDER.waitTime`, `showtimes`, `lastUpdated`.
- **Single rider (sinds 0.9.0):** de Worker geeft `singleRider` (rij bestaat) en `singleRiderWait` (getal of null). **Niet gecontroleerd of de bron voor Disneyland Paris echt single-rider-wachttijden levert**; mogelijk is die meestal null. Dan toont de app "geen wachttijd bekend". Single-rider-tijden worden niet in de historie bijgehouden.
- **Geen wijzigingstijd van de wachttijd** in de bron; daarom de eigen tracker (5 min nauwkeurig).
- **Showtijden:** lijken alleen voor vandaag te komen; toekomst **niet bevestigd**. App toont voor andere dagen **verwachte** tijden (zelfde weekdag vorige week of laatst geziene dag), gemarkeerd. Nog te onderzoeken: `/entity/{showId}/schedule`.
- Bronleeftijd meestal 2 tot 5 min; geforceerd verversen maakt de bron niet verser.

### 7.2 Parken
`dlp-disneyland` ("Disneyland Park") en `dlp-studios` ("Disney Adventure World", herkend via `/walt disney studios|disney adventure world/i`). Europe/Paris.

### 7.3 Showprogramma per dag
`buildShowDay` combineert bron-tijden met verwachte tijden uit `show_seen` (30 dagen).

### 7.4 Omschrijvingen en feiten (`apps/web/src/info.ts`)
- Eigen teksten, gekoppeld op naam. **Nooit feiten verzinnen.** Lengtematen alleen uit bronnen (tarifs.org, dlptips.com): Big Thunder 102 cm, Star Tours 102, Space Mountain 120, Indiana Jones 140, Crush's Coaster 107, Tower of Terror 102, RC Racer 120, Flight Force 120, Autopia en Parachute Drop 81 cm met volwassene/132 cm alleen. **Niet bevestigd:** Rock 'n' Roller Coaster, Raiponce Tangled Spin, Frozen Ever After ("geen minimum (verwacht)").
- Gebied (demagieexpert.nl) en openingsjaar in `FACTS`.
- **Afbeeldingen:** bewust geen foto's; eigen SVG's. Opties: eigen foto's of gecontroleerde Wikimedia Commons-bestanden.

---

## 8. Kostenontwerp (Cloudflare gratis laag)

"Laagste kosten maar nog acceptabel gebruik": alleen de cron schrijft naar D1, rijen alleen bij wijziging; "alleen overdag" standaard; zuinig verversen; upstream-cache (bestemmingen 24 u, entiteiten 6 u, live 30 s, schedule 30 min). Ruim onder de gratis limieten bij persoonlijk gebruik.

---

## 9. Beveiliging en privacy

- Locatie alleen wanneer nodig, verlaat het toestel niet. Geen tracking of analyse.
- "Geschiedenis bijhouden" is server-breed met alleen een geldig profiel; bij breder delen een beheerder/geheim toevoegen.
- Korte koppelcodes: rate limiting beperkt brute force, sluit het niet uit.

---

## 10. Bewuste ontwerpbeslissingen en dingen die Remco afkeurde

1. **Geen omschrijvingen in lijsten of rijen.**
2. **Wachttijden alleen als getal, nooit "min".** "min" mag bij looptijd en "over 14 min".
3. **Storing = alleen rood uitroepteken, onderhoud = alleen grijze moersleutel**, zonder ring of driehoek.
4. **Storingstegel: alleen drie getallen, geen labels**, groen/rood/grijs.
5. **Pijltjes:** ▲ rood = langer, ▼ groen = korter.
6. **Grafiek:** schaal rechts; storingen als lichtrode zone + gestippelde rode lijn.
7. **Mijn programma:** kleine kop, compact sorteren, shows bovenaan bij Wachttijd, afstand groot vooraan bij Afstand, tijden niet dubbel.
8. **Uitklappen in de rij** bij tikken op wachttijd/showtijd.
9. **Niets verzinnen:** liever "niet bekend"/"verwacht"; aannames zichtbaar gelabeld.
10. Standaard **Adventure World**.
11. **Simulatiestand** voor tests buiten het park, met niet alles gesloten.

---

## 11. Openstaande punten en bekende risico's

**Bevestigd door Remco op 21 nov 2026:** "Versie 0.5.0 is in orde." De laatste reeks wijzigingen staat live. Niet per onderdeel nagevraagd.

**Nieuw gevonden (21 nov 2026):**
- ~~`tools/` ontbrak~~ en ~~oude losse bestanden in de root~~: opgelost op 21 nov 2026 (28 tests, root opgeruimd).
- **Testbranch `claude/koppeltest`** staat nog op GitHub (Claude kan geen branches verwijderen). Remco kan hem verwijderen via GitHub → Branches.

**0.10.0 (21 nov 2026), door Remco te controleren:** knop "Gezien", regel "Afgestreept (N)", past de balk met drie knoppen nog op zijn scherm.

**0.12.0 (21 nov 2026), door Remco te controleren:** lang drukken op een show zonder locatie (botst het niet met scrollen/vegen of het iOS-tekstmenu?), gps-nauwkeurigheid in de bevestiging, vervangen-bevestiging met beide nauwkeurigheden, afstand/vertrektijd verschijnt daarna. Niet op een telefoon bekeken door Claude.

**0.11.1:** single-rider-getallen zichtbaar op screenshot van Remco (werkt).

**0.9.0:** door Remco bevestigd ("Werkt", 21 nov 2026 11:31).

**0.8.0 (21 nov 2026), door Remco te controleren:** vegen links/rechts op zijn iPhone (botst het niet met scrollen?), bevestigingsmenu, Apple Kaarten opent met looproute, Google Maps opent de app (en start die meteen de navigatie?).

**0.7.0 (21 nov 2026), door Remco te controleren:** shows inklappen (knop en kop), past de balk op zijn telefoon, "Wat is er nieuw" in Instellingen.

**0.6.0 (21 nov 2026), door Remco te controleren:**
- Gaat het gps-pijltje op de iPhone na de eerste positie uit en blijft het uit tijdens verversen?
- Updateknop: bij een nieuwe deploy herlaadt de app naar de nieuwe versie; zonder nieuwe versie de melding "nieuwste versie".
- Storingspagina toont bij open park geen los woord "null" meer (bug gevonden met de strengere typecheck: `append(null)`; mogelijk zag Remco dat al).

**Niet gecontroleerd door Claude (geen browser):**
- **Service worker** niet getest op een echte iPhone (oude versie blijft hangen? bijwerken na deploy?). Controleren bij 0.6.0.
- **Cron** en "alleen overdag" alleen met nepomgeving getest. Controle: detailvenster na een paar uur, of Cloudflare → Workers → parkpilot → Triggers.
- Migraties 0003/0004 alleen lokaal getest.
- **Showprogramma voor morgen** werkt pas na dagen historie.
- Deel van de **omschrijvingen/lengtes** uit eigen kennis; drempels 20/45 zijn een eigen keuze.
- CSS `zoom` voor "Comfortabel" visueel niet gecontroleerd.
- Oude CSS-regels (`.pchips`, `.ptime`/`.pwait`) opruimen.
- `main.ts` (~1300 regels) splitsen; alleen met akkoord. Kost Remco nu geen uploadwerk meer.

---

## 12. Aanbevolen start van een nieuwe chat

1. Lees dit document volledig, vooral 2, 4.1, 15 en het logboek (16).
2. `add_repo` RemcoNLD/parkpilot (push), `git clone --depth 1`. Werkt schrijven niet: Remco moet de Claude GitHub App installeren (4.1).
3. `bash tools/test-worker.sh` (31 × ok) en de frontend-typecheck draaien.
4. Verhoog bij de eerstvolgende app-levering het versienummer (`version.ts` en `package.json`).
5. Werk na elke stap dit document bij (project én repo).

**Voorbeeld-startprompt voor een nieuwe chat:**

> Ik werk aan ParkPilot, een PWA voor Disneyland Paris (repo RemcoNLD/parkpilot, live op parkpilot.remco-dv.workers.dev). Lees eerst het overdrachtsdocument in dit project volledig. Ik heb geen terminal en werk vanaf mijn telefoon; koppel de repo en commit zelf naar GitHub. Wees kritisch en eerlijk, zeg wat je niet hebt kunnen controleren, en werk het overdrachtsdocument altijd bij. We gaan verder met: [onderwerp].

---

## 13. Backlog (nog niet gebouwd)

1. **Vertrekmeldingen/Web Push** (fase 2): VAPID-sleutels als Worker-secrets, abonnementen in D1, tijdige verzending (fijnere cron of Durable Object/queue). iOS alleen als beginscherm-PWA (16.4+). Kosten en betrouwbaarheid eerst bespreken.
2. **Looproutes** met OpenStreetMap in plaats van hemelsbreed × 1,3.
3. **Efteling en andere parken.** ThemeParks.wiki lijkt het te dekken, niet geverifieerd. Alternatief Queue-Times.com ("Powered by Queue-Times.com"). Eerst een controle in de app of het park wordt gevonden.
4. **Echte foto's** met correcte licentie of eigen foto's.
5. **Toekomstige showtijden** via schedule-endpoints.
6. **Wachttijdhistorie uitbreiden** (gisteren / zelfde weekdag vorige week).
7. Kleurdrempels, meer omschrijvingen, CSS opruimen, `main.ts` splitsen.
8. Beveiliging verscherpen bij breder delen.
9. **Framework-features losmaken** (15.3) als herbruikbare modules. Alleen op verzoek.

---

## 14. Handige referentie

- Frontendfuncties in `main.ts`: `render()`, `listNodes()`, `renderRow()`, `renderShowCard()`, `statusRing()`, `planNodes()`/`planShow()`/`planAttraction()`/`planHeader()`, `expandPanel()`, `sparkline()`, `openDetail()`, `openIssues()`, `openSettings()`, `refreshLive()`/`forceRefresh()`, `applySimulation()`, `parkStatus()`/`parkStats()`.
- Thema's: CSS-custom-properties met `data-theme` × `data-park` in `style.css`. iOS-statusbalk via `.statusbar`-div (black-translucent).
- Tijdzone-hulp Worker: `localDateStr`, `localTimeStr`, `zonedEpochMs`, `addDays`, `startOfLocalDaySec` in `worker/src/util.ts`.
- `h()` in `dom.ts`: `aria-*` met `true/false` worden strings "true"/"false".

---

## 15. Remco: werkwijze, voorkeuren en framework-features (groeit mee)

Claude vult dit aan zodra iets nieuws blijkt. Geldt **voor elke app** van Remco. Bij elk punt: datum en of hij het letterlijk zei of dat het is afgeleid.

### 15.1 Hoe Remco werkt
- Nederlands, kort, direct. Geen lange samenvattingen. (letterlijk/vast)
- Geen terminal, geen commando's. (letterlijk)
- Werkt vanaf zijn **telefoon**; Claude commit zelf via de GitHub-koppeling. (21 nov 2026, letterlijk)
- Stuurt screenshots en korte zinnen. (afgeleid)
- Een vraag is een vraag: eerst antwoorden, pas bouwen als hij dat zegt. (letterlijk)
- Controleert zelf in de live app; daarom altijd een zichtbaar, opgehoogd versienummer. (letterlijk)
- **Het overdrachtsdocument moet altijd actueel zijn**, met alles wat Claude over hem leert in een aparte sectie (dit hoofdstuk). (21 nov 2026, letterlijk)
- Batterij en privacy wegen zwaar: geen gps die blijft lopen. (21 nov 2026, afgeleid uit verzoek "locatie eenmalig, daarna gps uit")
- **Versienummers:** kleine verbetering of reparatie = laatste cijfer omhoog (0.10.0 → 0.10.1); nieuwe functie = middelste cijfer (0.10.x → 0.11.0). Remco noemde een kleine aanpassing een "minor update"; Claude koos 0.10.1 en meldde dat. Bij twijfel: zo houden tenzij hij anders zegt. (21 nov 2026)
- Bij iets wat een bestaande (gedeelde) waarde overschrijft: eerst bevestiging vragen, met de gegevens om te kunnen kiezen (bij kijkplekken: nauwkeurigheid van oud én nieuw). (21 nov 2026, letterlijk: "Vraag wel even bevestiging als er al een locatie is")
- Wil zien wat er per versie veranderd is, in de app zelf. (21 nov 2026, letterlijk: "Maak ook een changelog in de app")
- Bij instellingen in een webinterface (zoals koppelingen) komt hij soms op een verkeerd scherm; geef de exacte link en zeg wat hij níet moet kiezen. (21 nov 2026, afgeleid)

### 15.2 Wat Remco belangrijk vindt
- **Eerlijkheid boven gemak:** kritisch, niets verzinnen, benoemen wat niet gecontroleerd is. (letterlijk)
- **Geen verzonnen data in de app:** aannames zichtbaar labelen. (afgeleid)
- **Lage kosten** bij acceptabel gebruik. (letterlijk)
- **Rustige, compacte UI:** getallen boven labels, geen overbodige tekst. (afgeleid; bevestigd 21 nov 2026 bij single rider: "Geen label. Het is wel duidelijk. Dus alleen getallen.")
- **Kleurlogica:** groen = goed, rood = fout. (letterlijk)
- **Alles verticaal netjes uitgelijnd:** getallen, pijltjes en kolommen recht onder elkaar, ook als sommige rijen extra informatie hebben. Reserveer liever vaste ruimte dan dat iets verspringt. (21 nov 2026, letterlijk: "alles moet verticaal altijd netjes uitlijnen")
- **Privacy:** geen accounts, geen analytics, locatie op het toestel. (afgeleid)
- **Testbaar zonder echte situatie:** simulatie-/demostand. (letterlijk)

### 15.3 Framework-features (horen in elke app)
**Letterlijk door Remco genoemd** staat erbij; de rest is afgeleid uit ParkPilot en moet hij nog bevestigen.

1. **Licht/donker-schakelaar, op de ParkPilot-manier.** *(Letterlijk door Remco genoemd als framework feature, 21 nov 2026.)*
   - Volgt standaard het systeem (`prefers-color-scheme`); één wisselknop in de kop, plus keuze in Instellingen.
   - Alleen een handmatige keuze wordt bewaard (localStorage `<app>.theme`); zonder keuze blijft het systeem leidend.
   - Eén attribuut op het root-element (`data-theme="light|dark"`); alle kleuren als CSS custom properties per thema. Tweede attribuut (bij ParkPilot `data-park`) voor een accent per context.
   - iOS-PWA: statusbalk `black-translucent` met eigen `.statusbar`-div.
   - Code: `apps/web/src/theme.ts` + `style.css`. **Nog te controleren:** thema vóór eerste render (geen witte flits) en meeveranderende `<meta name="theme-color">`.
2. **Zichtbaar versienummer** op drie plekken, uit één bron, ook via `/api/health`; elke levering ophogen. In Instellingen als **knop "Versie X · zoek update"** die geforceerd op een update controleert en zo nodig herlaadt (`checkForUpdate()`, vergelijkt `/api/health` met de app-versie). *(**Bevestigd door Remco als framework feature, 21 nov 2026.**)*
3. **Tekstgrootte Compact/Comfortabel** ("Aa", ~20%, onthouden). *(Afgeleid.)*
4. **Mobile-first PWA** met offline app-schil. *(Afgeleid.)*
5. **`store`-helper** voor localStorage met try/catch en app-prefix. *(Afgeleid.)*
6. **Anoniem profiel + koppelcode** voor meerdere toestellen. *(Afgeleid.)*
7. **Versheid en offline zichtbaar.** *(Afgeleid.)*
8. **Zuinig verversen** (zichtbaar + online, plus ↻). *(Afgeleid.)*
13. **Keuzemenu onderin** (`actionSheet()`, iOS-stijl) voor bevestigingen en keuzes in plaats van browser-popups. *(Afgeleid uit 0.8.0, nog bevestigen.)*
12. **Changelog in de app** ("Wat is er nieuw" onder de versieknop in Instellingen, gevoed uit één bestand). *(Gevraagd voor ParkPilot op 21 nov 2026; dat het in elke app hoort: afgeleid, nog bevestigen.)*
11. **Locatie zuinig:** alleen op verzoek, eenmalig per app-start, daarna gps uit; handmatig bijwerken via ↻. *(**Bevestigd door Remco als framework feature, 21 nov 2026.**)*
9. **Simulatie-/demostand** met gekleurde balk en Stop. *(Afgeleid.)*
10. **Instellingenscherm** als vaste plek voor voorkeuren. *(Afgeleid.)*

---

## 16. Logboek

- **21 nov 2026, ochtend:** overdrachtsdocument opgesteld (einde vorige bouwsessie).
- **21 nov 2026, 08:45:** Remco bevestigt 0.5.0. Wil vanaf telefoon werken. Afspraken toegevoegd: document altijd bijwerken; hoofdstuk 15 en dit logboek aangemaakt. Licht/donker-schakelaar als eerste framework feature benoemd.
- **21 nov 2026, 08:51–08:55:** GitHub gekoppeld (eerst per ongeluk op "Add custom connector"; juiste route in 4.1). Lezen werkte eerst, schrijven pas na installatie van de Claude GitHub App. Branch-push getest (werkt); branch verwijderen geblokkeerd, `claude/koppeltest` blijft staan. Bij het lezen gevonden: `tools/` ontbreekt, oude losse bestanden in de root, `HANDOVER.md` ontbrak.
- **21 nov 2026, 09:00:** `HANDOVER.md` toegevoegd aan de repo als eerste commit van Claude. Rechtstreeks naar `main` pushen werkt.
- **21 nov 2026, 13:10 — versie 0.12.0:** kijkplek van shows zonder bronlocatie vastleggen door lang drukken, gedeeld voor alle gebruikers (6.8). Op Remco's aanvulling: altijd bevestigen met gps-nauwkeurigheid, bij een bestaande plek van beide. Migratie 0005, 3 nieuwe tests (31 × ok).
- **21 nov 2026, 12:20 — versie 0.11.5:** verschil (▲/▼) onder de single-rider-badge, rechts van de wachttijd.
- **21 nov 2026, 12:16 — versie 0.11.4:** wachttijd attracties groter (54 px), single rider in witte badge.
- **21 nov 2026, 12:12 — versie 0.11.3:** alles in Mijn programma lijnt verticaal uit (vaste strook voor single rider, gelijke breedte grote getallen).
- **21 nov 2026, 12:08 — versie 0.11.2:** single rider rechtsboven de wachttijd; delta op de basislijn van de wachttijd. Bevestigd: bron levert single-rider-getallen voor DLP.
- **21 nov 2026, 11:58 — versie 0.11.1:** single-rider-getal strakker onder de wachttijd (-7px).
- **21 nov 2026, 11:55 — versie 0.11.0:** single-rider-wachttijd klein onder de gewone wachttijd in Mijn programma, zonder label.
- **21 nov 2026, 11:45 — versie 0.10.1:** grafiek sluit aan op het live-getal (`withLiveTail`). Remco vroeg om een "minor update"; uitgevoerd als 0.10.1 (patch), zie 15.1.
- **21 nov 2026, 11:40:** Remco vraagt waarom de grafiek achterloopt op het getal; uitgelegd (cron elke 5 min), oplossing voorgesteld, niet gebouwd. Tijden in dit logboek gecorrigeerd naar de echte berichttijden.
- **21 nov 2026, 11:33 — versie 0.10.0:** Remco bevestigt 0.9.0. Nieuw: afgestreepte attracties/shows verbergen in Mijn programma (knop "Gezien").
- **21 nov 2026, 11:25 — versie 0.9.0:** single-rider-wachttijd in het uitklappen (en detailvenster); Worker levert `singleRiderWait`; test uitgebreid.
- **21 nov 2026, 11:22 — versie 0.8.0:** vegen in Mijn programma: links = afstrepen als gezien (bevestiging, per dag, per toestel), rechts = lopend navigeren via Apple Kaarten of Google Maps (zie 6.3b).
- **21 nov 2026, 11:03 — versie 0.7.1:** fout van 0.7.0 hersteld: de nieuwe kop "Shows ▾" gebruikte de bestaande CSS-klasse `.ptoggle` (de knop van de grote tijd/wachttijd in Mijn programma) en overschreef de opmaak daarvan. Nu `.pshows-toggle`. Les: zoek altijd eerst of een klassenaam al bestaat (`grep -n "\.naam" style.css main.ts`). Remco vroeg ook of afgelopen shows verdwijnen: nee (zie 6.3); voorstel gedaan, nog niet gebouwd.
- **21 nov 2026, 11:00 — versie 0.7.0:** shows inklappen in Mijn programma (onthouden); changelog in de app (Instellingen > Wat is er nieuw, `changelog.ts`).
- **21 nov 2026, 10:55:** Remco bevestigt updateknop-met-versie en zuinige locatie als framework features (15.3 punten 2 en 11).
- **21 nov 2026, 10:52 — versie 0.6.0:** locatie eenmalig per app-start (gps daarna uit, ↻ werkt bij); updateknop met versie in Instellingen; storingspagina-bug ("null") opgelost; strengere app-typecheck toegevoegd aan `tools/test-worker.sh` (vond 3 oude typefouten, alle opgelost).
- **21 nov 2026, 09:15:** Op verzoek van Remco: tien oude losse bestanden uit de repo-root verwijderd, `.gitignore` toegevoegd, `tools/` met worker-typecheck en 28 tests opnieuw opgebouwd (alles ok). App-code ongewijzigd, versie blijft 0.5.0.

*Einde van het overdrachtsdocument.*
