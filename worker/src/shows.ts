import type { ScheduleEntry, ShowDayResponse, ShowSlot } from '../../packages/shared/src/index';
import type { Env } from './auth';
import type { ParkConfig } from './parks';
import { getLive, getSchedule } from './themeparks';
import { addDays, localDateStr, localTimeStr, nowSec, zonedEpochMs } from './util';

const HISTORY_DAYS = 30;

/** Bewaart de geziene showtijden. Wordt per uur aangeroepen vanuit de cron, niet bij elke aanvraag (D1-schrijfbudget). */
export async function recordShowtimes(env: Env, cfg: ParkConfig): Promise<void> {
  const live = await getLive(cfg);
  if (!live) return;
  const now = nowSec();
  const stmts: D1PreparedStatement[] = [];
  for (const item of live.live) {
    for (const s of item.showtimes) {
      const start = Math.floor(Date.parse(s.start) / 1000);
      if (!Number.isFinite(start)) continue;
      stmts.push(
        env.DB.prepare('INSERT OR IGNORE INTO show_seen (park_id, entity_id, start_at, seen_at) VALUES (?, ?, ?, ?)').bind(cfg.id, item.id, start, now),
      );
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  await env.DB.prepare('DELETE FROM show_seen WHERE start_at < ?').bind(now - 60 * 24 * 3600).run();
}

export async function hasShowHistory(env: Env, parkId: string): Promise<boolean> {
  return (await env.DB.prepare('SELECT 1 AS x FROM show_seen WHERE park_id = ? LIMIT 1').bind(parkId).first<{ x: number }>()) !== null;
}

/** Programma van één dag: tijden uit de bron, aangevuld met verwachte tijden uit eerder geziene dagen. */
export async function buildShowDay(env: Env, cfg: ParkConfig, date: string): Promise<ShowDayResponse | null> {
  const live = await getLive(cfg);
  if (!live) return null;
  const tz = cfg.timezone;
  const today = localDateStr(tz, Date.now());

  const official = new Map<string, ShowSlot[]>();
  for (const item of live.live) {
    const slots = item.showtimes
      .filter((s) => localDateStr(tz, Date.parse(s.start)) === date)
      .map((s): ShowSlot => ({ start: s.start, source: 'bron' }));
    if (slots.length) official.set(item.id, slots);
  }

  // Verwachte tijden: alleen voor shows waarvoor de bron voor deze dag niets meldt.
  const history = await env.DB.prepare('SELECT entity_id, start_at FROM show_seen WHERE park_id = ? AND start_at > ?')
    .bind(cfg.id, nowSec() - HISTORY_DAYS * 24 * 3600)
    .all<{ entity_id: string; start_at: number }>()
    .catch(() => ({ results: [] as { entity_id: string; start_at: number }[] }));
  const perShow = new Map<string, Map<string, Set<string>>>(); // entity -> datum -> kloktijden
  for (const r of history.results) {
    const ms = r.start_at * 1000;
    const d = localDateStr(tz, ms);
    const byDate = perShow.get(r.entity_id) ?? new Map<string, Set<string>>();
    const times = byDate.get(d) ?? new Set<string>();
    times.add(localTimeStr(tz, ms));
    byDate.set(d, times);
    perShow.set(r.entity_id, byDate);
  }

  let basis: string | null = null;
  const shows: ShowDayResponse['shows'] = [];
  const ids = new Set<string>([...official.keys(), ...perShow.keys()]);
  const liveIds = new Set(live.live.map((l) => l.id));
  for (const id of ids) {
    if (!liveIds.has(id)) continue; // show bestaat niet meer
    const slots = official.get(id);
    if (slots) { shows.push({ entityId: id, slots }); continue; }
    if (date < today) continue;
    const byDate = perShow.get(id);
    if (!byDate) continue;
    const lastWeek = addDays(date, -7);
    let source = byDate.has(lastWeek) ? lastWeek : null;
    let why = `dezelfde weekdag vorige week (${lastWeek})`;
    if (!source) {
      const latest = [...byDate.keys()].filter((d) => d <= today).sort().pop();
      if (latest) { source = latest; why = `de laatst geziene dag (${latest})`; }
    }
    if (!source) continue;
    const times = [...(byDate.get(source) as Set<string>)].sort();
    shows.push({ entityId: id, slots: times.map((t): ShowSlot => ({ start: new Date(zonedEpochMs(date, t, tz)).toISOString(), source: 'verwacht' })) });
    basis = basis && basis !== why ? 'eerder geziene dagen' : why;
  }

  const schedule = await getSchedule(cfg).catch(() => null);
  const opening: ScheduleEntry[] = schedule?.days.find((d) => d.date === date)?.entries ?? [];
  return { parkId: cfg.id, date, generatedAt: live.generatedAt, opening, expectedBasis: basis, shows };
}
