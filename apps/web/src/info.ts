import { lang } from './i18n';

/**
 * ThemeParks.wiki levert geen omschrijvingen, foto's of lengtematen. Deze teksten zijn zelf geschreven en worden
 * gekoppeld op (een deel van) de naam, zonder accenten en hoofdletters. Ze staan alleen in het detailvenster.
 * Lengtematen staan er alleen bij als ze uit een bron kwamen. Controleer altijd de borden bij de ingang.
 * Teksten en tips staan er in het Nederlands en Engels ([nl, en]); lengtematen worden vertaald in `heightText()`.
 * Staat een attractie er niet tussen, dan toont de app geen tekst. Instellingen > "Kopieer lijst zonder omschrijving" laat zien welke dat zijn.
 */
export interface EntityInfoText {
  /** Soort (Nederlandse sleutel, voor icoon en illustratie; weergave via kindName()). */
  kind: string;
  text: string;
  /** Minimale lengte, bijvoorbeeld "102 cm" of "Geen minimum". Alleen invullen als bevestigd. */
  height?: string;
  tip?: string;
  /** Themagebied in het park. */
  area?: string;
  /** Openingsjaar. */
  opened?: number;
}

type Text2 = [nl: string, en: string];
type Rule = [RegExp, string, Text2, { height?: string; tip?: Text2; area?: string; opened?: number }?];

