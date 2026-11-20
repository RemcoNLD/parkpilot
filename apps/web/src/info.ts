/**
 * ThemeParks.wiki levert geen omschrijvingen, foto's of lengtematen. Deze korte teksten zijn zelf geschreven en
 * worden gekoppeld op (een deel van) de naam, zonder accenten en hoofdletters. Staat een attractie er niet tussen,
 * dan toont de app geen tekst. Instellingen > "Kopieer lijst zonder omschrijving" laat zien welke dat zijn.
 */
export interface EntityBlurb {
  kind: string;
  text: string;
}

const RULES: [RegExp, string, string][] = [
  // Disneyland Park
  [/big thunder/, 'Achtbaan', 'Wilde mijnwerkerstrein die door een rotsberg in het Wilde Westen raast.'],
  [/phantom manor/, 'Donkere rit', 'Spookachtige rit door een verlaten herenhuis vol geesten.'],
  [/pirates (of the caribbean|des caraibes)/, 'Boottocht', 'Rustige boottocht langs piratengevechten, schatten en kanonvuur.'],
  [/indiana jones/, 'Achtbaan', 'Wilde achtbaan door een oude tempel, met een looping.'],
  [/peter pan/, 'Donkere rit', 'Zweef in een piratenschip boven Londen en Nooitgedachtland.'],
  [/small world/, 'Boottocht', 'Rustige boottocht langs zingende poppen uit de hele wereld.'],
  [/star tours/, 'Simulator', '3D-ruimtereis in een Star Wars-simulator.'],
  [/space mountain|hyperspace|mission 2/, 'Achtbaan', 'Snelle achtbaan in het donker: je wordt het heelal in geschoten.'],
  [/buzz lightyear/, 'Interactief', 'Schiet met laserkanonnen op doelen en probeer de hoogste score te halen.'],
  [/orbitron/, 'Draairit', 'Vlieg in een raket en bepaal zelf hoe hoog je gaat.'],
  [/autopia/, 'Familie', 'Rijd zelf in een autootje over een circuit.'],
  [/pinocchio|pinokkio/, 'Donkere rit', 'Rustige donkere rit door het verhaal van Pinokkio.'],
  [/blanche.?neige|snow white/, 'Donkere rit', 'Donkere rit door het sprookje van Sneeuwwitje en de zeven dwergen.'],
  [/dumbo/, 'Draairit', 'Vlieg op een rondtollende olifant en bepaal zelf hoe hoog.'],
  [/casey jr|casey junior/, 'Kinderen', 'Kleine achtbaan voor de allerkleinsten.'],
  [/pays des contes|storybook/, 'Boottocht', 'Vaar langs miniatuurversies van beroemde sprookjesdecors.'],
  [/labyrinth|labyrinthe/, 'Wandeling', 'Dwaal door het doolhof van de Hartenkoningin.'],
  [/carrousel|carousel|lancelot/, 'Kinderen', 'Sprookjesachtige draaimolen vlak bij het kasteel.'],
  [/mad hatter|chapelier|tasses/, 'Draairit', 'Draai in een theekopje: hoe harder je aan het wiel draait, hoe sneller het gaat.'],
  [/railroad|chemin de fer/, 'Familie', 'Stoomtrein rond het park met haltes in meerdere gebieden.'],
  [/robinson/, 'Wandeling', 'Klim door de boomhut van de familie Robinson.'],
  [/aladdin/, 'Wandeling', 'Wandeling door scènes uit Aladdin.'],
  [/riverboat|mississippi/, 'Boottocht', 'Rondje over de rivier met een stoomraderboot.'],
  [/belle au bois|sleeping beauty|galerie|dragon/, 'Wandeling', 'Wandel door het kasteel en kijk bij de draak in de kelder.'],
  [/nautilus/, 'Wandeling', 'Wandel door de onderzeeër uit het verhaal van Jules Verne.'],
  [/tapis volants|flying carpets/, 'Draairit', 'Vliegende tapijten die rondtollen, waarbij je zelf bepaalt hoe hoog je gaat.'],
  // Disney Adventure World (voorheen Walt Disney Studios Park)
  [/crush/, 'Achtbaan', 'Draaiende achtbaan door de onderwaterwereld van Finding Nemo.'],
  [/ratatouille|remy/, 'Donkere rit', 'Word zo klein als Rémy en ren in 3D door de Parijse keuken.'],
  [/cars.*(rallye|quatre roues)/, 'Draairit', 'Draaiende autootjes in Radiator Springs.'],
  [/cars road trip/, 'Familie', 'Rustige tocht door het landschap van Cars.'],
  [/rc racer/, 'Draairit', 'Schommel als speelgoedauto door een halfpipe.'],
  [/parachute drop/, 'Draairit', 'Zweef omhoog en val terug met een speelgoedparachute.'],
  [/slinky dog/, 'Draairit', 'Draaiende attractie met Slinky Dog, ook voor de kleintjes.'],
  [/tower of terror|twilight zone|hollywood tower/, 'Valtoren', 'Val in een lift door een spookachtig hotel.'],
  [/rock.?n.?roller|aerosmith/, 'Achtbaan', 'Snelle lanceerachtbaan in het donker, op rockmuziek.'],
  [/flight force|avengers assemble/, 'Achtbaan', 'Snelle lanceerachtbaan in het universum van de Avengers.'],
  [/spider-?man|w\.?e\.?b\.? adventure/, 'Interactief', 'Schiet spinnenwebben op robots in dit interactieve avontuur met Spider-Man.'],
  [/frozen ever after/, 'Boottocht', 'Vaar door het koninkrijk Arendelle met Anna, Elsa en Olaf.'],
  [/raiponce|tangled/, 'Draairit', 'Draaiende attractie in het thema van Rapunzel.'],
  // Shows
  [/stunt|moteurs/, 'Show', 'Stuntshow met auto\'s en motoren.'],
  [/parade/, 'Show', 'Optocht met personages en wagens door het park.'],
  [/illuminations/, 'Show', 'Avondshow met projecties, vuurwerk en muziek bij het kasteel.'],
  [/frozen.*(sing|musical|invitation|chante)/, 'Show', 'Meezingshow met liedjes uit Frozen.'],
  [/mickey/, 'Show', 'Show met Mickey Mouse en vrienden.'],
];

export const normalizeName = (name: string): string =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function blurbFor(name: string): EntityBlurb | null {
  const n = normalizeName(name);
  for (const [re, kind, text] of RULES) if (re.test(n)) return { kind, text };
  return null;
}
