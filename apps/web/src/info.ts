/**
 * ThemeParks.wiki levert geen omschrijvingen, foto's of lengtematen. Deze teksten zijn zelf geschreven en worden
 * gekoppeld op (een deel van) de naam, zonder accenten en hoofdletters. Ze staan alleen in het detailvenster.
 * Lengtematen staan er alleen bij als ze uit een bron kwamen. Controleer altijd de borden bij de ingang.
 * Staat een attractie er niet tussen, dan toont de app geen tekst. Instellingen > "Kopieer lijst zonder omschrijving" laat zien welke dat zijn.
 */
export interface EntityInfoText {
  kind: string;
  text: string;
  /** Minimale lengte, bijvoorbeeld "102 cm" of "Geen minimum". Alleen invullen als bevestigd. */
  height?: string;
  tip?: string;
}

type Rule = [RegExp, string, string, { height?: string; tip?: string }?];

const RULES: Rule[] = [
  // Disneyland Park
  [/big thunder/, 'Achtbaan', 'Een wilde mijnwerkerstrein die door de rode rotsen van Frontierland raast. Het is een middelsnelle achtbaan met scherpe bochten en korte dalingen, dus spannend maar niet extreem. Het is een van de populairste attracties van het park.', { height: '102 cm', tip: 'Populair: kom vroeg of laat, of probeer single rider als dat beschikbaar is.' }],
  [/phantom manor/, 'Donkere rit', 'Een spookachtige rit door een verlaten herenhuis in de Wilde Westen-stijl. Je zit in een draaiend voertuig en ziet geesten en dansende spoken in de balzaal. Griezelig sfeervol, maar niet echt eng.', { height: 'Geen minimum' }],
  [/pirates (of the caribbean|des caraibes)/, 'Boottocht', 'Een rustige boottocht door grotten en langs piratenfeesten, kanonvuur en schatten. Onderweg zijn er twee kleine dalingen. Een van de best uitgewerkte attracties van het park.', { height: 'Geen minimum' }],
  [/indiana jones/, 'Achtbaan', 'Een snelle achtbaan door een oude tempel met een looping. De rit is kort en intens, met scherpe bochten.', { height: '140 cm', tip: 'De minimale lengte is hier hoger dan bij de meeste attracties.' }],
  [/peter pan/, 'Donkere rit', 'Je zweeft in een piratenschip door de lucht boven Londen naar Nooitgedachtland. Het is een zachte rit die bijzonder mooi is uitgevoerd. Een echte klassieker voor het hele gezin.', { height: 'Geen minimum', tip: 'Populair: de wachtrij is vaak lang. Vroeg of laat op de dag is het meestal rustiger.' }],
  [/small world/, 'Boottocht', 'Een rustige boottocht langs zingende poppen in kleurrijke decors uit de hele wereld. Een fijne rustpauze voor het hele gezin, en meestal met weinig wachttijd.', { height: 'Geen minimum' }],
  [/star tours/, 'Simulator', 'Een 3D-ruimtereis in een Star Wars-simulator. De route verandert per rit, dus een tweede keer is weer anders. De simulator beweegt flink en kan misselijk maken.', { height: '102 cm' }],
  [/space mountain|hyperspace|mission 2/, 'Achtbaan', 'Een snelle achtbaan in het donker, in het thema van Star Wars. Je wordt in een kanon met een knal omhoog geschoten, met looping en veel snelle bochten in de duisternis.', { height: '120 cm', tip: 'Single rider kan de wachttijd flink bekorten als je alleen of met een los groepje bent.' }],
  [/buzz lightyear/, 'Interactief', 'Een interactieve rit waarbij je met een laserkanon op doelen schiet om je score te verhogen. Je ruimtevoertuig draait vanzelf, dus mikken is het enige dat telt. Leuk voor jong en oud.', { height: 'Geen minimum', tip: 'Mik op de verborgen doelen: die leveren de meeste punten op.' }],
  [/orbitron/, 'Draairit', 'Een raketdraaimolen waarmee je zelf bepaalt hoe hoog je vliegt. Een rustige attractie met mooi uitzicht over het park.', { height: 'Geen minimum' }],
  [/autopia/, 'Familie', 'Je rijdt zelf in een klein autootje over een circuit. De wagens rijden over een rail en volgen de baan, dus het is veilig voor jonge chauffeurs.', { height: '81 cm met een volwassene, 132 cm om zelf te rijden' }],
  [/pinocchio|pinokkio/, 'Donkere rit', 'Een rustige donkere rit door het verhaal van Pinokkio, in een kleurrijk Italiaans dorp. Je ziet het poppenspel, de walvis en de Speelgoedwereld. Een goede keuze voor de kleinsten.', { height: 'Geen minimum' }],
  [/blanche.?neige|snow white/, 'Donkere rit', 'Een donkere rit door het sprookje van Sneeuwwitje. Het eerste deel is vrolijk, maar de heks verschijnt halverwege en kan voor jonge kinderen eng zijn.', { height: 'Geen minimum' }],
  [/dumbo/, 'Draairit', 'Je vliegt op een rondtollende olifant en kunt zelf bepalen hoe hoog je gaat. Rustig voor de allerkleinsten, maar de wachtrij loopt snel op.', { height: 'Geen minimum' }],
  [/casey jr|casey junior/, 'Kinderen', 'Een kleine achtbaan in de vorm van een trein, met veel plezier voor kleine kinderen maar zonder het eng te maken.', { height: 'Geen minimum' }],
  [/pays des contes|storybook/, 'Boottocht', 'Een rustige boottocht langs miniatuurversies van beroemde sprookjesdecors, zoals Aladdin, Alice en het dorp van Belle. Heel mooi uitgevoerd.', { height: 'Geen minimum' }],
  [/labyrinth|labyrinthe/, 'Wandeling', 'Een doolhof van Alice in Wonderland met de Hartenkoningin en het theekransje. Een leuke wandeling met uitzicht op het kasteel.', { height: 'Geen minimum' }],
  [/carrousel|carousel|lancelot/, 'Kinderen', 'Een sprookjesachtige draaimolen vlak bij het kasteel, met mooie paarden. Rustig en vaak snel aan de beurt.'],
  [/mad hatter|chapelier|tasses/, 'Draairit', 'Je draait in een theekopje, en hoe harder je aan het wiel draait, hoe sneller het gaat. Voor wie niet snel draaierig wordt.', { height: 'Geen minimum' }],
  [/railroad|chemin de fer/, 'Familie', 'Een stoomtrein die rond het park rijdt met haltes in meerdere gebieden. Handig om uit te rusten en onderweg het park te zien.'],
  [/robinson/, 'Wandeling', 'Een wandeling door de boomhut van de familie Robinson. Je klimt over bruggen en trappen en ziet hoe ze daar wonen.'],
  [/aladdin/, 'Wandeling', 'Een wandeling door scènes uit Aladdin, met de schat in de grot en de Sultan. Een rustige activiteit zonder wachtrij.'],
  [/riverboat|mississippi/, 'Boottocht', 'Een rondje over de rivier met een stoomraderboot, met uitzicht op Frontierland en Big Thunder Mountain.'],
  [/belle au bois|sleeping beauty|galerie|dragon/, 'Wandeling', 'Een wandeling door het kasteel van Doornroosje, met een kijkje bij de draak in de kelder. De draak beweegt en brult.'],
  [/nautilus/, 'Wandeling', 'Een wandeling door de onderzeeër uit het verhaal van Jules Verne, met de machinekamer en de reuzeninktvis.', { height: 'Geen minimum' }],
  [/tapis volants|flying carpets/, 'Draairit', 'Vliegende tapijten die rondtollen, waarbij je zelf bepaalt hoe hoog je gaat. Rustig en geschikt voor het hele gezin.', { height: 'Geen minimum' }],
  // Disney Adventure World (voorheen Walt Disney Studios Park)
  [/crush/, 'Achtbaan', 'Een draaiende achtbaan door de onderwaterwereld van Finding Nemo. Je zit in een schildpadschelp die ronddraait terwijl je langs de oceaanstroom raast.', { height: '107 cm' }],
  [/ratatouille|remy/, 'Donkere rit', 'Je wordt zo klein als Rémy en rent in 3D door de Parijse keuken, vol vrolijke scènes en grote voorwerpen. Een van de mooiste donkere ritten van het park, zonder schrikmomenten.', { height: 'Geen minimum', tip: 'Populair: de wachtrij is vaak lang. Check de wachttijd in de app voor het beste moment.' }],
  [/cars.*(rallye|quatre roues)/, 'Draairit', 'Draaiende autootjes in Radiator Springs. Je rijdt in een rondje terwijl de auto zelf een draai maakt.', { height: 'Geen minimum' }],
  [/cars road trip/, 'Familie', 'Een rustige tocht door het landschap van Cars, met uitzicht op Radiator Springs. Een rustige attractie voor het hele gezin.', { height: 'Geen minimum' }],
  [/rc racer/, 'Draairit', 'Je schommelt als speelgoedauto door een halfpipe, steeds hoger. Het lijkt wild maar het is geen achtbaan.', { height: '120 cm' }],
  [/parachute drop/, 'Draairit', 'Je zweeft omhoog met een speelgoedparachute en valt langzaam terug, met een mooi uitzicht over Toy Story Playland.', { height: '81 cm met een volwassene, 132 cm om alleen te gaan' }],
  [/slinky dog/, 'Draairit', 'Een draaiende attractie in de vorm van Slinky Dog. Ook voor de kleintjes en met weinig wachttijd.', { height: 'Geen minimum' }],
  [/tower of terror|twilight zone|hollywood tower/, 'Valtoren', 'Je valt in een lift door een spookachtig hotel. De opbouw is mooi uitgewerkt, met een Twilight Zone-verhaal. De vallen zijn onvoorspelbaar en snel.', { height: '102 cm' }],
  [/rock.?n.?roller|aerosmith/, 'Achtbaan', 'Een snelle lanceerachtbaan in het donker op rockmuziek, in de vorm van een limousine. De minimale lengte is niet bevestigd: kijk op het bord bij de ingang.'],
  [/flight force|avengers assemble/, 'Achtbaan', 'Een snelle lanceerachtbaan in het universum van de Avengers, met veel actie en snelle bochten in een grote hal.', { height: '120 cm' }],
  [/spider-?man|w\.?e\.?b\.? adventure/, 'Interactief', 'Schiet spinnenwebben op robots in dit interactieve avontuur met Spider-Man. Hoe nauwkeuriger je mikt, hoe hoger je score.', { height: 'Geen minimum' }],
  [/frozen ever after/, 'Boottocht', 'Je vaart door het koninkrijk Arendelle met Anna, Elsa en Olaf. De rit heeft mooie decors en bekende liedjes.', { height: 'Geen minimum (verwacht)' }],
  [/raiponce|tangled/, 'Draairit', 'Een draaiende attractie in het thema van Rapunzel. De minimale lengte is niet bevestigd: kijk op het bord bij de ingang.'],
  [/animation academy/, 'Workshop', 'Leer in een tekenles hoe je een Disney-personage tekent. Een rustige activiteit voor een rustpauze, meestal zonder lange wachttijd.', { height: 'Geen minimum' }],
  // Shows
  [/stunt|moteurs/, 'Show', 'Een stuntshow met auto\'s en motoren, vol snelheid en explosies. Je kijkt vanaf de tribune en ziet hoe de stunts gemaakt worden.'],
  [/cascade of lights/, 'Show', 'Een avondshow met lichten, muziek en personages. Je ziet het vanaf een vaste plek, dus kom op tijd voor een goede plaats.'],
  [/celebration in arendelle|arendelle/, 'Show', 'Een show met Anna, Elsa en Olaf, met bekende liedjes uit Frozen. Een goede keuze voor wie van sneeuw en meezingen houdt.'],
  [/cavalcade/, 'Show', 'Een optocht met Disney-prinsessen die door het park trekt. Zoek een plek langs de route en wacht even.'],
  [/doctor strange|mystery of the mystics/, 'Show', 'Een show in Avengers Campus met Doctor Strange, vol toverkunsten en vechtscènes. Een korte show met veel actie.'],
  [/imaginary orchestra/, 'Show', 'Een korte vrolijke show met Goofy en zijn orkest. Leuk voor kleine kinderen.'],
  [/parade/, 'Show', 'Een optocht met personages en wagens door het park. Zoek een plek langs de route en wacht even.'],
  [/illuminations/, 'Show', 'Een avondshow met projecties, vuurwerk en muziek bij het kasteel. Kom ruim op tijd voor een goede plek.'],
  [/frozen.*(sing|musical|invitation|chante)/, 'Show', 'Een meezingshow met liedjes uit Frozen.'],
  [/mickey/, 'Show', 'Een show met Mickey Mouse en vrienden.'],
];

export const normalizeName = (name: string): string =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function blurbFor(name: string): EntityInfoText | null {
  const n = normalizeName(name);
  for (const [re, kind, text, extra] of RULES) if (re.test(n)) return { kind, text, ...extra };
  return null;
}
