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

export const MIN_CODE_LENGTH = 4;
export const MAX_CODE_LENGTH = 24;

/**
 * Zet invoer om naar de canonieke vorm (hoofdletters, alleen letters en cijfers), of null als die niet kan kloppen.
 * Geldt voor zowel gegenereerde codes als zelfgekozen codes zoals "1234".
 */
export function normalizeRecoveryCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return raw.length >= MIN_CODE_LENGTH && raw.length <= MAX_CODE_LENGTH ? raw : null;
}

export function hashRecoveryCode(normalized: string): Promise<string> {
  return sha256Hex(`parkpilot:recovery:${normalized}`);
}
