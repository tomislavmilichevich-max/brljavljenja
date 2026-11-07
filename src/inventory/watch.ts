import {
  collection,
  onSnapshot,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { isAccessRevoked } from './access';
import { toDomainError, isPermissionDenied } from './errors';
import { createInventoryGate, isServerConfirmed, type InventoryState, type SlotName } from './gate';
import type { Item, Location, Placement } from './types';

const toLocation = (d: QueryDocumentSnapshot<DocumentData>): Location => ({
  id: d.id,
  name: String(d.data().name ?? ''),
  parentId: (d.data().parentId as string | null) ?? null,
  kind: d.data().kind,
  version: Number(d.data().version ?? 0),
  archived: d.data().archived === true,
});
const toItem = (d: QueryDocumentSnapshot<DocumentData>): Item => ({
  id: d.id,
  name: String(d.data().name ?? ''),
  kind: d.data().kind,
  aliases: Array.isArray(d.data().aliases) ? (d.data().aliases as string[]) : [],
  category: (d.data().category as string | null) ?? null,
  note: (d.data().note as string | null) ?? null,
  version: Number(d.data().version ?? 0),
  archived: d.data().archived === true,
});
const toPlacement = (d: QueryDocumentSnapshot<DocumentData>): Placement => ({
  id: d.id,
  itemId: String(d.data().itemId ?? ''),
  locationId: String(d.data().locationId ?? ''),
  version: Number(d.data().version ?? 0),
  archived: d.data().archived === true,
});

/**
 * Live pretplata na zajednički inventar. Tri listenera (locations/items/placements) s metadata signalima.
 * Podaci se otkrivaju tek kad su SVE tri kolekcije server-potvrđene (vidi gate.ts). Vraća funkciju koja
 * ODMAH odjavljuje sve listenere i gasi daljnje povratne pozive.
 */
export function watchInventory(
  db: Firestore,
  householdId: string,
  onState: (s: InventoryState) => void,
): () => void {
  const gate = createInventoryGate();
  let disposed = false;
  const unsubs: (() => void)[] = [];
  const emit = (s: InventoryState | null) => {
    if (!disposed && s) onState(s);
  };

  const listen = <K extends SlotName>(
    name: K,
    map: (d: QueryDocumentSnapshot<DocumentData>) => never,
  ) =>
    onSnapshot(
      collection(db, `households/${householdId}/${name}`),
      { includeMetadataChanges: true },
      (snap) => {
        if (disposed) return;
        emit(gate.apply(name, snap.docs.map(map) as never, isServerConfirmed(snap.metadata)));
      },
      async (err) => {
        if (disposed) return;
        if (isPermissionDenied(err)) {
          const revoked = await isAccessRevoked(db, householdId);
          emit(revoked ? { status: 'revoked' } : { status: 'error', kind: 'unknown' });
        } else {
          emit({
            status: 'error',
            kind: toDomainError(err).code === 'offline' ? 'offline' : 'unknown',
          });
        }
      },
    );

  unsubs.push(
    listen('locations', toLocation as never),
    listen('items', toItem as never),
    listen('placements', toPlacement as never),
  );
  return () => {
    disposed = true;
    for (const u of unsubs.splice(0)) u();
  };
}
