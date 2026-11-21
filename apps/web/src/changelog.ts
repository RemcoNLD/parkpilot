import { lang, t } from './i18n';

/**
 * Wat er per versie is veranderd. Nieuwste bovenaan. Bij elke nieuwe versie hier een regel toevoegen,
 * in het Nederlands (`changes`), het Engels (`en`) én het Portugees (`pt`). Datum als JJJJ-MM-DD; de app toont hem in de gekozen taal.
 */
export interface ChangelogEntry { version: string; date?: string; changes: string[]; en?: string[]; pt?: string[] }

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.19.0',
    date: '2026-11-21',
    changes: [
      'Geeft de bron meer dan 30 minuten geen update over een attractie, dan wordt de wachttijd grijs in Alles en Mijn dag, en is dat stuk van de grafiek grijs. Komt er weer een update, dan komt de kleur terug. Grijze getallen tellen niet mee in gemiddelde en kortste wachttijd.',
      'Rondleiding met schermafbeeldingen bij elke stap, een stap over grijze getallen, en "menu" in plaats van "tandwiel". De menuknop rechtsboven heeft nu drie streepjes.',
      'Koppelcode: waarschuwing bij een zelfgekozen code (iedereen die hem kent, kan je lijstje aanpassen) en bij een sterke code dat je hem maar één keer ziet, met de kopieerknop er direct naast.',
    ],
    en: [
      'If the source gives no update about an attraction for more than 30 minutes, the wait turns grey in All and My day, and that stretch of the chart is grey. When an update arrives, the colour comes back. Grey numbers are left out of the average and shortest wait.',
      'Tour with a screenshot for every step, a step about grey numbers, and "menu" instead of "gear". The menu button at the top right now has three lines.',
      'Link code: a warning for a code you choose yourself (anyone who knows it can change your list) and, for a strong code, that you see it only once, with the copy button right next to it.',
    ],
    pt: [
      'Se a fonte não atualizar uma atração durante mais de 30 minutos, o tempo de espera fica cinzento em Tudo e O meu dia, e esse troço do gráfico fica cinzento. Quando chega uma atualização, a cor volta. Os números cinzentos não contam para a média nem para a espera mínima.',
      'Visita guiada com uma imagem em cada passo, um passo sobre números cinzentos, e "menu" em vez de "roda dentada". O botão de menu no canto superior direito tem agora três riscas.',
      'Código de ligação: aviso para um código escolhido por si (quem o souber pode alterar a sua lista) e, para um código forte, que só o vê uma vez, com o botão de copiar logo ao lado.',
    ],
  },
  {
    version: '0.18.1',
    date: '2026-11-21',
    changes: ['Grafiek vernieuwd: loopt van opening tot sluiting. De stippellijn van vorige weken loopt door de hele dag, het verloop van vandaag vult zich van links tot nu. Geen hulplijnen meer; de schaal past zich aan de stippellijn aan, en hoger als vandaag erboven uitkomt.'],
    en: ['Chart redesigned: it runs from opening to closing time. The dotted line from previous weeks covers the whole day; today fills in from the left up to now. No more guide lines; the scale fits the dotted line, or higher if today goes above it.'],
    pt: ['Gráfico renovado: vai da abertura ao fecho. A linha pontilhada das semanas anteriores cobre o dia inteiro; o dia de hoje preenche-se da esquerda até agora. Sem linhas de referência; a escala ajusta-se à linha pontilhada, ou mais alta se hoje a ultrapassar.'],
  },
  {
    version: '0.18.0',
    date: '2026-11-21',
    changes: [
      'Rondleiding voor nieuwe gebruikers: de belangrijkste functies in een paar stappen, en uitleg over de koppelcode met de vraag wat je wilt (al een code, een sterke code laten maken, zelf kiezen of nu niet).',
      'Help: de knop rechtsboven is nu een menu met Instellingen, Help en Rondleiding.',
      'Grafiek: een stippellijn toont de wachttijd van dezelfde weekdag in de vorige weken (gemiddeld, tot vier weken). Het verloop wordt daarvoor 29 dagen bewaard in plaats van 7, dus de lijn vult zich de komende weken.',
    ],
    en: [
      'A tour for new users: the main features in a few steps, plus an explanation of the link code and the question what you want (already have a code, make a strong code, choose your own, or not now).',
      'Help: the button at the top right is now a menu with Settings, Help and Tour.',
      'Chart: a dotted line shows the wait on the same weekday in previous weeks (average, up to four weeks). History is now kept for 29 days instead of 7, so the line fills in over the coming weeks.',
    ],
    pt: [
      'Visita guiada para novos utilizadores: as principais funções em poucos passos, e uma explicação do código de ligação com a pergunta sobre o que pretende (já tem um código, criar um código forte, escolher o seu, ou agora não).',
      'Ajuda: o botão no canto superior direito é agora um menu com Definições, Ajuda e Visita guiada.',
      'Gráfico: uma linha pontilhada mostra a espera no mesmo dia da semana nas semanas anteriores (média, até quatro semanas). O histórico é agora guardado 29 dias em vez de 7, por isso a linha vai-se completando nas próximas semanas.',
    ],
  },
  {
    version: '0.17.3',
    date: '2026-11-21',
    changes: ['De knop Volgen in het detailvenster reageert nu over de hele breedte, en het hartje wisselt meteen.'],
    en: ['The Follow button in the details panel now responds across its full width, and the heart changes straight away.'],
    pt: ['O botão Seguir no painel de detalhes responde agora em toda a largura, e o coração muda logo.'],
  },
  {
    version: '0.17.2',
    date: '2026-11-21',
    changes: ['Na "Eruit" kun je de attractie meteen afstrepen als gezien, vanuit dezelfde melding met je wachttijd.'],
    en: ['After "Done" you can mark the attraction as seen straight away, from the same message that shows your wait.'],
    pt: ['Depois de "Saí" pode marcar logo a atração como vista, na mesma mensagem que mostra a sua espera.'],
  },
  {
    version: '0.17.1',
    date: '2026-11-21',
    changes: ['Bij de vraag om te spelen na het inchecken staat nu "Niet meer vragen". Weer aanzetten: Instellingen > Spelletje > Vragen.'],
    en: ['The question to play after checking in now has "Don\'t ask again". To turn it back on: Settings > Game > Ask.'],
    pt: ['A pergunta para jogar depois de entrar na fila tem agora "Não perguntar mais". Para voltar a ativar: Definições > Jogo > Perguntar.'],
  },
  {
    version: '0.17.0',
    date: '2026-11-21',
    changes: [
      'Spelletje tijdens het wachten: na het inchecken in een rij vraagt de app of je Ballonvlucht wilt spelen. Tik om op te stijgen en vlieg tussen de torens door. Bovenin lopen je wachttijd en de knop "Aan de beurt" mee.',
      'Hiscores: geef je naam op en kom in de lijst met iedereen die ParkPilot gebruikt. Zonder bereik wordt je record later opgeslagen. Later spelen kan via een tik op de balk onderin.',
    ],
    en: [
      'A game while you wait: after checking in to a queue, the app asks if you want to play Balloon Flight. Tap to rise and fly between the towers. Your queue time and the "My turn" button stay at the top.',
      'High scores: enter your name and join the list with everyone who uses ParkPilot. Without a connection your best score is saved later. To play later, tap the bar at the bottom.',
    ],
    pt: [
      'Um jogo enquanto espera: depois de entrar numa fila, a app pergunta se quer jogar Voo de Balão. Toque para subir e voe entre as torres. O tempo na fila e o botão "A minha vez" ficam em cima.',
      'Melhores pontuações: indique o seu nome e entre na lista com todos os que usam o ParkPilot. Sem ligação, o seu recorde é guardado mais tarde. Para jogar mais tarde, toque na barra em baixo.',
    ],
  },
  {
    version: '0.16.0',
    date: '2026-11-21',
    changes: ['De app is nu ook in het Portugees. Instellingen > Weergave > Taal: Auto, NL, EN of PT. Auto kiest Portugees als dat de taal van je telefoon is.'],
    en: ['The app is now also available in Portuguese. Settings > Display > Language: Auto, NL, EN or PT. Auto chooses Portuguese if that is your phone\'s language.'],
    pt: ['A app está agora também disponível em português. Definições > Aspeto > Idioma: Auto, NL, EN ou PT. Auto escolhe português se for o idioma do seu telemóvel.'],
  },
  {
    version: '0.15.0',
    date: '2026-11-21',
    changes: [
      'Inchecken in de rij: houd een attractie even ingedrukt en kies de gewone rij of single rider. Onderin loopt de tijd mee, met de verwachte wachttijd en hoeveel er nog over is.',
      'Tik op "Aan de beurt" en daarna "Eruit". Je ziet dan hoe lang je echt wachtte vergeleken met de verwachting. Je ritten van vandaag staan in het detailvenster.',
    ],
    en: [
      'Queue check-in: press and hold an attraction and choose the standby or single rider queue. A timer runs at the bottom, with the expected wait and how much is left.',
      'Tap "My turn" and then "Done". You then see how long you actually waited compared with the estimate. Your rides of today are shown in the details panel.',
    ],
    pt: [
      'Entrar na fila: mantenha uma atração premida e escolha a fila normal ou single rider. Em baixo corre um cronómetro, com a espera prevista e quanto falta.',
      'Toque em "A minha vez" e depois em "Saí". Vê então quanto tempo esperou realmente em comparação com a previsão. As suas atrações de hoje aparecem no painel de detalhes.',
    ],
  },
  {
    version: '0.14.1',
    date: '2026-11-21',
    changes: ['Schakelaar Alles | Mijn dag met icoontjes en meer diepte. Daaronder in beide schermen het park met een eigen icoontje in de parkkleur, even hoog als de schakelaar.'],
    en: ['All | My day toggle with icons and more depth. Below it, on both screens, the park with its own icon in the park colour, the same height as the toggle.'],
    pt: ['Seletor Tudo | O meu dia com ícones e mais profundidade. Por baixo, nos dois ecrãs, o parque com o seu próprio ícone na cor do parque, à mesma altura do seletor.'],
  },
  {
    version: '0.14.0',
    date: '2026-11-21',
    changes: [
      'Overzicht heet nu "Alles" en Mijn programma heet "Mijn dag". Wisselen doe je met de kleine schakelaar linksboven, die in beide schermen op dezelfde plek staat.',
      'Parkknoppen, tabbladen en sorteerknoppen zijn kleiner en compacter.',
    ],
    en: [
      'Overview is now called "All" and My plan is now "My day". Switch with the small toggle at the top left, which is in the same place on both screens.',
      'Park buttons, tabs and sort buttons are smaller and more compact.',
    ],
    pt: [
      'A Vista geral chama-se agora "Tudo" e O meu programa chama-se "O meu dia". Muda com o pequeno seletor no canto superior esquerdo, que está no mesmo sítio nos dois ecrãs.',
      'Os botões dos parques, os separadores e os botões de ordenação estão mais pequenos e compactos.',
    ],
  },
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
    pt: [
      'A app está agora também disponível em inglês. Por omissão, o ParkPilot segue o idioma do telemóvel; se esse idioma não existir, usa inglês. Isto é verificado sempre que a app abre.',
      'Definições > Aspeto > Idioma: escolha Auto, NL ou EN.',
    ],
  },
  {
    version: '0.12.2',
    date: '2026-11-21',
    changes: ['Verloop vandaag wordt op je telefoon bewaard. Bij slecht bereik zie je het laatst opgehaalde verloop met een grijze achtergrond en het tijdstip; zodra er weer bereik is, wordt het vanzelf bijgewerkt.'],
    en: ['Today\'s wait time history is stored on your phone. With poor reception you see the last history fetched, with a grey background and the time; as soon as you have reception again, it updates automatically.'],
    pt: ['O histórico de tempos de espera de hoje fica guardado no telemóvel. Com pouca rede vê o último histórico obtido, com fundo cinzento e a hora; assim que tiver rede outra vez, atualiza-se sozinho.'],
  },
  {
    version: '0.12.1',
    date: '2026-11-21',
    changes: ['Instellingen compacter: één regel per instelling in groepen, uitleg achter de (i), koppelcode en "Wat is er nieuw" inklapbaar.'],
    en: ['More compact settings: one line per setting in groups, explanations behind the (i), link code and "What\'s new" collapsible.'],
    pt: ['Definições mais compactas: uma linha por definição em grupos, explicações atrás do (i), código de ligação e "Novidades" recolhíveis.'],
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
    pt: [
      'Guardar um ponto de observação: mantenha premido um espetáculo sem localização enquanto está no melhor sítio. A app mede a sua localização, mostra a precisão do GPS e pede confirmação.',
      'O ponto de observação aplica-se a todos os utilizadores. Se já existir um ponto, vê a precisão de ambos e escolhe substituir ou remover.',
    ],
  },
  {
    version: '0.11.5',
    date: '2026-11-21',
    changes: ['Mijn programma: het verschil (▲/▼) staat nu rechts van de wachttijd, onder het single-rider-getal. Daardoor meer ruimte voor de naam.'],
    en: ['My plan: the difference (▲/▼) is now to the right of the wait time, below the single rider number. This leaves more room for the name.'],
    pt: ['O meu programa: a diferença (▲/▼) está agora à direita do tempo de espera, por baixo do número single rider. Assim sobra mais espaço para o nome.'],
  },
  {
    version: '0.11.4',
    date: '2026-11-21',
    changes: ['Mijn programma: wachttijden groter, en het single-rider-getal in een wit badge (getal in de kleur van het niveau).'],
    en: ['My plan: larger wait times, and the single rider number in a white badge (number in the colour of the level).'],
    pt: ['O meu programa: tempos de espera maiores, e o número single rider num distintivo branco (número na cor do nível).'],
  },
  {
    version: '0.11.3',
    date: '2026-11-21',
    changes: ['Mijn programma: alle grote wachttijden en pijltjes staan nu recht onder elkaar, ook als er bij sommige attracties een single-rider-getal staat.'],
    en: ['My plan: all large wait times and arrows now line up vertically, even when some attractions show a single rider number.'],
    pt: ['O meu programa: todos os tempos de espera grandes e as setas ficam agora alinhados na vertical, mesmo quando algumas atrações mostram um número single rider.'],
  },
  {
    version: '0.11.2',
    date: '2026-11-21',
    changes: ['Mijn programma: het single-rider-getal staat nu klein rechtsboven de wachttijd, en het pijltje met het verschil staat op één lijn met de wachttijd.'],
    en: ['My plan: the single rider number is now small at the top right of the wait time, and the arrow with the difference is in line with the wait time.'],
    pt: ['O meu programa: o número single rider aparece agora pequeno no canto superior direito do tempo de espera, e a seta com a diferença fica alinhada com o tempo de espera.'],
  },
  {
    version: '0.11.1',
    date: '2026-11-21',
    changes: ['Mijn programma: het single-rider-getal staat strakker onder de wachttijd.'],
    en: ['My plan: the single rider number sits closer below the wait time.'],
    pt: ['O meu programa: o número single rider fica mais junto, por baixo do tempo de espera.'],
  },
  {
    version: '0.11.0',
    date: '2026-11-21',
    changes: ['Mijn programma: de single-rider-wachttijd staat klein onder de gewone wachttijd, als de bron er een geeft.'],
    en: ['My plan: the single rider wait time is shown small below the regular wait time, if the source provides one.'],
    pt: ['O meu programa: o tempo de espera single rider aparece pequeno por baixo do tempo de espera normal, se a fonte o fornecer.'],
  },
  {
    version: '0.10.1',
    date: '2026-11-21',
    changes: ['Grafiek "Verloop vandaag" loopt niet meer achter op het getal: de actuele wachttijd staat nu als laatste stukje tot "nu" in de grafiek.'],
    en: ['The "Today so far" chart no longer lags behind the number: the current wait time is now the last part of the chart, up to "now".'],
    pt: ['O gráfico "Hoje até agora" já não fica atrasado em relação ao número: o tempo de espera atual é agora a última parte do gráfico, até "agora".'],
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
    pt: ['O meu programa: o botão "Vistos" oculta as atrações e espetáculos que marcou como vistos. Aparece então "Vistos (número)" em baixo; toque para os mostrar de novo. A escolha fica memorizada.'],
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
    pt: ['Ao expandir uma atração vê agora também o tempo de espera single rider, se a atração tiver essa fila. Se a fonte não der tempo, aparece "tempo de espera desconhecido".'],
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
    pt: [
      'O meu programa: deslize uma linha para a esquerda para a marcar como vista (com confirmação). Deslizar outra vez para a esquerda anula. Vale para hoje e só neste dispositivo.',
      'O meu programa: deslize uma linha para a direita para navegar. Escolha Apple Mapas ou Google Maps; o percurso é a pé.',
    ],
  },
  {
    version: '0.7.1',
    date: '2026-11-21',
    changes: ['Mijn programma: de grote tijd en wachttijd stonden in 0.7.0 mogelijk verschoven. Hersteld.'],
    en: ['My plan: the large time and wait time could be misaligned in 0.7.0. Fixed.'],
    pt: ['O meu programa: na 0.7.0 a hora grande e o tempo de espera podiam ficar desalinhados. Corrigido.'],
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
    pt: [
      'O meu programa: recolha os espetáculos com o botão "Espetáculos" ou tocando no título "Espetáculos". A escolha fica memorizada.',
      'Definições: "Novidades" com esta lista.',
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
    pt: [
      'A sua localização é determinada uma vez quando abre a app; depois o GPS desliga-se. Toque em ↻ para atualizar a localização.',
      'Definições: botão com o número da versão que procura uma atualização e atualiza a app se for preciso.',
      'Página de avarias: removida uma palavra "null" solta quando o parque está aberto.',
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
    pt: [
      'Avarias e manutenção mostradas como ponto de exclamação vermelho e chave inglesa cinzenta.',
      'Botão de atualizar ↻ e atualização automática mais económica.',
      'A app também abre sem ligação.',
      'O gráfico mostra as avarias como uma zona vermelho-clara.',
      'O mosaico de avarias pisca a vermelho quando há avarias novas.',
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
    pt: [
      'Tempos de espera ao vivo, avarias, horários de espetáculos e distâncias para o Disneyland Park e o Disney Adventure World.',
      'O meu programa, painel de detalhes com o histórico do dia, código de ligação para vários dispositivos e modo de simulação.',
    ],
  },
];

/** Wijzigingen in de huidige taal (Engels als vertaling ontbreekt en de taal geen Nederlands is). */
export const changesFor = (c: ChangelogEntry): string[] => (lang === 'nl' ? c.changes : c[lang] ?? c.en ?? c.changes);

/** "2026-11-21" → "21 nov 2026" / "21 Nov 2026". */
export function changelogDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat(t.locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d).replace('.', '');
}
