# ParkPilot

Mobile-first PWA voor wachttijden en shows in Disneyland Paris (opzet geschikt voor andere parken).
Stack: Vite + TypeScript, één Cloudflare Worker (API + statische app), Cloudflare D1, live data van ThemeParks.wiki.

Status: **v0.5.0** (fase 1) (data, favorieten, koppelcode, sorteren, afstand, parkthema's, wachttijdhistorie). Nog niet gebouwd:
service worker/installatie-offline, showplanning en pushmeldingen.

## Online zetten zonder terminal

1. Zet alle bestanden in een lege GitHub-repo (op github.com: Add file > Upload files, sleep de uitgepakte mappen erin).
2. Cloudflare dashboard > Workers & Pages > Create > Import a repository > kies de repo.
3. Vul in:
   - Build command: `npm run build`
   - Deploy command: `npm run deploy:cloudflare`
4. Deploy. Cloudflare maakt de Worker en de D1-database aan, bouwt de app en voert de migraties uit.
   Daarna gaat elke push naar `main` automatisch live, nieuwe migraties in `worker/migrations/` inbegrepen.

Faalt de eerste deploy bij de database of de migratie? Maak de database dan eenmalig zelf: `npx wrangler d1 create parkpilot`,
zet `database_name = "parkpilot"` en het `database_id` in `wrangler.toml`, en push opnieuw.

## Lokaal ontwikkelen

```bash
npm run build              # eenmalig, wrangler verwacht de map apps/web/dist
npm run db:migrate:local
npm run dev:worker         # API op http://localhost:8787
npm run dev:web            # app op http://localhost:5173 (proxyt /api naar de Worker)
```

## Koppelcode: hoe het werkt

- De app maakt bij de eerste start anoniem een profiel + apparaat aan. Het apparaattoken staat alleen op je toestel;
  de server bewaart er alleen een hash van.
- Instellingen → **Maak koppelcode** toont een code als `K7QM-4TXD-9HBR` (60 bit). De server bewaart alleen een hash.
  De code wordt dus maar één keer getoond; een nieuwe code maakt de vorige ongeldig.
- Op een nieuw toestel of na herinstallatie: **Lijst terughalen** + code. Dat koppelt het toestel aan hetzelfde profiel
  (favorieten en voorkeuren). Meerdere toestellen kunnen hetzelfde profiel delen.
- Pogingen zijn begrensd (10 per uur per IP voor terughalen, 20 profielen per uur per IP).
- **iPhone:** een app via "Zet op beginscherm" heeft een eigen opslag, los van Safari. Maak de code dus in de
  geïnstalleerde app, of herstel er direct na installatie mee.

## API

| Route | Beschrijving |
|---|---|
| `GET /api/parks` | Parken; `available: false` als ze niet in ThemeParks.wiki gevonden zijn |
| `GET /api/parks/:id/entities` | Attracties en shows (6 uur gecachet) |
| `GET /api/parks/:id/live` | Wachttijden en showtijden (30 s gecachet) |
| `POST /api/profile` | Nieuw anoniem profiel + apparaat |
| `POST /api/profile/recovery-code` | Nieuwe koppelcode (met login) |
| `POST /api/profile/redeem` | Koppelcode inwisselen voor een nieuw apparaat |
| `GET/PUT/DELETE /api/favorites[/:parkId/:entityId]` | Favorieten |
| `GET/PUT /api/preferences/:parkId` | Voorkeuren |

Een park toevoegen: een regel in `worker/src/parks.ts`.

## Nog te controleren bij de eerste deploy

De Worker is getest tegen een nagebootste ThemeParks.wiki en D1, niet tegen de echte diensten. Controleer na de deploy:

1. `/api/parks` toont beide parken met `available: true` (anders klopt de naam-matching in `parks.ts` niet).
2. `/api/parks/dlp-disneyland/entities` bevat `location`-waarden. Zo niet, dan moet voor afstanden (stap 4) de
   locatie per entiteit apart worden opgehaald.
3. Of Disneyland Paris wachttijden en showtijden daadwerkelijk levert (ThemeParks.wiki is een community-API).

## Wachttijdhistorie

ThemeParks.wiki geeft alleen de actuele stand. ParkPilot legt zelf vast wanneer een wachttijd of status verandert
(`wait_state` en `wait_log`, 7 dagen bewaard). Dat gebeurt via een Cron Trigger elke 5 minuten (`wrangler.toml`)
en bij elke live-aanvraag. "Gewijzigd X min geleden" is dus zo nauwkeurig als dat meetinterval.
Nieuwe migraties draaien mee in `npm run deploy:cloudflare`.

## Versienummer

Het versienummer staat op één plek: `packages/shared/src/version.ts`. App en server tonen het allebei
(bovenin, onderaan en in Instellingen). Verhoog het bij elke oplevering. Toont de app een ander
versienummer dan de server, dan draait er een oude versie in de cache.

## Koppelcode

Je kiest zelf een code (minimaal 4 letters of cijfers, bijvoorbeeld `1234`) of laat een sterke code maken.
Alle toestellen die de code invullen delen één profiel: dezelfde favorieten en voorkeuren. De app haalt
favorieten elke minuut en bij het openen opnieuw op, zodat wijzigingen van een ander toestel verschijnen.
Een korte code is makkelijk te raden (10 pogingen per uur per IP); het lijstje bevat alleen favorieten.

## Actualiteit

- `lastUpdated` per attractie komt uit ThemeParks.wiki en wordt getoond als "bron X min geleden"
  (groen tot 10 min, oranje tot 30, rood daarboven).
- "Gewijzigd X min geleden", de pijl (rood = langer, groen = korter) en het dagverloop komen uit
  de eigen meting (zie Wachttijdhistorie).


## Wat er in v0.4.0 is veranderd
- Start standaard op Disney Adventure World. Kies je zelf een ander park, dan onthoudt de app dat (alleen een handmatige keuze wordt bewaard).
- Omschrijvingen staan alleen nog in het detailvenster (rijker, met minimale lengte waar die bevestigd is). De lijst blijft schoon.
- Park dicht: wachttijden worden niet meer als live getoond; de kop zegt wanneer het park weer opent.
- Shows: dagkeuze (Nu, Morgen, volgende dagen) met een programma op tijd gesorteerd. Tijden uit de bron zijn definitief. Voor dagen waarvoor de bron nog niets meldt toont de app een **verwachting** (streepjesrand) op basis van eerder geziene tijden. Daarvoor bewaart de server uurlijks de showtijden die ThemeParks.wiki meldt (migratie 0003, `show_seen`). De eerste dagen na installatie is er dus nog weinig te verwachten.
- Fixes: actieve knoppen (tabs, parken, chips, hartjes) werden niet gemarkeerd; er verscheen soms de tekst "null"; breedte op desktop beperkt; tekst in de ring bij shows zonder tijden.

## Wat er in v0.5.0 is veranderd
- Twee modi: Overzicht (zoals voorheen) en Mijn programma (alleen wat je volgt: shows bovenaan met eerstvolgende tijd, attracties met alleen naam, wachttijd en pijl voor meer of minder).
- Tekstgrootte: Compact of Comfortabel (knop "Aa" bovenin of via Instellingen). Beide keuzes worden onthouden.
- "Alleen open" werkt nu ook als het park dicht is (dan is er niets open).
- Simulatiestand (Instellingen): doet alsof je in het park staat met een open park, gekozen locatie en verzonnen wachttijden/showtijden, voor testen buiten het park. Duidelijke oranje balk zolang het aan staat.
- Geschiedenis bijhouden (Instellingen): Uit, Alleen overdag (openingstijden van het park, 30 min marge) of Altijd. Geldt voor de hele server; opgeslagen in `app_settings` (migratie 0004). De cron blijft elke 5 minuten starten, maar doet bij "uit" of een gesloten park niets.
- Tik op de wachttijd (of showtijd) in een rij: de rij klapt uit met het dagverloop of de showtijden van vandaag. Tik op de naam voor het detailvenster.
- Mijn programma is het startscherm als je iets volgt (anders het Overzicht). Kleine kop met park en dichtstbijzijnde attractie, grote wachttijden en showtijden zonder "min", afstand en looptijd per regel, de volgende showtijden rechts. Grafieken hebben een schaal.
