import type { LatLng } from '../../../packages/shared/src/index';

const EARTH_RADIUS_M = 6_371_000;
/** Looppaden zijn langer dan hemelsbreed; deze factor is een eerste schatting tot er echte routes zijn. */
export const PATH_FACTOR = 1.3;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Geschatte looptijd in minuten voor een hemelsbrede afstand. */
export function walkMinutes(straightMeters: number, speedKmh: number): number {
  return Math.max(1, Math.round((straightMeters * PATH_FACTOR) / ((speedKmh * 1000) / 60)));
}

export function formatDistance(straightMeters: number): string {
  const m = straightMeters * PATH_FACTOR;
  if (m < 950) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

export type GeoErrorCode = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

export class GeoError extends Error {
  constructor(public code: GeoErrorCode) {
    super(code);
  }
}

export function getPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new GeoError('unsupported'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new GeoError(e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable')),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  });
}

/** Controleert zonder te vragen of de gebruiker al toestemming heeft gegeven. */
export async function hasGeoPermission(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state === 'granted';
  } catch {
    return false;
  }
}
