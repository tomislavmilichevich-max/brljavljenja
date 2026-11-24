// A7: DIZAJN povrata (planer, ne brisač). Ništa se ne briše ovdje: izlaz je samo prijedlog ZASEBNE privilegirane operacije
// koju vlasnik mora izričito odobriti. Strogi allowlist ID-eva iz checkpointa (NIKAD prefiks `imp1-`), provjera da je svaki
// zapis nepromijenjen (verzija 1, autor = naš UID) i da ga ništa naknadno ne referencira. Svako odstupanje => STOP.
import type { Checkpoint } from './apply.ts';
import type { Snapshot } from './types.ts';

export interface RestorePlan {
  decision: 'PROPOSE' | 'STOP';
  stopReasons: string[];
  proposedDeletes: { collection: 'items' | 'placements' | 'locations'; id: string }[]; // redoslijed: placements, items, locations (djeca prije roditelja)
  note: string;
}
const NOTE =
  'Prijedlog nije odobrenje. Brisanje je privilegirana operacija izvan pravila aplikacije (Rules zabranjuju brisanje), traži zasebno izričito odobrenje i prethodnu sigurnosnu kopiju; automatski siguran povrat se NE obećava.';

export function planRestore(cp: Checkpoint, snap: Snapshot, uid: string): RestorePlan {
  const stop: string[] = [];
  if (cp.uid !== uid) stop.push('UID_MISMATCH');
  if (cp.stop) stop.push('CHECKPOINT_HAS_STOP:' + cp.stop.key);
  const allow = {
    locations: new Set<string>(),
    items: new Set<string>(),
    placements: new Set<string>(),
  };
  for (const [key, st] of Object.entries(cp.done)) {
    if (st.state === 'existed') continue; // nije stvoreno našim importom => nikad na popisu za brisanje
    if (key.startsWith('loc:')) allow.locations.add(st.ids[0]!);
    else if (key.startsWith('item:')) {
      allow.items.add(st.ids[0]!);
      allow.placements.add(st.ids[1]!);
    } else stop.push('UNKNOWN_CHECKPOINT_KEY:' + key);
  }
  const locs = new Map(snap.locations.map((l) => [l.id, l]));
  const items = new Map(snap.items.map((i) => [i.id, i]));
  const pls = new Map(snap.placements.map((p) => [p.id, p]));
  for (const id of allow.locations) {
    const l = locs.get(id);
    if (!l) stop.push('MISSING:locations/' + id);
    else if (l.version !== 1 || l.createdBy !== uid) stop.push('CHANGED:locations/' + id);
    else if (l.archived) stop.push('ARCHIVED:locations/' + id);
  }
  for (const id of allow.items) {
    const i = items.get(id);
    if (!i) stop.push('MISSING:items/' + id);
    else if (i.version !== 1 || i.createdBy !== uid) stop.push('CHANGED:items/' + id);
  }
  for (const id of allow.placements) {
    const p = pls.get(id);
    if (!p) stop.push('MISSING:placements/' + id);
    else if (p.version !== 1 || p.createdBy !== uid) stop.push('CHANGED:placements/' + id);
    else if (
      !allow.items.has(p.itemId) ||
      (!allow.locations.has(p.locationId) && locs.has(p.locationId) && false)
    )
      stop.push('FOREIGN_LINK:placements/' + id);
  }
  // naknadne veze: bilo koji zapis KOJI NIJE na allowlistu a referencira naše zapise
  for (const p of snap.placements) {
    if (allow.placements.has(p.id)) continue;
    if (allow.items.has(p.itemId)) stop.push('LATER_PLACEMENT_FOR_IMPORTED_ITEM:' + p.id);
    if (allow.locations.has(p.locationId))
      stop.push('LATER_PLACEMENT_IN_IMPORTED_LOCATION:' + p.id);
  }
  for (const l of snap.locations)
    if (!allow.locations.has(l.id) && l.parentId && allow.locations.has(l.parentId))
      stop.push('LATER_CHILD_LOCATION:' + l.id);
  const depthOf = (id: string): number => {
    let d = 0;
    for (let c = locs.get(id); c?.parentId && d < 100; c = locs.get(c.parentId)) d++;
    return d;
  };
  const uniq = [...new Set(stop)];
  if (uniq.length) return { decision: 'STOP', stopReasons: uniq, proposedDeletes: [], note: NOTE };
  return {
    decision: 'PROPOSE',
    stopReasons: [],
    proposedDeletes: [
      ...[...allow.placements].sort().map((id) => ({ collection: 'placements' as const, id })),
      ...[...allow.items].sort().map((id) => ({ collection: 'items' as const, id })),
      ...[...allow.locations]
        .sort((a, b) => depthOf(b) - depthOf(a) || a.localeCompare(b))
        .map((id) => ({ collection: 'locations' as const, id })),
    ],
    note: NOTE,
  };
}
