import { lang, t } from './i18n';

/**
 * Wat er per versie is veranderd. Nieuwste bovenaan. Bij elke nieuwe versie hier een regel toevoegen,
 * in het Nederlands (`changes`) én het Engels (`en`). Datum als JJJJ-MM-DD; de app toont hem in de gekozen taal.
 */
export interface ChangelogEntry { version: string; date?: string; changes: string[]; en?: string[] }

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.13.0',
    date: '2026-11-21',
    changes: [
      'De app is er nu ook in het Engels. Standaard volgt ParkPilot de taal van je telefoon; is die taal er niet, dan wordt het Engels. Dat wordt bij elke start opnieuw bekeken.',
      'Instellingen > Weergave > Taal: kies Auto, NL of EN.',
    ],
    en: [
      'The app is now also available in English. By default ParkPilot follows your phone\'s language; if that language isn\'t available, English is used. This is checked again every time the app starts.',
      'Settings > Display > Language: choose Auto, NL or EN.',
    ],
  },
  {
    version: '0.12.2',
    date: '2026-11-21',
    changes: ['Verloop vandaag wordt op je telefoon bewaard. Bij slecht bereik zie je het laatst opgehaalde verloop met een grijze achtergrond en het tijdstip; zodra er weer bereik is, wordt het vanzelf bijgewerkt.'],
    en: ['Today\'s wait time history is stored on your phone. With poor reception you see the last history fetched, with a grey background and the time; as soon as you have reception again, it updates automatically.'],
  },
  {
    version: '0.12.1',
    date: '2026-11-21',
    changes: ['Instellingen compacter: één regel per instelling in groepen, uitleg achter de (i), koppelcode en "Wat is er nieuw" inklapbaar.'],
    en: ['More compact settings: one line per setting in groups, explanations behind the (i), link code and "What\'s new" collapsible.'],
  },
  {
    version: '0.12.0',
    date: '2026-11-21',
    changes: [
      'Kijkplek vastleggen: houd een show zonder locatie ingedrukt als je op de beste plek staat. De app meet je plek, toont hoe nauwkeurig de gps is en vraagt om bevestiging.',
      'De kijkplek geldt voor alle gebruikers. Staat er al een plek, dan zie je de nauwkeurigheid van beide en kies je vervangen of verwijderen.',
    ],
    en: [
      'Save a viewing spot: press and hold a show without a location while standing at the best spot. The app measures your location, shows how accurate the GPS is and asks for confirmation.',
      'The viewing spot applies to all users. If there is already a spot, you see the accuracy of both and choose to replace or remove it.',
    ],
  },
  {
    version: '0.11.5',
    date: '2026-11-21',
    changes: ['Mijn programma: het verschil (▲/▼) staat nu rechts van de wachttijd, onder het single-rider-getal. Daardoor meer ruimte voor de naam.'],
    en: ['My plan: the difference (▲/▼) is now to the right of the wait time, below the single rider number. This leaves more room for the name.'],
  },
  {
    version: '0.11.4',
    date: '2026-11-21',
    changes: ['Mijn programma: wachttijden groter, en het single-rider-getal in een wit badge (getal in de kleur van het niveau).'],
    en: ['My plan: larger wait times, and the single rider number in a white badge (number in the colour of the level).'],
  },
  {
    version: '0.11.3',
    date: '2026-11-21',
    changes: ['Mijn programma: alle grote wachttijden en pijltjes staan nu recht onder elkaar, ook als er bij sommige attracties een single-rider-getal staat.'],
    en: ['My plan: all large wait times and arrows now line up vertically, even when some attractions show a single rider number.'],
  },
  {
    version: '0.11.2',
    date: '2026-11-21',
    changes: ['Mijn programma: het single-rider-getal staat nu klein rechtsboven de wachttijd, en het pijltje met het verschil staat op één lijn met de wachttijd.'],
    en: ['My plan: the single rider number is now small at the top right of the wait time, and the arrow with the difference is in line with the wait time.'],
  },
  {
    version: '0.11.1',
    date: '2026-11-21',
    changes: ['Mijn programma: het single-rider-getal staat strakker onder de wachttijd.'],
    en: ['My plan: the single rider number sits closer below the wait time.'],
  },
  {
    version: '0.11.0',
    date: '2026-11-21',
    changes: ['Mijn programma: de single-rider-wachttijd staat klein onder de gewone wachttijd, als de bron er een geeft.'],
    en: ['My plan: the single rider wait time is shown small below the regular wait time, if the source provides one.'],
  },
  {
    version: '0.10.1',
    date: '2026-11-21',
    changes: ['Grafiek "Verloop vandaag" loopt niet meer achter op het getal: de actuele wachttijd staat nu als laatste stukje tot "nu" in de grafiek.'],
    en: ['The "Today so far" chart no longer lags behind the number: the current wait time is now the last part of the chart, up to "now".'],
  },
  {
    version: '0.10.0',
    date: '2026-11-21',
    changes: [
      'Mijn programma: met de knop "Gezien" verberg je afgestreepte attracties en shows. Onderaan staat dan "Afgestreept (aantal)"; tik daarop om ze weer te tonen. De keuze wordt onthouden.',
    ],
    en: [
      'My plan: the "Seen" button hides attractions and shows you marked as seen. "Seen (number)" then appears at the bottom; tap it to show them again. The choice is remembered.',
    ],
  },
  {
    version: '0.9.0',
    date: '2026-11-21',
    changes: [
      'Uitklappen van een attractie toont nu ook de wachttijd voor single riders, als de attractie een single-rider-rij heeft. Levert de bron geen tijd, dan staat er "geen wachttijd bekend".',
    ],
    en: [
      'Expanding an attraction now also shows the single rider wait time, if the attraction has a single rider queue. If the source gives no time, it says "no wait time known".',
    ],
  },
  {
    version: '0.8.0',
    date: '2026-11-21',
    changes: [
      'Mijn programma: veeg een rij naar links om hem af te strepen als gezien (met bevestiging). Nog eens naar links vegen maakt het ongedaan. Geldt voor vandaag en alleen op dit toestel.',
      'Mijn programma: veeg een rij naar rechts om te navigeren. Kies Apple Kaarten of Google Maps; de route is lopend.',
    ],
    en: [
      'My plan: swipe a row to the left to mark it as seen (with confirmation). Swiping left again undoes it. Applies to today and only on this device.',
      'My plan: swipe a row to the right to navigate. Choose Apple Maps or Google Maps; the route is on foot.',
    ],
  },
  {
    version: '0.7.1',
    date: '2026-11-21',
    changes: ['Mijn programma: de grote tijd en wachttijd stonden in 0.7.0 mogelijk verschoven. Hersteld.'],
    en: ['My plan: the large time and wait time could be misaligned in 0.7.0. Fixed.'],
  },
  {
    version: '0.7.0',
    date: '2026-11-21',
    changes: [
      'Mijn programma: shows inklappen met de knop "Shows" of door op de kop "Shows" te tikken. De keuze wordt onthouden.',
      'Instellingen: "Wat is er nieuw" met deze lijst.',
    ],
    en: [
      'My plan: collapse shows with the "Shows" button or by tapping the "Shows" heading. The choice is remembered.',
      'Settings: "What\'s new" with this list.',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-11-21',
    changes: [
      'Je locatie wordt één keer bepaald als je de app opent; daarna gaat de gps uit. Tik op ↻ om je locatie bij te werken.',
      'Instellingen: knop met het versienummer die zoekt naar een update en de app zo nodig bijwerkt.',
      'Storingspagina: los woord "null" bij een open park weggehaald.',
    ],
    en: [
      'Your location is determined once when you open the app; after that the GPS turns off. Tap ↻ to update your location.',
      'Settings: button with the version number that checks for an update and updates the app if needed.',
      'Breakdowns page: removed a stray word "null" when the park is open.',
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
    en: [
      'Breakdowns and refurbishments shown as a red exclamation mark and a grey wrench.',
      'Refresh button ↻ and more economical automatic refreshing.',
      'The app also starts without a connection.',
      'The chart shows breakdowns as a light red zone.',
      'The breakdowns tile flashes red when there are new breakdowns.',
    ],
  },
  {
    version: 'Eerder',
    changes: [
      'Live wachttijden, storingen, showtijden en afstanden voor Disneyland Park en Disney Adventure World.',
      'Mijn programma, detailvenster met dagverloop, koppelcode voor meerdere toestellen en simulatiestand.',
    ],
    en: [
      'Live wait times, breakdowns, showtimes and distances for Disneyland Park and Disney Adventure World.',
      'My plan, detail view with today\'s history, link code for multiple devices and simulation mode.',
    ],
  },
];

/** Wijzigingen in de huidige taal (Engels als vertaling ontbreekt en de taal geen Nederlands is). */
export const changesFor = (c: ChangelogEntry): string[] => (lang === 'nl' ? c.changes : c.en ?? c.changes);

/** "2026-11-21" → "21 nov 2026" / "21 Nov 2026". */
export function changelogDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat(t.locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d).replace('.', '');
}