const RULES: Rule[] = [
  // Disneyland Park
  [/big thunder/, 'Achtbaan', ['Een wilde mijnwerkerstrein die door de rode rotsen van Frontierland raast. Het is een middelsnelle achtbaan met scherpe bochten en korte dalingen, dus spannend maar niet extreem. Het is een van de populairste attracties van het park.', 'A wild mine train racing through the red rocks of Frontierland. It is a medium-speed roller coaster with sharp turns and short drops, so exciting but not extreme. It is one of the most popular attractions in the park.'], { height: '102 cm', tip: ['Populair: kom vroeg of laat, of probeer single rider als dat beschikbaar is.', 'Popular: come early or late, or try single rider if available.'] }],
  [/phantom manor/, 'Donkere rit', ['Een spookachtige rit door een verlaten herenhuis in de Wilde Westen-stijl. Je zit in een draaiend voertuig en ziet geesten en dansende spoken in de balzaal. Griezelig sfeervol, maar niet echt eng.', 'A spooky ride through an abandoned mansion in Wild West style. You sit in a rotating vehicle and see ghosts and dancing spirits in the ballroom. Atmospheric and eerie, but not really scary.'], { height: 'Geen minimum' }],
  [/pirates (of the caribbean|des caraibes)/, 'Boottocht', ['Een rustige boottocht door grotten en langs piratenfeesten, kanonvuur en schatten. Onderweg zijn er twee kleine dalingen. Een van de best uitgewerkte attracties van het park.', 'A calm boat ride through caves and past pirate parties, cannon fire and treasure. There are two small drops along the way. One of the most detailed attractions in the park.'], { height: 'Geen minimum' }],
  [/indiana jones/, 'Achtbaan', ['Een snelle achtbaan door een oude tempel met een looping. De rit is kort en intens, met scherpe bochten.', 'A fast roller coaster through an ancient temple, with a loop. The ride is short and intense, with sharp turns.'], { height: '140 cm', tip: ['De minimale lengte is hier hoger dan bij de meeste attracties.', 'The minimum height here is higher than at most attractions.'] }],
  [/peter pan/, 'Donkere rit', ['Je zweeft in een piratenschip door de lucht boven Londen naar Nooitgedachtland. Het is een zachte rit die bijzonder mooi is uitgevoerd. Een echte klassieker voor het hele gezin.', 'You float in a pirate ship through the sky above London to Never Land. A gentle ride that is beautifully made. A real classic for the whole family.'], { height: 'Geen minimum', tip: ['Populair: de wachtrij is vaak lang. Vroeg of laat op de dag is het meestal rustiger.', 'Popular: the queue is often long. Early or late in the day is usually quieter.'] }],
  [/small world/, 'Boottocht', ['Een rustige boottocht langs zingende poppen in kleurrijke decors uit de hele wereld. Een fijne rustpauze voor het hele gezin, en meestal met weinig wachttijd.', 'A calm boat ride past singing dolls in colourful scenes from all over the world. A nice break for the whole family, and usually with a short wait.'], { height: 'Geen minimum' }],
  [/star tours/, 'Simulator', ['Een 3D-ruimtereis in een Star Wars-simulator. De route verandert per rit, dus een tweede keer is weer anders. De simulator beweegt flink en kan misselijk maken.', 'A 3D space journey in a Star Wars simulator. The route changes every ride, so a second time is different again. The simulator moves a lot and can cause motion sickness.'], { height: '102 cm' }],
  [/space mountain|hyperspace|mission 2/, 'Achtbaan', ['Een snelle achtbaan in het donker, in het thema van Star Wars. Je wordt in een kanon met een knal omhoog geschoten, met looping en veel snelle bochten in de duisternis.', 'A fast roller coaster in the dark, themed to Star Wars. You are launched upwards from a cannon with a bang, with a loop and lots of fast turns in the darkness.'], { height: '120 cm', tip: ['Single rider kan de wachttijd flink bekorten als je alleen of met een los groepje bent.', 'Single rider can cut the wait considerably if you are alone or in a loose group.'] }],
  [/buzz lightyear/, 'Interactief', ['Een interactieve rit waarbij je met een laserkanon op doelen schiet om je score te verhogen. Je ruimtevoertuig draait vanzelf, dus mikken is het enige dat telt. Leuk voor jong en oud.', 'An interactive ride where you shoot targets with a laser cannon to raise your score. Your space vehicle turns by itself, so aiming is all that counts. Fun for young and old.'], { height: 'Geen minimum', tip: ['Mik op de verborgen doelen: die leveren de meeste punten op.', 'Aim for the hidden targets: they give the most points.'] }],
  [/orbitron/, 'Draairit', ['Een raketdraaimolen waarmee je zelf bepaalt hoe hoog je vliegt. Een rustige attractie met mooi uitzicht over het park.', 'A rocket carousel where you control how high you fly. A calm attraction with a nice view over the park.'], { height: 'Geen minimum' }],
  [/autopia/, 'Familie', ['Je rijdt zelf in een klein autootje over een circuit. De wagens rijden over een rail en volgen de baan, dus het is veilig voor jonge chauffeurs.', 'You drive a small car around a circuit yourself. The cars run on a rail and follow the track, so it is safe for young drivers.'], { height: '81 cm met een volwassene, 132 cm om zelf te rijden' }],
  [/pinocchio|pinokkio/, 'Donkere rit', ['Een rustige donkere rit door het verhaal van Pinokkio, in een kleurrijk Italiaans dorp. Je ziet het poppenspel, de walvis en de Speelgoedwereld. Een goede keuze voor de kleinsten.', 'A calm dark ride through the story of Pinocchio, in a colourful Italian village. You see the puppet show, the whale and Pleasure Island. A good choice for the little ones.'], { height: 'Geen minimum' }],
  [/blanche.?neige|snow white/, 'Donkere rit', ['Een donkere rit door het sprookje van Sneeuwwitje. Het eerste deel is vrolijk, maar de heks verschijnt halverwege en kan voor jonge kinderen eng zijn.', 'A dark ride through the fairy tale of Snow White. The first part is cheerful, but the witch appears halfway and can be scary for young children.'], { height: 'Geen minimum' }],
  [/dumbo/, 'Draairit', ['Je vliegt op een rondtollende olifant en kunt zelf bepalen hoe hoog je gaat. Rustig voor de allerkleinsten, maar de wachtrij loopt snel op.', 'You fly on a spinning elephant and control how high you go. Calm for the very young, but the queue builds up quickly.'], { height: 'Geen minimum' }],
  [/casey jr|casey junior/, 'Kinderen', ['Een kleine achtbaan in de vorm van een trein, met veel plezier voor kleine kinderen maar zonder het eng te maken.', 'A small roller coaster shaped like a train, lots of fun for young children without being scary.'], { height: 'Geen minimum' }],
  [/pays des contes|storybook/, 'Boottocht', ['Een rustige boottocht langs miniatuurversies van beroemde sprookjesdecors, zoals Aladdin, Alice en het dorp van Belle. Heel mooi uitgevoerd.', 'A calm boat ride past miniature versions of famous fairy-tale scenes, such as Aladdin, Alice and Belle\'s village. Beautifully made.'], { height: 'Geen minimum' }],
  [/labyrinth|labyrinthe/, 'Wandeling', ['Een doolhof van Alice in Wonderland met de Hartenkoningin en het theekransje. Een leuke wandeling met uitzicht op het kasteel.', 'An Alice in Wonderland maze with the Queen of Hearts and the tea party. A nice walk with a view of the castle.'], { height: 'Geen minimum' }],
  [/carrousel|carousel|lancelot/, 'Kinderen', ['Een sprookjesachtige draaimolen vlak bij het kasteel, met mooie paarden. Rustig en vaak snel aan de beurt.', 'A fairy-tale carousel close to the castle, with beautiful horses. Calm and often quick to board.']],
  [/mad hatter|chapelier|tasses/, 'Draairit', ['Je draait in een theekopje, en hoe harder je aan het wiel draait, hoe sneller het gaat. Voor wie niet snel draaierig wordt.', 'You spin in a teacup, and the harder you turn the wheel, the faster it goes. For those who don\'t get dizzy easily.'], { height: 'Geen minimum' }],
  [/railroad|chemin de fer/, 'Familie', ['Een stoomtrein die rond het park rijdt met haltes in meerdere gebieden. Handig om uit te rusten en onderweg het park te zien.', 'A steam train that runs around the park with stations in several lands. Handy for resting and seeing the park along the way.']],
  [/robinson/, 'Wandeling', ['Een wandeling door de boomhut van de familie Robinson. Je klimt over bruggen en trappen en ziet hoe ze daar wonen.', 'A walk through the Robinson family\'s treehouse. You climb over bridges and stairs and see how they live there.']],
  [/aladdin/, 'Wandeling', ['Een wandeling door scènes uit Aladdin, met de schat in de grot en de Sultan. Een rustige activiteit zonder wachtrij.', 'A walk through scenes from Aladdin, with the treasure in the cave and the Sultan. A calm activity without a queue.']],
  [/riverboat|mississippi/, 'Boottocht', ['Een rondje over de rivier met een stoomraderboot, met uitzicht op Frontierland en Big Thunder Mountain.', 'A trip on the river in a paddle steamer, with views of Frontierland and Big Thunder Mountain.']],
  [/belle au bois|sleeping beauty|galerie|dragon/, 'Wandeling', ['Een wandeling door het kasteel van Doornroosje, met een kijkje bij de draak in de kelder. De draak beweegt en brult.', 'A walk through Sleeping Beauty\'s castle, with a peek at the dragon in the dungeon. The dragon moves and roars.']],
  [/nautilus/, 'Wandeling', ['Een wandeling door de onderzeeër uit het verhaal van Jules Verne, met de machinekamer en de reuzeninktvis.', 'A walk through the submarine from the Jules Verne story, with the engine room and the giant squid.'], { height: 'Geen minimum' }],
  [/tapis volants|flying carpets/, 'Draairit', ['Vliegende tapijten die rondtollen, waarbij je zelf bepaalt hoe hoog je gaat. Rustig en geschikt voor het hele gezin.', 'Flying carpets that spin around, where you control how high you go. Calm and suitable for the whole family.'], { height: 'Geen minimum' }],
  // Disney Adventure World (voorheen Walt Disney Studios Park)
  [/crush/, 'Achtbaan', ['Een draaiende achtbaan door de onderwaterwereld van Finding Nemo. Je zit in een schildpadschelp die ronddraait terwijl je langs de oceaanstroom raast.', 'A spinning roller coaster through the underwater world of Finding Nemo. You sit in a turtle shell that spins while you race along the ocean current.'], { height: '107 cm' }],
  [/ratatouille|remy/, 'Donkere rit', ['Je wordt zo klein als Rémy en rent in 3D door de Parijse keuken, vol vrolijke scènes en grote voorwerpen. Een van de mooiste donkere ritten van het park, zonder schrikmomenten.', 'You shrink to the size of Rémy and run in 3D through a Parisian kitchen, full of cheerful scenes and huge objects. One of the best dark rides in the park, without scares.'], { height: 'Geen minimum', tip: ['Populair: de wachtrij is vaak lang. Check de wachttijd in de app voor het beste moment.', 'Popular: the queue is often long. Check the wait time in the app for the best moment.'] }],
  [/cars.*(rallye|quatre roues)/, 'Draairit', ['Draaiende autootjes in Radiator Springs. Je rijdt in een rondje terwijl de auto zelf een draai maakt.', 'Spinning cars in Radiator Springs. You drive in a circle while the car itself turns.'], { height: 'Geen minimum' }],
  [/cars road trip/, 'Familie', ['Een rustige tocht door het landschap van Cars, met uitzicht op Radiator Springs. Een rustige attractie voor het hele gezin.', 'A calm tour through the landscape of Cars, with views of Radiator Springs. A calm attraction for the whole family.'], { height: 'Geen minimum' }],
  [/rc racer/, 'Draairit', ['Je schommelt als speelgoedauto door een halfpipe, steeds hoger. Het lijkt wild maar het is geen achtbaan.', 'You swing as a toy car through a half-pipe, higher and higher. It looks wild but it is not a roller coaster.'], { height: '120 cm' }],
  [/parachute drop/, 'Draairit', ['Je zweeft omhoog met een speelgoedparachute en valt langzaam terug, met een mooi uitzicht over Toy Story Playland.', 'You float up on a toy parachute and slowly drop back down, with a nice view over Toy Story Playland.'], { height: '81 cm met een volwassene, 132 cm om alleen te gaan' }],
  [/slinky dog/, 'Draairit', ['Een draaiende attractie in de vorm van Slinky Dog. Ook voor de kleintjes en met weinig wachttijd.', 'A spinning ride shaped like Slinky Dog. Fine for little ones too, with a short wait.'], { height: 'Geen minimum' }],
  [/tower of terror|twilight zone|hollywood tower/, 'Valtoren', ['Je valt in een lift door een spookachtig hotel. De opbouw is mooi uitgewerkt, met een Twilight Zone-verhaal. De vallen zijn onvoorspelbaar en snel.', 'You drop in an elevator through a haunted hotel. The build-up is well made, with a Twilight Zone story. The drops are unpredictable and fast.'], { height: '102 cm' }],
  [/rock.?n.?roller|aerosmith/, 'Achtbaan', ['Een snelle lanceerachtbaan in het donker op rockmuziek, in de vorm van een limousine. De minimale lengte is niet bevestigd: kijk op het bord bij de ingang.', 'A fast launched roller coaster in the dark to rock music, in a limousine. The minimum height is not confirmed: check the sign at the entrance.']],
  [/flight force|avengers assemble/, 'Achtbaan', ['Een snelle lanceerachtbaan in het universum van de Avengers, met veel actie en snelle bochten in een grote hal.', 'A fast launched roller coaster in the Avengers universe, with lots of action and fast turns in a large hall.'], { height: '120 cm' }],
  [/spider-?man|w\.?e\.?b\.? adventure/, 'Interactief', ['Schiet spinnenwebben op robots in dit interactieve avontuur met Spider-Man. Hoe nauwkeuriger je mikt, hoe hoger je score.', 'Shoot webs at robots in this interactive adventure with Spider-Man. The more accurately you aim, the higher your score.'], { height: 'Geen minimum' }],
  [/frozen ever after/, 'Boottocht', ['Je vaart door het koninkrijk Arendelle met Anna, Elsa en Olaf. De rit heeft mooie decors en bekende liedjes.', 'You sail through the kingdom of Arendelle with Anna, Elsa and Olaf. The ride has beautiful sets and familiar songs.'], { height: 'Geen minimum (verwacht)' }],
  [/raiponce|tangled/, 'Draairit', ['Een draaiende attractie in het thema van Rapunzel. De minimale lengte is niet bevestigd: kijk op het bord bij de ingang.', 'A spinning ride themed to Rapunzel. The minimum height is not confirmed: check the sign at the entrance.']],
  [/animation academy/, 'Workshop', ['Leer in een tekenles hoe je een Disney-personage tekent. Een rustige activiteit voor een rustpauze, meestal zonder lange wachttijd.', 'Learn how to draw a Disney character in a drawing class. A calm activity for a break, usually without a long wait.'], { height: 'Geen minimum' }],
  // Shows
  [/stunt|moteurs/, 'Show', ['Een stuntshow met auto\'s en motoren, vol snelheid en explosies. Je kijkt vanaf de tribune en ziet hoe de stunts gemaakt worden.', 'A stunt show with cars and motorbikes, full of speed and explosions. You watch from the stands and see how the stunts are made.']],
  [/cascade of lights/, 'Show', ['Een avondshow met lichten, muziek en personages. Je ziet het vanaf een vaste plek, dus kom op tijd voor een goede plaats.', 'An evening show with lights, music and characters. You watch it from a fixed spot, so come early for a good place.']],
  [/celebration in arendelle|arendelle/, 'Show', ['Een show met Anna, Elsa en Olaf, met bekende liedjes uit Frozen. Een goede keuze voor wie van sneeuw en meezingen houdt.', 'A show with Anna, Elsa and Olaf, with familiar songs from Frozen. A good choice for anyone who loves snow and singing along.']],
  [/cavalcade/, 'Show', ['Een optocht met Disney-prinsessen die door het park trekt. Zoek een plek langs de route en wacht even.', 'A procession of Disney princesses moving through the park. Find a spot along the route and wait a little.']],
  [/doctor strange|mystery of the mystics/, 'Show', ['Een show in Avengers Campus met Doctor Strange, vol toverkunsten en vechtscènes. Een korte show met veel actie.', 'A show in Avengers Campus with Doctor Strange, full of magic and fight scenes. A short show with lots of action.']],
  [/imaginary orchestra/, 'Show', ['Een korte vrolijke show met Goofy en zijn orkest. Leuk voor kleine kinderen.', 'A short, cheerful show with Goofy and his orchestra. Fun for young children.']],
  [/lion king|rhythms of the pride/, 'Show', ['Een muzikale show in het Frontierland Theater met zang, dans, acrobatiek en poppen, gebaseerd op The Lion King. Het zijn de grote nummers uit de film, live gebracht. Kom op tijd voor een goede plek.', 'A musical show in the Frontierland Theater with singing, dancing, acrobatics and puppets, based on The Lion King. The big songs from the film, performed live. Come early for a good spot.']],
  [/mickey and the magician/, 'Show', ['Een theatershow in Toon Studio met Mickey Mouse als goochelaar. Muziek, dans en veel Disney-personages in één voorstelling.', 'A theatre show in Toon Studio with Mickey Mouse as a magician. Music, dance and lots of Disney characters in one performance.']],
  [/stitch live/, 'Show', ['Een interactieve show met Stitch op een scherm, die live met het publiek praat en grappen maakt. Kinderen kunnen zelf meedoen.', 'An interactive show with Stitch on a screen, talking live with the audience and making jokes. Children can take part themselves.']],
  [/stars on parade/, 'Show', ['De dagelijkse parade over Main Street, U.S.A. met Disney-personages op wagens en te voet. Zoek op tijd een plek langs de route.', 'The daily parade along Main Street, U.S.A. with Disney characters on floats and on foot. Find a spot along the route in time.']],
  [/parade/, 'Show', ['Een optocht met personages en wagens door het park. Zoek een plek langs de route en wacht even.', 'A procession of characters and floats through the park. Find a spot along the route and wait a little.']],
  [/illuminations/, 'Show', ['Een avondshow met projecties, vuurwerk en muziek bij het kasteel. Kom ruim op tijd voor een goede plek.', 'An evening show with projections, fireworks and music at the castle. Come well in advance for a good spot.']],
  [/frozen.*(sing|musical|invitation|chante)/, 'Show', ['Een meezingshow met liedjes uit Frozen.', 'A sing-along show with songs from Frozen.']],
  [/mickey/, 'Show', ['Een show met Mickey Mouse en vrienden.', 'A show with Mickey Mouse and friends.']],
];

