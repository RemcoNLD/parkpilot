export function agoLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return 'onbekend';
  const min = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  if (min < 1) return 'zojuist';
  if (min < 60) return `${min} min geleden`;
  const hours = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${hours} u ${rest} min geleden` : `${hours} u geleden`;
}

export function clock(ms: number | string, timeZone: string): string {
  const t = typeof ms === 'string' ? Date.parse(ms) : ms;
  return new Date(t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone });
}

export type WaitLevel = 'low' | 'mid' | 'high';
export const waitLevel = (min: number): WaitLevel => (min < 20 ? 'low' : min < 45 ? 'mid' : 'high');
