// A2: čista funkcija reconcile(manifest, snapshot). Uspoređuje po roditeljskom ID-u + normaliziranom nazivu + vrsti.
// NIKAD ne prepisuje postojeći zapis; dvosmislenost = REVIEW; sudar ID-a = BLOCKED; Dnevni boravak (HOLD) se ne dira.
import { hashOf } from './canonical.ts';
import { normName } from './names.ts';
import type {
  ItemEntry,
  LocationEntry,
  Manifest,
  PlannedWrite,
  Snapshot,
  SnapItem,
  SnapLocation,
  SnapPlacement,
} from './types.ts';

export async function snapshotHash(s: Snapshot): Promise<string> {
  const by = <T extends { id: string }>(xs: T[]) =>
    [...xs].sort((a, b) => a.id.localeCompare(b.id));
  return hashOf({
    p: s.meta.projectId,
    h: s.meta.householdId,
    l: by(s.locations),
    i: by(s.items),
    pl: by(s.placements),
    k: [...(s.placementKeys ?? [])].sort(),
  });
}

interface Resolved {
  id: string;
  isNew: boolean;
}

export async function reconcile(manifest: Manifest, snap: Snapshot | null): Promise<Manifest> {
  const m: Manifest = JSON.parse(JSON.stringify(manifest));
  m.planned = [];
  m.snapshotHash = null;
  if (!snap) return m; // bez snapshota statusi ostaju provizorni; izvještaj će reći NOT READY
  if (snap.meta.projectId !== m.project || snap.meta.householdId !== m.household) {
    m.blockers.push('SNAPSHOT_PROJECT_OR_HOUSEHOLD_MISMATCH');
    for (const e of [...m.locations, ...m.items])
      if (e.status === 'CREATE') {
        e.status = 'BLOCKED';
        e.reasons.push('SNAPSHOT_MISMATCH');
      }
    return m;
  }
  m.snapshotHash = await snapshotHash(snap);

  const activeLocs = snap.locations.filter((l) => !l.archived);
  const locById = new Map<string, SnapLocation>(snap.locations.map((l) => [l.id, l]));
  const itemById = new Map<string, SnapItem>(snap.items.map((i) => [i.id, i]));
  const plById = new Map<string, SnapPlacement>(snap.placements.map((p) => [p.id, p]));
  const childIdx = new Map<string, SnapLocation[]>();
  for (const l of activeLocs) {
    const k = `${l.parentId ?? 'root'}|${normName(l.name)}`;
    (childIdx.get(k) ?? childIdx.set(k, []).get(k)!).push(l);
  }
  const activePl = snap.placements.filter((p) => !p.archived);
  const activeItemsByNorm = new Map<string, SnapItem[]>();
  for (const i of snap.items)
    if (!i.archived)
      (
        activeItemsByNorm.get(normName(i.name)) ??
        activeItemsByNorm.set(normName(i.name), []).get(normName(i.name))!
      ).push(i);

  const resolved = new Map<string, Resolved>();
  const setStatus = (e: LocationEntry | ItemEntry, status: ItemEntry['status'], reason: string) => {
    e.status = status;
    e.reasons.push(reason);
  };

  for (const e of m.locations) {
    if (e.status !== 'CREATE') continue;
    const parent =
      e.parentPlanId === 'root' ? { id: 'root', isNew: false } : resolved.get(e.parentPlanId);
    if (!parent) {
      setStatus(e, 'REVIEW', 'PARENT_UNRESOLVED');
      continue;
    }
    e.parentId = parent.id;
    const same = locById.get(e.plannedId);
    if (same) {
      const ok =
        (same.parentId ?? 'root') === parent.id &&
        normName(same.name) === normName(e.name) &&
        same.kind === e.kind;
      if (ok) {
        e.status = 'MATCH';
        e.existingId = same.id;
        e.reasons.push('ALREADY_APPLIED');
        resolved.set(e.planId, { id: same.id, isNew: false });
      } else setStatus(e, 'BLOCKED', 'ID_COLLISION');
      continue;
    }
    if (parent.isNew) {
      resolved.set(e.planId, { id: e.plannedId, isNew: true });
      continue; // CREATE pod novim roditeljem: ništa postojeće ne može biti ispod
    }
    const hits = childIdx.get(`${parent.id}|${normName(e.name)}`) ?? [];
    const exact = hits.filter((h) => h.kind === e.kind);
    if (exact.length === 1) {
      e.status = 'MATCH';
      e.existingId = exact[0]!.id;
      e.reasons.push('EXISTING_LOCATION');
      resolved.set(e.planId, { id: exact[0]!.id, isNew: false });
    } else if (exact.length > 1) setStatus(e, 'REVIEW', 'AMBIGUOUS_MATCH');
    else if (hits.length > 0) setStatus(e, 'REVIEW', 'KIND_MISMATCH');
    else resolved.set(e.planId, { id: e.plannedId, isNew: true });
  }

  const seenPlanned = new Set<string>();
  for (const it of m.items) {
    if (it.status !== 'CREATE') continue;
    const loc = resolved.get(it.locationPlanId);
    if (!loc) {
      setStatus(it, 'REVIEW', 'LOCATION_UNRESOLVED');
      continue;
    }
    it.locationId = loc.id;
    const dupKey = `${loc.id}|${normName(it.name)}`;
    if (seenPlanned.has(dupKey)) {
      setStatus(it, 'REVIEW', 'DUPLICATE_IN_PLAN');
      continue;
    }
    seenPlanned.add(dupKey);
    const exItem = itemById.get(it.plannedItemId);
    const exPl = plById.get(it.plannedPlacementId);
    if (exItem || exPl) {
      const ok =
        !!exItem &&
        !!exPl &&
        exPl.itemId === exItem.id &&
        exPl.locationId === loc.id &&
        !exPl.archived &&
        normName(exItem.name) === normName(it.name) &&
        exItem.kind === it.kind;
      if (ok) {
        it.status = 'MATCH';
        it.existingItemId = exItem!.id;
        it.reasons.push('ALREADY_APPLIED');
      } else setStatus(it, 'BLOCKED', 'ID_COLLISION');
      continue;
    }
    if (loc.isNew) continue; // nova lokacija: ništa postojeće
    const here = activePl
      .filter((p) => p.locationId === loc.id)
      .map((p) => itemById.get(p.itemId))
      .filter((i): i is SnapItem => !!i && !i.archived && normName(i.name) === normName(it.name));
    if (here.length === 1) {
      if (here[0]!.kind !== it.kind) setStatus(it, 'REVIEW', 'KIND_MISMATCH');
      else {
        it.status = 'MATCH';
        it.existingItemId = here[0]!.id;
        it.reasons.push('EXISTING_ITEM_AT_LOCATION');
      }
    } else if (here.length > 1) setStatus(it, 'REVIEW', 'AMBIGUOUS_MATCH');
    else if ((activeItemsByNorm.get(normName(it.name)) ?? []).length > 0)
      setStatus(it, 'REVIEW', 'SAME_NAME_ELSEWHERE'); // moguć ADD_PLACEMENT: odluka vlasnika
  }

  // popis točnih upisa: lokacije (roditelj prije djeteta), pa stavke
  const planned: PlannedWrite[] = [];
  for (const e of m.locations)
    if (e.status === 'CREATE' && e.parentId)
      planned.push({
        op: 'createLocation',
        key: `loc:${e.plannedId}`,
        id: e.plannedId,
        parentId: e.parentId,
        name: e.name,
        kind: e.kind,
        planId: e.planId,
      });
  for (const it of m.items)
    if (it.status === 'CREATE' && it.locationId && it.kind)
      planned.push({
        op: 'createItemWithPlacement',
        key: `item:${it.plannedItemId}`,
        itemId: it.plannedItemId,
        placementId: it.plannedPlacementId,
        locationId: it.locationId,
        name: it.name,
        kind: it.kind,
        note: it.note,
        candidateId: it.candidateId,
        sourceId: it.sourceId,
      });
  m.planned = planned;
  return m;
}
