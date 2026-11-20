import type {
  Credentials,
  EntitiesResponse,
  EntityType,
  FavoriteDto,
  LiveResponse,
  ParkInfo,
  PreferencesDto,
  RedeemResponse,
} from '../../../packages/shared/src/index';

const CRED_KEY = 'pp.creds';

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
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
    const code = await res.json().then((j: { error?: string }) => j.error ?? 'error').catch(() => 'error');
    throw new ApiError(res.status, code);
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
export const fetchLive = (parkId: string) => request<LiveResponse>(`/api/parks/${parkId}/live`, {}, false);
export const fetchFavorites = (parkId: string) =>
  request<FavoriteDto[]>(`/api/favorites?parkId=${encodeURIComponent(parkId)}`);
export const putFavorite = (parkId: string, entityId: string, type: EntityType) =>
  request(`/api/favorites/${parkId}/${entityId}`, { method: 'PUT', body: JSON.stringify({ type }) });
export const deleteFavorite = (parkId: string, entityId: string) =>
  request(`/api/favorites/${parkId}/${entityId}`, { method: 'DELETE' });

export const createRecoveryCode = () => request<{ code: string }>('/api/profile/recovery-code', { method: 'POST' });
export const redeemRecoveryCode = (code: string) =>
  request<RedeemResponse>('/api/profile/redeem', { method: 'POST', body: JSON.stringify({ code }) }, false);

export const fetchPreferences = (parkId: string) => request<PreferencesDto>(`/api/preferences/${parkId}`);
export const savePreferences = (parkId: string, prefs: PreferencesDto) =>
  request(`/api/preferences/${parkId}`, { method: 'PUT', body: JSON.stringify(prefs) });
