const encoder = new TextEncoder();

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return bytesToHex(new Uint8Array(digest));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(byteCount: number): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(byteCount)));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const nowSec = (): number => Math.floor(Date.now() / 1000);

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export const errorJson = (status: number, code: string): Response => json({ error: code }, status);

/** Begin van de huidige dag (00:00) in de tijdzone van het park, in seconden sinds 1970. */
export function startOfLocalDaySec(timeZone: string, now = Date.now()): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(now));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Math.floor(now / 1000) - (get('hour') * 3600 + get('minute') * 60 + get('second'));
}
