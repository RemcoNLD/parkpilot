import { sha256Hex } from './util';

// 32 tekens (geen I, O, 0, 1) zodat de code goed over te typen is en elk teken precies 5 bit oplevert.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12; // 12 x 5 bit = 60 bit

/** Maakt een koppelcode zoals "K7QM-4TXD-9HBR". */
export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let raw = '';
  for (const b of bytes) raw += ALPHABET[b & 31]; // 256 is deelbaar door 32: geen bias
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** Zet invoer van een gebruiker om naar de canonieke vorm, of null als die niet kan kloppen. */
export function normalizeRecoveryCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== CODE_LENGTH) return null;
  for (const ch of raw) if (!ALPHABET.includes(ch)) return null;
  return raw;
}

export function hashRecoveryCode(normalized: string): Promise<string> {
  return sha256Hex(`parkpilot:recovery:${normalized}`);
}
