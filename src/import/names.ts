import { NAME_MAX, NOTE_MAX } from './types.ts';

/** Duljina po UTF-16 jedinicama (klijentski validator) I po kodnim točkama; mjerodavna je veća (konzervativno za Rules). */
export const nameLength = (s: string): number => Math.max(s.length, [...s].length);

/** Naziv mora proći klijentski `cleanName` i Rules `validName`: neprazan, bez razmaka na rubovima, NAJVIŠE 120 (odbija > 120). */
export function validateName(s: unknown): { ok: true } | { ok: false; reason: string } {
  if (typeof s !== 'string' || s.length === 0) return { ok: false, reason: 'NAME_EMPTY' };
  if (s !== s.trim()) return { ok: false, reason: 'NAME_NOT_TRIMMED' };
  if (nameLength(s) > NAME_MAX) return { ok: false, reason: 'NAME_TOO_LONG' };
  return { ok: true };
}
export function validateNote(s: unknown): { ok: true } | { ok: false; reason: string } {
  if (typeof s !== 'string') return { ok: false, reason: 'NOTE_INVALID' };
  if (nameLength(s) > NOTE_MAX) return { ok: false, reason: 'NOTE_TOO_LONG' };
  return { ok: true };
}
/** Normalizacija za USPOREDBU naziva (informativno; sličnost nikad nije dokaz identiteta). */
export const normName = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Firestore ID prema Rules: ^[a-z0-9]+(-[a-z0-9]+)*$ , ≤ 64. */
export const validId = (s: string): boolean =>
  s.length >= 1 && s.length <= 64 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
