/** Wat er per versie is veranderd. Nieuwste bovenaan. Bij elke nieuwe versie hier een regel toevoegen. */
export interface ChangelogEntry { version: string; date?: string; changes: string[] }

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.11.5',
    date: '21 nov 2026',
    changes: ['Mijn programma: het verschil (▲/▼) staat nu rechts van de wachttijd, onder het single-rider-getal. Daardoor meer ruimte voor de naam.'],
  },
  {
    version: '0.11.4',
    date: '21 nov 2026',
    changes: ['Mijn programma: wachttijden groter, en het single-rider-getal in een wit badge (getal in de kleur van het niveau).'],
  },
  {
    version: '0.11.3',
    date: '21 nov 2026',
    changes: ['Mijn programma: alle grote wachttijden en pijltjes staan nu recht onder elkaar, ook als er bij sommige attracties een single-rider-getal staat.'],
  },
  {
    version: '0.11.2',
    date: '21 nov 2026',
    changes: ['Mijn programma: het single-rider-getal staat nu klein rechtsboven de wachttijd, en het pijltje met het verschil staat op één lijn met de wachttijd.'],
  },
  {
    version: '0.11.1',
    date: '21 nov 2026',
    changes: ['Mijn programma: het single-rider-getal staat strakker onder de wachttijd.'],
  },
  {
    version: '0.11.0',
    date: '21 nov 2026',
    changes: ['Mijn programma: de single-rider-wachttijd staat klein onder de gewone wachttijd, als de bron er een geeft.'],
  },
  {
    version: '0.10.1',
    date: '21 nov 2026',
    changes: ['Grafiek "Verloop vandaag" loopt niet meer achter op het getal: de actuele wachttijd staat nu als laatste stukje tot "nu" in de grafiek.'],
  },
  {
    version: '0.10.0',
    date: '21 nov 2026',
    changes: [
      'Mijn programma: met de knop "Gezien" verberg je afgestreepte attracties en shows. Onderaan staat dan "Afgestreept (aantal)"; tik daarop om ze weer te tonen. De keuze wordt onthouden.',
    ],
  },
  {
    version: '0.9.0',
    date: '21 nov 2026',
    changes: [
      'Uitklappen van een attractie toont nu ook de wachttijd voor single riders, als de attractie een single-rider-rij heeft. Levert de bron geen tijd, dan staat er "geen wachttijd bekend".',
    ],
  },
  {
    version: '0.8.0',
    date: '21 nov 2026',
    changes: [
      'Mijn programma: veeg een rij naar links om hem af te strepen als gezien (met bevestiging). Nog eens naar links vegen maakt het ongedaan. Geldt voor vandaag en alleen op dit toestel.',
      'Mijn programma: veeg een rij naar rechts om te navigeren. Kies Apple Kaarten of Google Maps; de route is lopend.',
    ],
  },
  {
    version: '0.7.1',
    date: '21 nov 2026',
    changes: ['Mijn programma: de grote tijd en wachttijd stonden in 0.7.0 mogelijk verschoven. Hersteld.'],
  },
  {
    version: '0.7.0',
    date: '21 nov 2026',
    changes: [
      'Mijn programma: shows inklappen met de knop "Shows" of door op de kop "Shows" te tikken. De keuze wordt onthouden.',
      'Instellingen: "Wat is er nieuw" met deze lijst.',
    ],
  },
  {
    version: '0.6.0',
    date: '21 nov 2026',
    changes: [
      'Je locatie wordt één keer bepaald als je de app opent; daarna gaat de gps uit. Tik op ↻ om je locatie bij te werken.',
      'Instellingen: knop met het versienummer die zoekt naar een update en de app zo nodig bijwerkt.',
      'Storingspagina: los woord "null" bij een open park weggehaald.',
    ],
  },
  {
    version: '0.5.0',
    changes: [
      'Storing en onderhoud als los rood uitroepteken en grijze moersleutel.',
      'Verversknop ↻ en zuiniger automatisch verversen.',
      'App start ook zonder verbinding.',
      'Grafiek toont storingen als lichtrode zone.',
      'Storingstegel knippert rood bij nieuwe storingen.',
    ],
  },
  {
    version: 'Eerder',
    changes: [
      'Live wachttijden, storingen, showtijden en afstanden voor Disneyland Park en Disney Adventure World.',
      'Mijn programma, detailvenster met dagverloop, koppelcode voor meerdere toestellen en simulatiestand.',
    ],
  },
];
