// Čista logika "vrata" za live inventar (bez Firebasea => jedinično testabilna).
// Pravilo (odluka glavnog razvoja): podaci se otkrivaju i provjera integriteta stabla pokreće TEK kad su SVE tri
// kolekcije stigle kao server-potvrđeni snapshot (fromCache === false I hasPendingWrites === false).
// Snapshot iz keša (djelomičan ili zastario) NIKAD ne otvara vrata — ostaje 'loading'.
import { findTreeProblems, type TreeProblem } from './tree';
import type { InventoryData, Item, Location, Placement } from './types';

export type SlotName = 'locations' | 'items' | 'placements';

export type InventoryState =
  | { status: 'loading' }
  /** needsBootstrap: potvrđeno je da nema nijedne lokacije (kućanstvo još nije pripremljeno). */
  | { status: 'ready'; data: InventoryData; needsBootstrap: boolean }
  /** Veza je pala nakon što je skup bio cjelovit: zadnji POTVRĐENI podaci, bez novih iz keša; pisanje onemogućeno. */
  | { status: 'stale'; data: InventoryData }
  /**
   * P2B-REV-03: cjelovit, server-potvrđen skup ima 0 lokacija, a ima predmeta i/ili smještaja. To NIJE prazno
   * (nepripremljeno) kućanstvo nego nedosljedni podaci: bez prikaza, bez izmjena, bez ponude "pripremi kućanstvo".
   * Stanje nosi samo brojeve, nikakve podatke.
   */
  | { status: 'inconsistent'; items: number; placements: number }
  /** D1: cjelovit, server-potvrđen skup lokacija je oštećen. Podaci se NE otkrivaju. */
  | { status: 'tree-corrupt'; problems: TreeProblem[] }
  | { status: 'error'; kind: 'offline' | 'unknown' }
  | { status: 'revoked' };

interface Slot<T> {
  docs: T[];
  confirmed: boolean;
}

export const isServerConfirmed = (m: { fromCache: boolean; hasPendingWrites: boolean }) =>
  !m.fromCache && !m.hasPendingWrites;

export function createInventoryGate() {
  const slots: { locations?: Slot<Location>; items?: Slot<Item>; placements?: Slot<Placement> } =
    {};
  let lastGood: InventoryData | null = null;
  let lastSignature = '';

  const signature = (s: InventoryState): string => {
    if (s.status === 'ready' || s.status === 'stale') {
      const d = s.data;
      const part = (xs: { id: string; version: number }[]) =>
        xs.map((x) => `${x.id}:${x.version}`).join(',');
      return `${s.status}|${part(d.locations)}|${part(d.items)}|${part(d.placements)}`;
    }
    return JSON.stringify(s);
  };

  return {
    /** Primijeni snapshot jedne kolekcije; vraća novo stanje ili null ako se ništa vidljivo nije promijenilo. */
    apply<K extends SlotName>(
      name: K,
      docs: K extends 'locations' ? Location[] : K extends 'items' ? Item[] : Placement[],
      confirmed: boolean,
    ): InventoryState | null {
      (slots as Record<string, Slot<unknown>>)[name] = { docs, confirmed };
      const next = evaluate();
      const sig = signature(next);
      if (sig === lastSignature) return null;
      lastSignature = sig;
      return next;
    },
  };

  function evaluate(): InventoryState {
    const { locations, items, placements } = slots;
    if (!locations || !items || !placements)
      return lastGood ? { status: 'stale', data: lastGood } : { status: 'loading' };
    const complete = locations.confirmed && items.confirmed && placements.confirmed;
    if (!complete) return lastGood ? { status: 'stale', data: lastGood } : { status: 'loading' };

    // Cjelovit, server-potvrđen skup: tek sada smije provjera integriteta (checkTreeIntegrity({complete:true})).
    if (locations.docs.length === 0) {
      if (items.docs.length > 0 || placements.docs.length > 0) {
        lastGood = null;
        return {
          status: 'inconsistent',
          items: items.docs.length,
          placements: placements.docs.length,
        };
      }
      const data = { locations: [], items: [], placements: [] };
      lastGood = data;
      return { status: 'ready', data, needsBootstrap: true }; // zaista prazno kućanstvo (sve tri kolekcije prazne)
    }
    const problems = findTreeProblems(locations.docs);
    if (problems.length) {
      lastGood = null;
      return { status: 'tree-corrupt', problems };
    }
    const data = { locations: locations.docs, items: items.docs, placements: placements.docs };
    lastGood = data;
    return { status: 'ready', data, needsBootstrap: false };
  }
}
