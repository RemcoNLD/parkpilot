import type {
  Credentials,
  EntitiesResponse,
  EntityInfo,
  EntityType,
  FavoriteDto,
  GameId,
  GameScoresResponse,
  HistoryResponse,
  LiveResponse,
  ParkInfo,
  PreferencesDto,
  RedeemResponse,
  ScheduleResponse,
  TrackingMode,
  WeekRefResponse,
  TrackingSettings,
  ShowDayResponse,
} from '../../../packages/shared/src/index';

const CRED_KEY = 'pp.creds';

export class ApiError extends Error {
  constructor(public status: number, public code: string, public data: Record<string, unknown> | null = null) {
    super(`${status} ${code}`);
  }
}

export function getCreds(): Credentials | null {
  try {
    const raw = localStorage.getItem(CRED_KEY);
    return raw ? (JSON.parse(raw) as Credentials) : null;
  } catch {
    return null;
  }
}

export function setCreds(c: Credentials | null): void {
  if (c) localStorage.setItem(CRED_KEY, JSON.stringify(c));
  else localStorage.removeItem(CRED_KEY);
}

async function request<T>(path: string, init: RequestInit = {}, auth = true, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (auth) {
    const creds = getCreds();
    if (creds) headers.set('authorization', `Bearer ${creds.deviceId}.${creds.token}`);
  }
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401 && auth && retry) {
    // Onbekend of ingetrokken apparaat (bijv. database vervangen): begin opnieuw met een nieuw profiel.
    setCreds(null);
    await ensureProfile();
    return request<T>(path, init, auth, false);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null) as Record<string, unknown> | null;
    throw new ApiError(res.status, typeof body?.error === 'string' ? body.error : 'error', body);
  }
  return (await res.json()) as T;
}

export async function ensureProfile(): Promise<void> {
  if (getCreds()) return;
  setCreds(await request<Credentials>('/api/profile', { method: 'POST' }, false));
}

export const fetchParks = () => request<ParkInfo[]>('/api/parks', {}, false);
export const fetchEntities = (parkId: string) =>
  request<EntitiesResponse>(`/api/parks/${parkId}/entities`, {}, false);
export const fetchLive = (parkId: string, fresh = false) =>
  request<LiveResponse>(`/api/parks/${parkId}/live${fresh ? '?fresh=1' : ''}`, fresh ? { cache: 'no-store' } : {}, false);
export const fetchFavorites = (parkId: string) =>
  request<FavoriteDto[]>(`/api/favorites?parkId=${encodeURIComponent(parkId)}`);
export const putFavorite = (parkId: string, entityId: string, type: EntityType) =>
  request(`/api/favorites/${parkId}/${entityId}`, { method: 'PUT', body: JSON.stringify({ type }) });
export const deleteFavorite = (parkId: string, entityId: string) =>
  request(`/api/favorites/${parkId}/${entityId}`, { method: 'DELETE' });

export const createRecoveryCode = (code?: string) =>
  request<{ code: string }>('/api/profile/recovery-code', { method: 'POST', body: code ? JSON.stringify({ code }) : undefined });
export const redeemRecoveryCode = (code: string) =>
  request<RedeemResponse>('/api/profile/redeem', { method: 'POST', body: JSON.stringify({ code }) }, false);

export const fetchPreferences = (parkId: string) => request<PreferencesDto>(`/api/preferences/${parkId}`);
export const savePreferences = (parkId: string, prefs: PreferencesDto) =>
  request(`/api/preferences/${parkId}`, { method: 'PUT', body: JSON.stringify(prefs) });

export const fetchSchedule = (parkId: string) => request<ScheduleResponse>(`/api/parks/${parkId}/schedule`, {}, false);
export const fetchHistoryToday = (parkId: string, entityId: string) =>
  request<HistoryResponse>(`/api/parks/${parkId}/history/${entityId}?since=today`, {}, false);
/** Zelfde weekdag in de voorgaande weken (stippellijn in de grafiek). */
export const fetchWeekRef = (parkId: string, entityId: string) =>
  request<WeekRefResponse>(`/api/parks/${parkId}/history/${entityId}?ref=weeks`, {}, false);

export const fetchHealth = () => request<{ ok: boolean; version?: string }>('/api/health', {}, false);
export const fetchShowDay = (parkId: string, date: string) => request<ShowDayResponse>(`/api/parks/${parkId}/shows?date=${date}`, {}, false);
export const fetchTracking = () => request<TrackingSettings>('/api/settings/tracking');
export const saveTracking = (mode: TrackingMode) =>
  request<TrackingSettings>('/api/settings/tracking', { method: 'PUT', body: JSON.stringify({ mode }) });

/** Kijkplek van een show opslaan of verwijderen (gedeeld met alle gebruikers). */
export const putShowLocation = (parkId: string, entityId: string, lat: number, lng: number, accuracy: number | null, replace: boolean) =>
  request<Partial<EntityInfo>>(`/api/locations/${parkId}/${entityId}`, { method: 'PUT', body: JSON.stringify({ lat, lng, accuracy, replace }) });
export const deleteShowLocation = (parkId: string, entityId: string) =>
  request(`/api/locations/${parkId}/${entityId}`, { method: 'DELETE' });

/** Spelletje: hiscores lezen (publiek) en een score insturen (profiel nodig). */
export const fetchGameScores = (game: GameId) => request<GameScoresResponse>(`/api/game/${game}/scores`, { cache: 'no-store' }, false);
export const postGameScore = async (game: GameId, name: string, score: number) => {
  await ensureProfile();
  return request<GameScoresResponse>(`/api/game/${game}/scores`, { method: 'POST', body: JSON.stringify({ name, score }) });
};
