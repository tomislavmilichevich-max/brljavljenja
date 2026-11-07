import { buildPath } from '../../inventory/tree';
import {
  ROOT_ID,
  type InventoryData,
  type Item,
  type Location,
  type LocationKind,
  type Placement,
} from '../../inventory/types';

export const KIND_LABEL: Record<LocationKind, string> = {
  house: 'Kuća',
  room: 'Prostorija',
  cabinet: 'Ormar',
  shelf: 'Polica',
  box: 'Kutija',
  drawer: 'Ladica',
  other: 'Ostalo',
};
export const GLYPH: Record<LocationKind, string> = {
  house: '🏡',
  room: '🛋️',
  cabinet: '🚪',
  shelf: '🗂️',
  box: '📦',
  drawer: '🗄️',
  other: '📍',
};

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'hr');

/** Izvedeni, samo-za-čitanje prikaz server-potvrđenih podataka (putanje i brojači se UVIJEK računaju iz parentId). */
export interface Model {
  locs: Map<string, Location>;
  items: Map<string, Item>;
  /** Aktivni smještaji aktivnih predmeta na aktivnim lokacijama. */
  byItem: Map<string, Placement[]>;
  byLoc: Map<string, Placement[]>;
  children: (id: string) => Location[];
  /** Puna putanja uključujući korijen ("Kuća › Garaža › Regal A"). */
  pathOf: (id: string | null) => string;
  /** Broj RAZLIČITIH vrsta predmeta u podstablu (dvostruki smještaji istog predmeta ne zbrajaju se). */
  countTypes: (id: string) => number;
  /** Je li `maybeInside` jednak `ancestor` ili njegov potomak? (samo filtriranje u UI-ju; server je istina). */
  isInside: (maybeInside: string, ancestor: string) => boolean;
  allLocations: Location[];
}

export function buildModel(data: InventoryData): Model {
  const locs = new Map(data.locations.filter((l) => !l.archived).map((l) => [l.id, l]));
  const items = new Map(data.items.filter((i) => !i.archived).map((i) => [i.id, i]));
  const byItem = new Map<string, Placement[]>();
  const byLoc = new Map<string, Placement[]>();
  for (const p of data.placements) {
    if (p.archived || !locs.has(p.locationId) || !items.has(p.itemId)) continue;
    (byItem.get(p.itemId) ?? byItem.set(p.itemId, []).get(p.itemId)!).push(p);
    (byLoc.get(p.locationId) ?? byLoc.set(p.locationId, []).get(p.locationId)!).push(p);
  }
  const kids = new Map<string, Location[]>();
  for (const l of locs.values()) {
    if (l.parentId === null) continue;
    (kids.get(l.parentId) ?? kids.set(l.parentId, []).get(l.parentId)!).push(l);
  }
  for (const list of kids.values()) list.sort(byName);

  // brojači: za svaki smještaj dodaj ID predmeta svim precima lokacije (jedan skup po lokaciji => dedup)
  const typesIn = new Map<string, Set<string>>();
  for (const p of data.placements) {
    if (p.archived || !items.has(p.itemId)) continue;
    const seen = new Set<string>();
    let cur: string | null = p.locationId;
    while (cur && locs.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      (typesIn.get(cur) ?? typesIn.set(cur, new Set()).get(cur)!).add(p.itemId);
      cur = locs.get(cur)!.parentId;
    }
  }
  return {
    locs,
    items,
    byItem,
    byLoc,
    children: (id) => kids.get(id) ?? [],
    pathOf: (id) => (id ? buildPath(locs, id).join(' › ') : ''),
    countTypes: (id) => typesIn.get(id)?.size ?? 0,
    isInside: (maybeInside, ancestor) => {
      const seen = new Set<string>();
      let cur: string | null = maybeInside;
      while (cur && !seen.has(cur)) {
        if (cur === ancestor) return true;
        seen.add(cur);
        cur = locs.get(cur)?.parentId ?? null;
      }
      return false;
    },
    allLocations: [...locs.values()].sort(byName),
  };
}

/** Lokacije složene u redoslijedu stabla (roditelj prije djece) radi izbornika; dubina za uvlaku. */
export function treeOrder(m: Model): Location[] {
  const out: Location[] = [];
  const walk = (id: string, depth: number) => {
    if (depth > 64) return;
    for (const c of m.children(id)) {
      out.push(c);
      walk(c.id, depth + 1);
    }
  };
  const root = m.locs.get(ROOT_ID);
  if (root) out.push(root);
  walk(ROOT_ID, 0);
  return out;
}

export const itemGlyph = (i: Item) => (i.kind === 'type' ? '🗃️' : '🧰');
export const kindText = (k: Item['kind']) =>
  k === 'unique' ? 'Jedinstveni predmet' : 'Vrsta predmeta';
