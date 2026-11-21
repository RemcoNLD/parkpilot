import { TRACKING_MODES, isSourceStale, type LiveInfo, type LiveResponse, type TrackingMode, type WeekRefResponse } from '../../packages/shared/src/index';
import type { Env } from './auth';
import { PARKS, type ParkConfig } from './parks';
import { hasShowHistory, recordShowtimes } from './shows';
import { getLive, getSchedule } from './themeparks';
import { addDays, localDateStr, nowSec, zonedEpochMs } from './util';

/**
 * ThemeParks.wiki geeft alleen de actuele stand. Hier houden we zelf bij wanneer die voor het laatst veranderde.
 * De nauwkeurigheid is de pollinterval: een Cron Trigger elke 5 minuten plus elke keer dat iemand live-data ophaalt.
 */

export interface StateRow {
  entity_id: string;
  wait: number | null;
  status: string;
  prev_wait: number | null;
  changed_at: number;
  first_seen_at: number;
  stale?: number; // > 0 = bron stil sinds (s); < 0 = weer actief sinds -waarde; 0 = nooit (0.19.0, migratie 0007)
}

/** 29 dagen: genoeg voor dezelfde weekdag in de vier voorgaande weken (stippellijn in de grafiek). */
export const LOG_RETENTION_SEC = 29 * 24 * 3600;
export const REF_WEEKS = 4;
const REF_STEP_MIN = 5;
const iso = (sec: number): string => new Date(sec * 1000).toISOString();

export async function loadStates(env: Env, parkId: string): Promise<Map<string, StateRow>> {
  const rows = await env.DB.prepare(
    'SELECT entity_id, wait, status, prev_wait, changed_at, first_seen_at, stale FROM wait_state WHERE park_id = ?',
  )
    .bind(parkId)
    .all<StateRow>();
  return new Map(rows.results.map((r) => [r.entity_id, r]));
}

const MARGIN_MS = 30 * 60_000; // een half uur voor opening en na sluiting blijven we meten

export async function getTrackingMode(env: Env): Promise<TrackingMode> {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'tracking'").first<{ value: string }>().catch(() => null);
  return TRACKING_MODES.includes(row?.value as TrackingMode) ? (row?.value as TrackingMode) : 'park-hours';
}

