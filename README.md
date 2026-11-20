# ParkPilot

Mijn mobile-first PWA voor wachttijden en shows in Disneyland Paris (opzet geschikt voor andere parken).
Stack: Vite + TypeScript, één Cloudflare Worker (API + statische app), Cloudflare D1, live data van ThemeParks.wiki.

Status: **fase 1, stap 1 en 2** (scaffold, data, favorieten, koppelcode). Nog niet gebouwd: sorteren, locatie,
service worker/offline, showplanning en pushmeldingen.

## Eenmalig instellen

```bash
npm install
npx wrangler login
npx wrangler d1 create parkpilot
```

Zet het `database_id` uit de uitvoer in `wrangler.toml`. Daarna:

```bash
npm run db:migrate        # maakt de tabellen aan in Cloudflare
npm run deploy            # bouwt de app en zet Worker + app online
```

## Koppelen aan GitHub (automatisch deployen)

Cloudflare dashboard → Workers & Pages → Create → Import a repository → kies deze repo.

- Build command: `npm run build`
- Deploy command: `npx wrangler d1 migrations apply parkpilot --remote && npx wrangler deploy`

Zo draaien nieuwe migraties automatisch mee bij elke push.

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
