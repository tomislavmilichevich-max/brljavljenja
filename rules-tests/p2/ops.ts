// REFERENTNI klijentski protokol za online izmjene (ono što P2-B repozitorij mora raditi).
// Sve su TRANSAKCIJE: ne ulaze u offline red, čitaju prije pisanja i povećavaju verzije.
// Pravila su zadnja linija obrane: gubitnik utrke dobije PERMISSION_DENIED (CAS na version / meta.rev / ključ);
// klijent to tumači ponovnim čitanjem (explainDenied) i javlja pravi razlog ili ponavlja protokol.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import { H, keyIdFor } from './helpers';

export class DomainError extends Error {
  constructor(
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}
type Hooks = { afterReads?: () => Promise<void> };
type Ids = { id: string; itemId: string; locationId: string };

const ref = (db: Firestore, path: string) => doc(db, `households/${H}/${path}`);
const isDenied = (e: unknown) => (e as { code?: string })?.code === 'permission-denied';
const stamp = (uid: string) => ({
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  createdBy: uid,
  updatedBy: uid,
});
const touch = (uid: string, version: number) => ({
  version: version + 1,
  updatedAt: serverTimestamp(),
  updatedBy: uid,
});

/**
 * Ako upis padne s permission-denied, ponovno pročitaj stanje: ako se zapis stvarno promijenio, to je sukob
 * ("changed-elsewhere"/"duplicate-placement"), a ne nedostatak ovlasti. Pravo odbijanje (npr. opozvan član) ostaje
 * 'permission-denied' jer ponovno čitanje ne pokazuje promjenu (ili je i samo odbijeno).
 */
async function explainDenied<T>(
  fn: () => Promise<T>,
  recheck: () => Promise<DomainError | null>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isDenied(e)) {
      const reason = await recheck().catch(() => null);
      if (reason) throw reason;
    }
    throw e;
  }
}
/** Hook za prisilno preklapanje u testovima smije se izvršiti samo jednom (ne i pri ponovnom pokušaju). */
const once = (hooks: Hooks): Hooks => {
  let done = false;
  return {
    afterReads: async () => {
      if (!done) {
        done = true;
        await hooks.afterReads?.();
      }
    },
  };
};

// ---------------------------------------------------------------- lokacije
/**
 * Premjesti lokaciju: čita meta/tree PRVI, hoda do korijena S PUNOM dubinom, piše lokaciju + rev+1.
 * Ako stablo promijeni drugi uređaj između čitanja i upisa, pravilo (CAS na rev) odbije upis; tada se cijeli
 * protokol (uključujući provjeru ciklusa) ponavlja nad svježim stanjem — najviše 3 puta.
 */
export async function moveLocation(
  db: Firestore,
  uid: string,
  id: string,
  newParentId: string,
  hooks: Hooks = {},
) {
  const h = once(hooks);
  for (let attempt = 1; ; attempt++) {
    let usedRev = -1;
    try {
      return await runTransaction(db, async (tx) => {
        const treeRef = ref(db, 'meta/tree');
        const tree = await tx.get(treeRef);
        usedRev = tree.data()!.rev;
        const loc = await tx.get(ref(db, `locations/${id}`));
        if (!loc.exists()) throw new DomainError('not-found');
        if (loc.data().parentId === newParentId) throw new DomainError('same-parent');
        let cur: string | null = newParentId;
        const seen = new Set<string>();
        while (cur) {
          if (cur === id) throw new DomainError('cycle');
          if (seen.has(cur)) throw new DomainError('corrupt-tree');
          seen.add(cur);
          const s = await tx.get(ref(db, `locations/${cur}`));
          if (!s.exists()) throw new DomainError('missing-parent');
          if (cur === newParentId && s.data().archived) throw new DomainError('parent-archived');
          cur = s.data().parentId as string | null;
        }
        await h.afterReads?.();
        tx.update(ref(db, `locations/${id}`), {
          parentId: newParentId,
          ...touch(uid, loc.data().version),
        });
        tx.update(treeRef, { rev: usedRev + 1 });
      });
    } catch (e) {
      if (isDenied(e) && attempt < 3) {
        const now = (await getDoc(ref(db, 'meta/tree'))).data()?.rev;
        if (now !== usedRev) continue; // stablo se promijenilo => ponovi s novim stanjem
      }
      throw e;
    }
  }
}

export async function createLocation(
  db: Firestore,
  uid: string,
  d: { id: string; name: string; parentId: string; kind: string },
) {
  return runTransaction(db, async (tx) => {
    const parent = await tx.get(ref(db, `locations/${d.parentId}`));
    if (!parent.exists() || parent.data().archived) throw new DomainError('bad-parent');
    tx.set(ref(db, `locations/${d.id}`), {
      name: d.name,
      parentId: d.parentId,
      kind: d.kind,
      version: 1,
      archived: false,
      ...stamp(uid),
    });
  });
}

