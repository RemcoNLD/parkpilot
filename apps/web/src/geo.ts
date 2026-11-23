import type { LatLng } from '../../../packages/shared/src/index';
import { dec1 } from './format';

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
  return `${dec1(m / 1000)} km`;
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

/** Verse, zo nauwkeurig mogelijke positie (geen bewaarde waarde), met nauwkeurigheid in meters. Voor het opslaan van een kijkplek. */
/**
 * Verse, zo nauwkeurig mogelijke meting (kijkplekken). Meet tot `maxMs` lang en houdt de beste meting; stopt eerder
 * zodra de nauwkeurigheid `goodM` of beter is. Een iPhone begint vaak op ±65 m en zakt in een paar seconden naar ±10 m.
 * `onProgress` krijgt elke betere meting, voor een lopende "±N m" op het scherm.
 */
export function getPrecisePosition(onProgress?: (accuracy: number | null) => void, maxMs = 10_000, goodM = 12): Promise<LatLng & { accuracy: number | null }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new GeoError('unsupported'));
    let best: (LatLng & { accuracy: number | null }) | null = null;
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      navigator.geolocation.clearWatch(id);
      clearTimeout(timer);
      if (best) resolve(best); else reject(new GeoError('timeout'));
    };
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const acc = Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null;
        if (!best || (acc !== null && (best.accuracy === null || acc < best.accuracy))) {
          best = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: acc };
          onProgress?.(acc);
        }
        if (acc !== null && acc <= goodM) finish();
      },
      (e) => {
        if (best) return finish();
        done = true;
        navigator.geolocation.clearWatch(id);
        clearTimeout(timer);
        reject(new GeoError(e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable'));
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
    // Zonder enige meting na maxMs nog even doorwachten (tot de time-out van 20 s hierboven); met een meting stoppen.
    const timer = setTimeout(() => { if (best) finish(); else setTimeout(finish, 10_000); }, maxMs);
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
