// Gedeelde types tussen Worker en app. Geen runtime-afhankelijkheden.

export type EntityType = 'attraction' | 'show';
export type LiveStatus = 'open' | 'closed' | 'down' | 'refurbishment' | 'unknown';
export type SortMode = 'distance' | 'wait' | 'name';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface ParkInfo {
  id: string; // eigen, stabiel ID (bijv. "dlp-disneyland"), niet het ThemeParks.wiki-ID
  name: string;
  shortName: string;
  timezone: string;
  center: LatLng;
  available: boolean; // false als het park (nog) niet in ThemeParks.wiki gevonden is
}

export interface EntityInfo {
  id: string;
  type: EntityType;
  name: string;
  location: LatLng | null;
  /** Waar de locatie vandaan komt: de bron, of een kijkplek die een gebruiker ter plekke opsloeg (sinds 0.12.0). */
  locationSource?: 'source' | 'user' | null;
  /** Alleen bij een kijkplek van een gebruiker: gps-nauwkeurigheid in meters en wanneer opgeslagen. */
  locationAccuracy?: number | null;
  locationUpdatedAt?: string | null;
  /** Alleen bij een kijkplek van een gebruiker (sinds 0.23.0): door de beheerder bevestigd. Onbevestigd = wel al in gebruik. */
  locationConfirmed?: boolean;
}

export interface EntitiesResponse {
  parkId: string;
  generatedAt: string;
  entities: EntityInfo[];
}

export interface Showtime {
  start: string; // ISO 8601 met tijdzone-offset
  end: string | null;
}

export interface LiveInfo {
  id: string;
  status: LiveStatus;
  waitMinutes: number | null;
  showtimes: Showtime[];
  updatedAt: string | null; // tijdstip waarop de bron dit item voor het laatst bijwerkte
  singleRider: boolean;
  singleRiderWait?: number | null; // wachttijd single rider volgens de bron (null = niet bekend); sinds 0.9.0
  // Door ParkPilot zelf bijgehouden (worker/src/tracker.ts):
  changedAt: string | null; // wanneer wij de laatste wijziging van status/wachttijd zagen
  changeObserved: boolean; // false = nog nooit zien veranderen; changedAt is dan "sinds we meten"
  prevWaitMinutes: number | null;
  /** Alleen in de app (sinds 0.21.0): langdurig dicht volgens isLongClosed(); = laatste update van de bron. */
  longClosedSince?: string;
}

/**
 * De bron werkt een attractie normaal elke paar minuten bij. Is dat langer dan dit geleden terwijl de attractie
 * open is met een wachttijd, dan is dat getal niet betrouwbaar: de app toont het grijs en de cron zet een
 * 'stale'-regel in het verloop (sinds 0.19.0).
 */
export const SOURCE_STALE_MS = 30 * 60_000;

export function isSourceStale(l: Pick<LiveInfo, 'status' | 'waitMinutes' | 'updatedAt'> | undefined, now = Date.now()): boolean {
  if (!l || l.status !== 'open' || l.waitMinutes === null || !l.updatedAt) return false;
  const t = Date.parse(l.updatedAt);
  return Number.isFinite(t) && now - t > SOURCE_STALE_MS;
}

/**
 * Langdurig dicht (sinds 0.21.0): dicht of in onderhoud, en de bron heeft de attractie al meer dan een dag niet
 * bijgewerkt. De bron meldt renovaties vaak als gewoon CLOSED (gezien: Crush's Coaster, dicht sinds 7 sep 2026,
 * laatste update 6 sep). De laatste update is dan ongeveer de laatste werkdag. De app zet zulke attracties onder
 * Onderhoud met "dicht sinds <datum>".
 */
export const LONG_CLOSED_MS = 24 * 3600_000;

export function isLongClosed(l: Pick<LiveInfo, 'status' | 'updatedAt'> | undefined, now = Date.now()): boolean {
  if (!l || (l.status !== 'closed' && l.status !== 'refurbishment') || !l.updatedAt) return false;
  const t = Date.parse(l.updatedAt);
  return Number.isFinite(t) && now - t > LONG_CLOSED_MS;
}

