import { DomainError } from './errors';
import { CREATABLE_LOCATION_KINDS, type ItemKind, type LocationKind } from './types';

// Ograničenja moraju odgovarati firestore.rules (name <=120, note <=1000, category <=60, aliases <=20, join <=1600).
export const LIMITS = {
  name: 120,
  note: 1000,
  category: 60,
  aliases: 20,
  aliasesJoined: 1600,
} as const;

/** Novi ID: UUID (mala slova, brojke, crtice) zadovoljava pravila (`^[a-z0-9]+(-[a-z0-9]+)*$`). */
export function newId(): string {
  return crypto.randomUUID();
}

export function cleanName(raw: string): string {
  const t = (raw ?? '').trim();
  if (!t) throw new DomainError('invalid-input', 'Naziv je obavezan.');
  if (t.length > LIMITS.name)
    throw new DomainError('invalid-input', `Naziv je predug (najviše ${LIMITS.name}).`);
  return t;
}

export function cleanOptional(
  raw: string | null | undefined,
  max: number,
  label: string,
): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t) return null;
  if (t.length > max)
    throw new DomainError('invalid-input', `${label} je predugačak (najviše ${max}).`);
  return t;
}

export function cleanAliases(raw: string[] | undefined): string[] {
  const out: string[] = [];
  for (const a of raw ?? []) {
    const t = a.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  if (out.length > LIMITS.aliases)
    throw new DomainError('invalid-input', `Najviše ${LIMITS.aliases} sinonima.`);
  if (out.join('|').length > LIMITS.aliasesJoined)
    throw new DomainError('invalid-input', 'Sinonimi su preduga.');
  return out;
}

export function checkLocationKind(kind: LocationKind): void {
  if (!(CREATABLE_LOCATION_KINDS as readonly string[]).includes(kind)) {
    throw new DomainError('invalid-input', 'Nedopuštena vrsta lokacije.');
  }
}

export function checkItemKind(kind: ItemKind): void {
  if (kind !== 'unique' && kind !== 'type')
    throw new DomainError('invalid-input', 'Nedopuštena vrsta predmeta.');
}
