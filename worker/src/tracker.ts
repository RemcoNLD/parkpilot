import type { LiveInfo, LiveResponse } from '../../packages/shared/src/index';
import type { Env } from './auth';
import { PARKS } from './parks';
import { hasShowHistory, recordShowtimes } from './shows';
import { getLive } from './themeparks';
import { nowSec } from './util';

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
}

const LOG_RETENTION_SEC = 7 * 24 * 3600;
const iso = (sec: number): string => new Date(sec * 1000).toISOString();

export async function loadStates(env: Env, parkId: string): Promise<Map<string, StateRow>> {
  const rows = await env.DB.prepare(
    'SELECT entity_id, wait, status, prev_wait, changed_at, first_seen_at FROM wait_state WHERE park_id = ?',
  )
    .bind(parkId)
    .all<StateRow>();
  return new Map(rows.results.map((r) => [r.entity_id, r]));
}

export function track(
  env: Env,
  parkId: string,
  data: LiveResponse,
  states: Map<string, StateRow>,
  now = nowSec(),
): { live: LiveResponse; statements: D1PreparedStatement[] } {
  const statements: D1PreparedStatement[] = [];

  const write = (item: LiveInfo, prevWait: number | null): void => {
    statements.push(
      env.DB.prepare(
        'INSERT INTO wait_state (park_id, entity_id, wait, status, prev_wait, changed_at, first_seen_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(park_id, entity_id) DO UPDATE SET ' +
          'wait = excluded.wait, status = excluded.status, prev_wait = excluded.prev_wait, changed_at = excluded.changed_at',
      ).bind(parkId, item.id, item.waitMinutes, item.status, prevWait, now, now),
      env.DB.prepare('INSERT INTO wait_log (park_id, entity_id, at, wait, status) VALUES (?, ?, ?, ?, ?)').bind(
        parkId, item.id, now, item.waitMinutes, item.status,
      ),
    );
  };

  const live = data.live.map((item): LiveInfo => {
    const prev = states.get(item.id);
    if (!prev) {
      write(item, null);
      return { ...item, changedAt: iso(now), changeObserved: false, prevWaitMinutes: null };
    }
    if (prev.wait !== item.waitMinutes || prev.status !== item.status) {
      write(item, prev.wait);
      return { ...item, changedAt: iso(now), changeObserved: true, prevWaitMinutes: prev.wait };
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
  for (const park of PARKS) {
    try {
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