export interface LiveResponse {
  parkId: string;
  generatedAt: string; // wanneer onze Worker de bron heeft opgehaald
  sourceUpdatedAt: string | null; // meest recente update in de bron
  live: LiveInfo[];
}

export interface FavoriteDto {
  parkId: string;
  entityId: string;
  type: EntityType;
}

export interface PreferencesDto {
  sort: SortMode;
  arrivalMarginMin: number; // hoeveel minuten voor aanvang je bij een show wilt zijn
  walkingSpeedKmh: number;
}

export const DEFAULT_PREFERENCES: PreferencesDto = {
  sort: 'wait',
  arrivalMarginMin: 15,
  walkingSpeedKmh: 4.5,
};

/** Wat de app lokaal bewaart om zich bij de Worker te identificeren. */
export interface Credentials {
  deviceId: string;
  token: string;
}

export interface RedeemResponse extends Credentials {
  favoriteCount: number;
}

export interface ScheduleEntry {
  type: string;
  opens: string;
  closes: string;
}

export interface ScheduleDay {
  date: string; // JJJJ-MM-DD in de tijdzone van het park
  entries: ScheduleEntry[];
}

export interface ScheduleResponse {
  parkId: string;
  generatedAt: string;
  today: ScheduleEntry[];
  days: ScheduleDay[]; // vandaag en de komende dagen
}

export interface ShowSlot {
  start: string;
  /** "bron" = door ThemeParks.wiki gemeld, "verwacht" = afgeleid uit eerder geziene dagen en kan afwijken. */
  source: 'bron' | 'verwacht';
}

export interface ShowDayResponse {
  parkId: string;
  date: string;
  generatedAt: string;
  opening: ScheduleEntry[];
  expectedBasis: string | null; // uitleg waarop de verwachte tijden gebaseerd zijn (Nederlands, oud veld)
  /** Zelfde uitleg zonder taal: de app maakt er zelf een zin van. */
  basis?: { kind: 'lastWeek' | 'lastSeen' | 'mixed'; date: string | null } | null;
  shows: { entityId: string; slots: ShowSlot[] }[];
}

export interface HistoryRow {
  at: string;
  wait: number | null;
  status: LiveStatus | 'stale'; // 'stale' = bron gaf geen update (sinds 0.19.0), wait = laatste bekende waarde
}

export interface HistoryResponse {
  entityId: string;
  from: string;
  rows: HistoryRow[];
}

/**
 * Wachttijd op dezelfde weekdag in voorgaande weken (max. 4), per 5 minuten gemiddeld over de weken waarin de
 * attractie open was. Tijden staan al omgezet naar vandaag (zelfde kloktijd). Alleen de momenten waarop de waarde
 * verandert; `wait: null` = in geen van die weken open of geen gegevens.
 */
export interface WeekRefResponse {
  entityId: string;
  date: string;      // vandaag (parkdatum)
  dates: string[];   // de gebruikte eerdere dagen met gegevens, nieuwste eerst
  rows: { at: string; wait: number | null }[];
}

/**
 * Storingen van vandaag (sinds 0.20.0): per attractie de periodes met status `down` volgens wait_log.
 * `end: null` = loopt nog. `startKnown: false` = de storing liep al bij het begin van de dag.
 */
export interface IncidentsResponse {
  date: string; // parkdatum
  from: string; // begin van de dag (ISO)
  incidents: { entityId: string; start: string; end: string | null; startKnown: boolean }[];
}

/** Wanneer de server wachttijden en showtijden bijhoudt: nooit, alleen rond de openingstijden van het park, of altijd. */
export type TrackingMode = 'off' | 'park-hours' | 'always';
export const TRACKING_MODES: TrackingMode[] = ['off', 'park-hours', 'always'];

export interface TrackingSettings {
  mode: TrackingMode;
  active: Record<string, boolean>; // per park: wordt er nu bijgehouden?
}

/** Spelletje tijdens het wachten: hiscores (gedeeld met iedereen). */
export const GAMES = ['balloon'] as const;
export type GameId = (typeof GAMES)[number];
export interface GameScore { name: string; score: number; at: string }
export interface GameScoresResponse {
  game: GameId;
  top: GameScore[];
  /** Alleen na het insturen: je plek in de lijst en je beste score onder deze naam. */
  rank?: number;
  best?: number;
}