/** Gebied (volgens demagieexpert.nl) en openingsjaar (alleen waar zeker). Gekoppeld op dezelfde naam-patronen. */
const FACTS: [RegExp, string, number?][] = [
  [/big thunder/, 'Frontierland', 1992], [/phantom manor/, 'Frontierland', 1992], [/riverboat|mississippi/, 'Frontierland'],
  [/pirates (of the caribbean|des caraibes)/, 'Adventureland', 1992], [/indiana jones/, 'Adventureland', 1993],
  [/robinson/, 'Adventureland'], [/aladdin/, 'Adventureland'],
  [/small world/, 'Fantasyland', 1992], [/peter pan/, 'Fantasyland', 1992], [/dumbo/, 'Fantasyland', 1992], [/mad hatter|chapelier|tasses/, 'Fantasyland', 1992],
  [/carrousel|carousel|lancelot/, 'Fantasyland', 1992], [/pinocchio|pinokkio/, 'Fantasyland', 1992], [/blanche.?neige|snow white/, 'Fantasyland', 1992],
  [/labyrinth|labyrinthe/, 'Fantasyland', 1992], [/belle au bois|sleeping beauty|galerie|dragon/, 'Fantasyland', 1992], [/casey jr|casey junior/, 'Fantasyland', 1992], [/pays des contes|storybook/, 'Fantasyland', 1994],
  [/space mountain|hyperspace|mission 2/, 'Discoveryland', 1995], [/star tours/, 'Discoveryland', 1992], [/buzz lightyear/, 'Discoveryland'],
  [/autopia/, 'Discoveryland', 1992], [/orbitron/, 'Discoveryland', 1992], [/nautilus/, 'Discoveryland', 1992],
  [/tower of terror|twilight zone|hollywood tower/, 'Production Courtyard', 2007], [/stitch live/, 'Production Courtyard'],
  [/tapis volants|flying carpets/, 'Toon Studio', 2002], [/mickey and the magician/, 'Toon Studio'], [/frozen.*(musical|sing|invitation)/, 'Toon Studio'],
  [/crush/, 'Worlds of Pixar', 2007], [/rc racer/, 'Worlds of Pixar', 2010], [/parachute drop/, 'Worlds of Pixar', 2010],
  [/cars road trip/, 'Worlds of Pixar'], [/ratatouille|remy/, 'Worlds of Pixar', 2014], [/slinky dog/, 'Worlds of Pixar', 2010], [/cars.*(rallye|quatre roues)/, 'Worlds of Pixar', 2007],
  [/spider-?man|w\.?e\.?b\.? adventure/, 'Marvel Avengers Campus', 2022], [/flight force|avengers assemble/, 'Marvel Avengers Campus', 2022], [/doctor strange|mystery of the mystics/, 'Marvel Avengers Campus'],
  [/lion king|rhythms of the pride/, 'Frontierland'], [/stars on parade/, 'Main Street, U.S.A.'],
];

export const normalizeName = (name: string): string =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function blurbFor(name: string): EntityInfoText | null {
  const n = normalizeName(name);
  for (const [re, kind, text, extra] of RULES) {
    if (!re.test(n)) continue;
    const fact = FACTS.find(([fre]) => fre.test(n));
    const pickText = (x: Text2): string => (lang === 'nl' ? x[0] : x[1]);
    return {
      kind, text: pickText(text),
      ...(extra?.height ? { height: heightText(extra.height) } : {}),
      ...(extra?.tip ? { tip: pickText(extra.tip) } : {}),
      ...(fact ? { area: fact[1], ...(fact[2] ? { opened: fact[2] } : {}) } : {}),
    };
  }
  return null;
}

/** Lengtematen staan in het Nederlands; hier de vertaling van de vaste zinsdelen. */
function heightText(nlText: string): string {
  if (lang === 'nl') return nlText;
  return nlText
    .replace('Geen minimum (verwacht)', 'No minimum (expected)')
    .replace('Geen minimum', 'No minimum')
    .replace(' met een volwassene', ' with an adult')
    .replace(' om zelf te rijden', ' to drive alone')
    .replace(' om alleen te gaan', ' to ride alone');
}
