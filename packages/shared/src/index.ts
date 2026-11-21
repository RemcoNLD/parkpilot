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
  expectedBasis: string | null; // uitleg waarop de verwachte tijden gebaseerd zijn
  shows: { entityId: string; slots: ShowSlot[] }[];
}

export interface HistoryRow {
  at: string;
  wait: number | null;
  status: LiveStatus;
}

export interface HistoryResponse {
  entityId: string;
  from: string;
  rows: HistoryRow[];
}

/** Wanneer de server wachttijden en showtijden bijhoudt: nooit, alleen rond de openingstijden van het park, of altijd. */
export type TrackingMode = 'off' | 'park-hours' | 'always';
export const TRACKING_MODES: TrackingMode[] = ['off', 'park-hours', 'always'];

export interface TrackingSettings {
  mode: TrackingMode;
  active: Record<string, boolean>; // per park: wordt er nu bijgehouden?
}