export async function setTrackingMode(env: Env, mode: TrackingMode): Promise<void> {
  await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('tracking', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(mode).run();
}

/** Moet de server nu voor dit park bijhouden? Bij onbekende openingstijden meten we liever door. */
export async function trackingActive(park: ParkConfig, mode: TrackingMode, now = Date.now()): Promise<boolean> {
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  try {
    const schedule = await getSchedule(park);
    const windows = (schedule?.today ?? []).filter((s) => s.type === 'OPERATING');
    if (!windows.length) return schedule === null;
    return windows.some((s) => now >= Date.parse(s.opens) - MARGIN_MS && now <= Date.parse(s.closes) + MARGIN_MS);
  } catch {
    return true;
  }
}

export function track(
  env: Env,
  parkId: string,
  data: LiveResponse,
  states: Map<string, StateRow>,
  now = nowSec(),
): { live: LiveResponse; statements: D1PreparedStatement[] } {
  const statements: D1PreparedStatement[] = [];

  const write = (item: LiveInfo, prevWait: number | null, stale: boolean): void => {
    statements.push(
      env.DB.prepare(
        'INSERT INTO wait_state (park_id, entity_id, wait, status, prev_wait, changed_at, first_seen_at, stale) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(park_id, entity_id) DO UPDATE SET ' +
          'wait = excluded.wait, status = excluded.status, prev_wait = excluded.prev_wait, changed_at = excluded.changed_at, stale = excluded.stale',
      ).bind(parkId, item.id, item.waitMinutes, item.status, prevWait, now, now, stale ? now : 0),
      env.DB.prepare('INSERT INTO wait_log (park_id, entity_id, at, wait, status) VALUES (?, ?, ?, ?, ?)').bind(
        parkId, item.id, now, item.waitMinutes, stale ? 'stale' : item.status,
      ),
    );
  };

  const live = data.live.map((item): LiveInfo => {
    const prev = states.get(item.id);
    const stale = isSourceStale(item, now * 1000);
    if (!prev) {
      write(item, null, stale);
      return { ...item, changedAt: iso(now), changeObserved: false, prevWaitMinutes: null };
    }
    if (prev.wait !== item.waitMinutes || prev.status !== item.status) {
      write(item, prev.wait, stale);
      return { ...item, changedAt: iso(now), changeObserved: true, prevWaitMinutes: prev.wait };
    }
    // Zelfde stand, maar de bron valt stil of komt weer terug: alleen die overgang in het verloop zetten.
    // Begin van het grijze stuk = laatste update van de bron (niet vóór de laatste regel die we al hebben).
    const prevStale = (prev.stale ?? 0) > 0;
    if (stale !== prevStale) {
      const lastMark = Math.abs(prev.stale ?? 0);
      const at = stale ? Math.min(now, Math.max(prev.changed_at + 1, lastMark + 1, Math.floor(Date.parse(item.updatedAt as string) / 1000))) : now;
      statements.push(
        env.DB.prepare('UPDATE wait_state SET stale = ? WHERE park_id = ? AND entity_id = ?').bind(stale ? at : -at, parkId, item.id),
        env.DB.prepare('INSERT INTO wait_log (park_id, entity_id, at, wait, status) VALUES (?, ?, ?, ?, ?)').bind(
          parkId, item.id, at, item.waitMinutes, stale ? 'stale' : item.status,
        ),
      );
    }
    return {
      ...item,
      changedAt: iso(prev.changed_at),
      changeObserved: prev.changed_at > prev.first_seen_at,
      prevWaitMinutes: prev.prev_wait,
    };
  });

  return { live: { ...data, live }, statements };
}

export async function runStatements(env: Env, statements: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
}

export async function trackAll(env: Env): Promise<void> {
  const mode = await getTrackingMode(env);
  for (const park of PARKS) {
    try {
      if (!(await trackingActive(park, mode))) continue;
      const data = await getLive(park);
      if (!data) continue;
      const { statements } = track(env, park.id, data, await loadStates(env, park.id));
      await runStatements(env, statements);
      // Showtijden per uur bewaren (of meteen als er nog niets is), om D1-schrijfacties te sparen.
      if (new Date().getUTCMinutes() < 5 || !(await hasShowHistory(env, park.id))) await recordShowtimes(env, park);
    } catch (err) {
      console.error(`tracken van ${park.id} mislukt`, err);
    }
  }
  await env.DB.prepare('DELETE FROM wait_log WHERE at < ?').bind(nowSec() - LOG_RETENTION_SEC).run();
}

/**
 * Dezelfde weekdag in de voorgaande weken: per 5 minuten de wachttijd (als de attractie open was), gemiddeld over
 * de weken met gegevens. Alleen lezen; gebruikt de bestaande wait_log (rijen alleen bij een wijziging).
 */
export async function buildWeekRef(env: Env, park: ParkConfig, entityId: string, nowMs = Date.now()): Promise<WeekRefResponse> {
  const tz = park.timezone;
  const today = localDateStr(tz, nowMs);
  type Row = { at: number; wait: number | null; status: string };
  const slots = (24 * 60) / REF_STEP_MIN;
  const sums = new Array<number>(slots).fill(0);
  const counts = new Array<number>(slots).fill(0);
  const dates: string[] = [];
  const weeks = Array.from({ length: REF_WEEKS }, (_, i) => addDays(today, -7 * (i + 1)));
  const results = await Promise.all(weeks.map(async (date) => {
    const start = Math.floor(zonedEpochMs(date, '00:00', tz) / 1000);
    const end = Math.floor(zonedEpochMs(addDays(date, 1), '00:00', tz) / 1000);
    const [inDay, base] = await Promise.all([
      env.DB.prepare('SELECT at, wait, status FROM wait_log WHERE park_id = ? AND entity_id = ? AND at >= ? AND at < ? ORDER BY at')
        .bind(park.id, entityId, start, end).all<Row>(),
      env.DB.prepare('SELECT at, wait, status FROM wait_log WHERE park_id = ? AND entity_id = ? AND at < ? AND at >= ? ORDER BY at DESC LIMIT 1')
        .bind(park.id, entityId, start, start - 24 * 3600).first<Row>(),
    ]);
    return { date, start, rows: [...(base ? [base] : []), ...inDay.results] };
  }));
  for (const { date, start, rows } of results) {
    if (!rows.length) continue;
    let used = false;
    let j = 0;
    let cur: Row | null = null;
    for (let i = 0; i < slots; i++) {
      // Slot i = kloktijd i*5 min op die dag (bij zomer-/wintertijd schuift één uur; verwaarloosbaar).
      const t = start + i * REF_STEP_MIN * 60;
      while (j < rows.length && rows[j].at <= t) cur = rows[j++];
      if (cur && cur.status === 'open' && cur.wait !== null) { sums[i] += cur.wait; counts[i]++; used = true; }
    }
    if (used) dates.push(date);
  }
  const rows: WeekRefResponse['rows'] = [];
  let last: number | null | undefined;
  for (let i = 0; i < slots; i++) {
    const v = counts[i] ? Math.round(sums[i] / counts[i]) : null;
    if (v === last) continue;
    last = v;
    const mins = i * REF_STEP_MIN;
    const hhmm = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    rows.push({ at: new Date(zonedEpochMs(today, hhmm, tz)).toISOString(), wait: v });
  }
  return { entityId, date: today, dates, rows: dates.length ? rows : [] };
}
