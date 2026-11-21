import type { EntityInfo, HistoryResponse, IncidentsResponse, LiveInfo, ScheduleEntry } from '../../../packages/shared/src/index';

/** Testgegevens voor de simulatiestand. Alles hier is verzonnen en wordt in de app duidelijk als simulatie getoond. */

function hash(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
  return x >>> 0;
}

/** Wachttijd per attractie: verloopt per 5 minuten rustig op en neer, in stappen van 5. */
function waitAt(id: string, bucket: number): number {
  const base = 10 + (hash(id) % 11) * 5;               // 10 t/m 60
  const wave = Math.sin(bucket / 3 + (hash(id + 'w') % 7)) * 15;
  const jitter = ((hash(id + bucket) % 5) - 2) * 5;
  return Math.max(5, Math.round((base + wave + jitter) / 5) * 5);
}

export function simulateLive(entities: EntityInfo[], now = Date.now()): LiveInfo[] {
  const bucket = Math.floor(now / 300_000);
  return entities.map((e): LiveInfo => {
    const base: LiveInfo = { id: e.id, status: 'open', waitMinutes: null, showtimes: [], updatedAt: new Date(now - (hash(e.id) % 4) * 60_000).toISOString(), singleRider: false, changedAt: null, changeObserved: true, prevWaitMinutes: null };
    if (e.type === 'show') {
      // Vaste tijden: elke 45 minuten op een vaste verschuiving per show, zodat ze niet meebewegen bij verversen.
      const step = 45 * 60_000, offset = (hash(e.id) % 45) * 60_000;
      const first = Math.ceil((now + 5 * 60_000 - offset) / step) * step + offset;
      base.showtimes = [0, 1, 2, 3].map((i) => ({ start: new Date(first + i * step).toISOString(), end: new Date(first + i * step + 20 * 60_000).toISOString() }));
      return base;
    }
    const r = hash(e.id + 'status') % 20;
    if (r === 0) { base.status = 'down'; return base; }
    if (r === 1) { base.status = 'refurbishment'; return base; }
    const cur = waitAt(e.id, bucket), prev = waitAt(e.id, bucket - 1);
    base.waitMinutes = cur;
    base.prevWaitMinutes = prev;
    base.changedAt = new Date(bucket * 300_000 + (hash(e.id) % 240) * 1000).toISOString();
    base.changeObserved = cur !== prev;
    base.singleRider = hash(e.id + 'sr') % 4 === 0;
    base.singleRiderWait = base.singleRider ? Math.max(5, Math.round(cur / 3 / 5) * 5) : null;
    return base;
  });
}

export function simulateSchedule(now = Date.now()): ScheduleEntry[] {
  return [{ type: 'OPERATING', opens: new Date(now - 3 * 3600_000).toISOString(), closes: new Date(now + 5 * 3600_000).toISOString() }];
}

/** Verzonnen dagverloop: sinds het simulatiepark "opende" (3 uur geleden), alleen de wijzigingen, zoals de server dat ook bewaart. */
export function simulateHistory(entityId: string, now = Date.now()): HistoryResponse {
  const bucket = Math.floor(now / 300_000);
  const start = bucket - 36; // 3 uur terug
  const rows: HistoryResponse['rows'] = [];
  // Voor een deel van de attracties een of twee verzonnen storingen, om de weergave te testen.
  const flaky = hash(entityId + 'd') % 3 === 0;
  const isDown = (b: number): boolean => flaky && ((b >= start + 8 && b <= start + 13) || (b >= start + 24 && b <= start + 26));
  let prev = '';
  for (let b = start; b <= bucket; b++) {
    const down = isDown(b);
    const w = down ? null : waitAt(entityId, b);
    const key = down ? 'down' : String(w);
    if (key !== prev) rows.push({ at: new Date(b * 300_000 + (hash(entityId + b) % 240) * 1000).toISOString(), wait: w, status: down ? 'down' : 'open' });
    prev = key;
  }
  return { entityId, from: new Date(start * 300_000).toISOString(), rows };
}

/** Verzonnen storingen van vandaag, afgeleid uit het verzonnen dagverloop (zelfde storingen als in de grafieken). */
export function simulateIncidents(entities: EntityInfo[], now = Date.now()): IncidentsResponse {
  const incidents: IncidentsResponse['incidents'] = [];
  let from = now;
  for (const e of entities) {
    if (e.type !== 'attraction') continue;
    const hist = simulateHistory(e.id, now);
    from = Math.min(from, Date.parse(hist.from));
    let start: string | null = null;
    for (const r of hist.rows) {
      if (r.status === 'down') start ??= r.at;
      else if (start) { incidents.push({ entityId: e.id, start, end: r.at, startKnown: true }); start = null; }
    }
    if (start) incidents.push({ entityId: e.id, start, end: null, startKnown: true });
  }
  incidents.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { date: '', from: new Date(from).toISOString(), incidents };
}