// ---------------------------------------------------------------- smještaji
export async function addPlacement(db: Firestore, uid: string, d: Ids, hooks: Hooks = {}) {
  const h = once(hooks);
  return explainDenied(
    () =>
      runTransaction(db, async (tx) => {
        const item = await tx.get(ref(db, `items/${d.itemId}`));
        const loc = await tx.get(ref(db, `locations/${d.locationId}`));
        if (!item.exists() || item.data().archived) throw new DomainError('bad-item');
        if (!loc.exists() || loc.data().archived) throw new DomainError('bad-location');
        const kid = keyIdFor(item.data().kind, d.itemId, d.locationId);
        const key = await tx.get(ref(db, `placementKeys/${kid}`));
        if (key.exists()) throw new DomainError('duplicate-placement');
        await h.afterReads?.();
        tx.set(ref(db, `placements/${d.id}`), {
          itemId: d.itemId,
          locationId: d.locationId,
          version: 1,
          archived: false,
          ...stamp(uid),
        });
        tx.set(
          ref(db, `placementKeys/${kid}`),
          item.data().kind === 'unique'
            ? { placementId: d.id, itemId: d.itemId }
            : { placementId: d.id, itemId: d.itemId, locationId: d.locationId },
        );
      }),
    async () => {
      const item = await getDoc(ref(db, `items/${d.itemId}`));
      if (!item.exists()) return null;
      const key = await getDoc(
        ref(db, `placementKeys/${keyIdFor(item.data().kind, d.itemId, d.locationId)}`),
      );
      return key.exists() ? new DomainError('duplicate-placement') : null;
    },
  );
}

export async function movePlacement(
  db: Firestore,
  uid: string,
  id: string,
  newLocationId: string,
  expectedVersion: number,
  hooks: Hooks = {},
) {
  const h = once(hooks);
  return explainDenied(
    () =>
      runTransaction(db, async (tx) => {
        const pl = await tx.get(ref(db, `placements/${id}`));
        if (!pl.exists() || pl.data().archived) throw new DomainError('not-found');
        if (pl.data().version !== expectedVersion) throw new DomainError('changed-elsewhere');
        if (pl.data().locationId === newLocationId) throw new DomainError('same-location');
        const item = await tx.get(ref(db, `items/${pl.data().itemId}`));
        const loc = await tx.get(ref(db, `locations/${newLocationId}`));
        if (!loc.exists() || loc.data().archived) throw new DomainError('bad-location');
        const kind = item.data()!.kind as 'unique' | 'type';
        if (kind === 'type') {
          const nk = await tx.get(
            ref(db, `placementKeys/${keyIdFor(kind, pl.data().itemId, newLocationId)}`),
          );
          if (nk.exists()) throw new DomainError('duplicate-placement');
        }
        await h.afterReads?.();
        tx.update(ref(db, `placements/${id}`), {
          locationId: newLocationId,
          ...touch(uid, pl.data().version),
        });
        if (kind === 'type') {
          tx.delete(
            ref(db, `placementKeys/${keyIdFor(kind, pl.data().itemId, pl.data().locationId)}`),
          );
          tx.set(ref(db, `placementKeys/${keyIdFor(kind, pl.data().itemId, newLocationId)}`), {
            placementId: id,
            itemId: pl.data().itemId,
            locationId: newLocationId,
          });
        }
      }),
    async () => {
      const pl = await getDoc(ref(db, `placements/${id}`));
      return pl.exists() && pl.data().version !== expectedVersion
        ? new DomainError('changed-elsewhere')
        : null;
    },
  );
}

export async function archivePlacement(
  db: Firestore,
  uid: string,
  id: string,
  expectedVersion: number,
) {
  return runTransaction(db, async (tx) => {
    const pl = await tx.get(ref(db, `placements/${id}`));
    if (!pl.exists() || pl.data().archived) throw new DomainError('not-found');
    if (pl.data().version !== expectedVersion) throw new DomainError('changed-elsewhere');
    const item = await tx.get(ref(db, `items/${pl.data().itemId}`));
    const kind = item.data()!.kind as 'unique' | 'type';
    tx.update(ref(db, `placements/${id}`), { archived: true, ...touch(uid, pl.data().version) });
    tx.delete(ref(db, `placementKeys/${keyIdFor(kind, pl.data().itemId, pl.data().locationId)}`));
  });
}

// ---------------------------------------------------------------- predmeti
export async function renameItem(
  db: Firestore,
  uid: string,
  id: string,
  name: string,
  expectedVersion: number,
  hooks: Hooks = {},
) {
  const h = once(hooks);
  return explainDenied(
    () =>
      runTransaction(db, async (tx) => {
        const it = await tx.get(ref(db, `items/${id}`));
        if (!it.exists()) throw new DomainError('not-found');
        if (it.data().version !== expectedVersion) throw new DomainError('changed-elsewhere');
        await h.afterReads?.();
        tx.update(ref(db, `items/${id}`), { name, ...touch(uid, it.data().version) });
      }),
    async () => {
      const it = await getDoc(ref(db, `items/${id}`));
      return it.exists() && it.data().version !== expectedVersion
        ? new DomainError('changed-elsewhere')
        : null;
    },
  );
}

export async function createItem(
  db: Firestore,
  uid: string,
  d: { id: string; name: string; kind: 'unique' | 'type' },
) {
  return runTransaction(db, async (tx) => {
    tx.set(ref(db, `items/${d.id}`), {
      name: d.name,
      kind: d.kind,
      aliases: [],
      category: null,
      note: null,
      version: 1,
      archived: false,
      ...stamp(uid),
    });
  });
}

export async function archiveItem(db: Firestore, uid: string, id: string, expectedVersion: number) {
  return runTransaction(db, async (tx) => {
    const it = await tx.get(ref(db, `items/${id}`));
    if (!it.exists()) throw new DomainError('not-found');
    if (it.data().version !== expectedVersion) throw new DomainError('changed-elsewhere');
    tx.update(ref(db, `items/${id}`), { archived: true, ...touch(uid, it.data().version) });
  });
}

/** Čitanje svih smještaja (za testove stanja). */
export async function listPlacements(db: Firestore) {
  const snap = await getDocs(collection(db, `households/${H}/placements`));
  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as { itemId: string; locationId: string; archived: boolean; version: number }),
  }));
}
