import { t } from './i18n';

/** Minuten sinds een tijdstip (nooit negatief). */
export const minutesSince = (iso: string, now = Date.now()): number => Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));

/** Duur in de huidige taal: "12 min", "2 u 5 min" / "2 h 5 min". */
export function dur(min: number): string {
  if (min < 60) return t.min(min);
  return t.hours(Math.floor(min / 60), min % 60);
}

/** Duur in gewone taal; vanaf 48 uur in dagen ("17 dagen"). */
export function durHuman(min: number): string {
  return min < 48 * 60 ? dur(min) : t.days(Math.floor(min / 1440));
}

export function agoLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return t.unknown;
  const min = minutesSince(iso, now);
  return min < 1 ? t.justNow : t.ago(dur(min));
}

export function clock(ms: number | string, timeZone: string): string {
  const v = typeof ms === 'string' ? Date.parse(ms) : ms;
  return new Date(v).toLocaleTimeString(t.locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
}

/** Getal met één decimaal en het decimaalteken van de huidige taal. */
export const dec1 = (n: number): string => n.toFixed(1).replace('.', t.decimal);

export type WaitLevel = 'low' | 'mid' | 'high';
export const waitLevel = (min: number): WaitLevel => (min < 20 ? 'low' : min < 45 ? 'mid' : 'high');
