// REFERENTNI klijentski protokol za online izmjene (ono što P2-B repozitorij mora raditi).
// Sve su TRANSAKCIJE: ne ulaze u offline red, čitaju prije pisanja i povećavaju verzije.
// Pravila su zadnja linija obrane: gubitnik utrke dobije PERMISSION_DENIED (CAS na version / meta.rev / ključ);
// klijent to tumači ponovnim čitanjem (explainDenied) i javlja pravi razlog ili ponavlja protokol.
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
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
 * D5: opoziv članstva MORA se razlikovati od sukoba. Pri svakom permission-denied najprije provjeri pristup
 * kućanstvu S POSLUŽITELJA (nikad iz keša): ako je i taj `get` odbijen, korisnik više nije aktivan član =>
 * 'access-revoked' (UI: odmah ukloniti podatke i pretplate, NE nuditi "pokušaj ponovno").
 * Ako pristup postoji, a upis je ipak odbijen, ponovno pročitaj zapis: promjena verzije/ključa znači sukob
 * ('changed-elsewhere'/'duplicate-placement'). Bez mreže ('unavailable') ne tvrdimo ništa o opozivu.
 */
export async function accessRevoked(db: Firestore): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, `households/${H}`));
    return false;
  } catch (e) {
    return isDenied(e);
  }
}

async function explainDenied<T>(
  db: Firestore,
  fn: () => Promise<T>,
  recheck: () => Promise<DomainError | null> = async () => null,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isDenied(e)) {
      if (await accessRevoked(db)) throw new DomainError('access-revoked');
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
        if (loc.data().kind === 'room') throw new DomainError('room-immovable');
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
      if (isDenied(e)) {
        if (await accessRevoked(db)) throw new DomainError('access-revoked');
        if (attempt < 3) {
          const now = (await getDocFromServer(ref(db, 'meta/tree'))).data()?.rev;
          if (now !== usedRev) continue; // stablo se promijenilo => ponovi s novim stanjem
        }
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
  return explainDenied(db, () =>
    runTransaction(db, async (tx) => {
      const parent = await tx.get(ref(db, `locations/${d.parentId}`));
      if (d.kind === 'room' && d.parentId !== 'root') throw new DomainError('room-parent'); // P2-LOC-ROOM-01
      if (!parent.exists() || parent.data().archived) throw new DomainError('bad-parent');
      tx.set(ref(db, `locations/${d.id}`), {
        name: d.name,
        parentId: d.parentId,
        kind: d.kind,
        version: 1,
        archived: false,
        ...stamp(uid),
      });
    }),
  );
}

// ---------------------------------------------------------------- smještaji
export async function addPlacement(db: Firestore, uid: string, d: Ids, hooks: Hooks = {}) {
  const h = once(hooks);
  return explainDenied(
    db,
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
    db,
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
  return explainDenied(db, () =>
    runTransaction(db, async (tx) => {
      const pl = await tx.get(ref(db, `placements/${id}`));
      if (!pl.exists() || pl.data().archived) throw new DomainError('not-found');
      if (pl.data().version !== expectedVersion) throw new DomainError('changed-elsewhere');
      const item = await tx.get(ref(db, `items/${pl.data().itemId}`));
      const kind = item.data()!.kind as 'unique' | 'type';
      tx.update(ref(db, `placements/${id}`), { archived: true, ...touch(uid, pl.data().version) });
      tx.delete(ref(db, `placementKeys/${keyIdFor(kind, pl.data().itemId, pl.data().locationId)}`));
    }),
  );
}

// ---------------------------------------------------------------- predmeti
// NAPOMENA (D2): arhiviranje Itema/Locationa je zabranjeno u pravilima; `archiveItem` postoji samo da testovi
// dokažu odbijanje.
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
    db,
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
  return explainDenied(db, () =>
    runTransaction(db, async (tx) => {
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
    }),
  );
}

export async function archiveItem(db: Firestore, uid: string, id: string, expectedVersion: number) {
  return explainDenied(db, () =>
    runTransaction(db, async (tx) => {
      const it = await tx.get(ref(db, `items/${id}`));
      if (!it.exists()) throw new DomainError('not-found');
      if (it.data().version !== expectedVersion) throw new DomainError('changed-elsewhere');
      tx.update(ref(db, `items/${id}`), { archived: true, ...touch(uid, it.data().version) });
    }),
  );
}

/** Čitanje svih smještaja (za testove stanja). */
export async function listPlacements(db: Firestore) {
  const snap = await getDocs(collection(db, `households/${H}/placements`));
  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as { itemId: string; locationId: string; archived: boolean; version: number }),
  }));
}

// ---------------------------------------------------------------- integritet stabla (D1)
export interface LocNode {
  id: string;
  parentId: string | null;
}
export type TreeProblem =
  | { type: 'no-root' }
  | { type: 'extra-root'; ids: string[] }
  | { type: 'missing-parent'; id: string; parentId: string }
  | { type: 'cycle'; ids: string[] };

/**
 * D1: detekcija OŠTEĆENOG stabla nakon učitavanja (Rules ne jamče potpunu acikličnost). Čista funkcija, O(n),
 * bez ograničenja dubine. P2-B ju MORA pozvati nakon svakog učitavanja/snapshota lokacija; ako vrati ijedan
 * problem, UI ne smije prikazivati putanje niti dopuštati premještanja (prikaz greške + upute vlasniku).
 * Root je iznimno lokacija s ID-em 'root' i parentId == null.
 */
export function findTreeProblems(locs: LocNode[]): TreeProblem[] {
  const problems: TreeProblem[] = [];
  const byId = new Map(locs.map((l) => [l.id, l]));
  const roots = locs.filter((l) => l.parentId === null).map((l) => l.id);
  if (!byId.has('root') || byId.get('root')!.parentId !== null) problems.push({ type: 'no-root' });
  const extra = roots.filter((id) => id !== 'root');
  if (extra.length) problems.push({ type: 'extra-root', ids: extra });
  for (const l of locs) {
    if (l.parentId !== null && !byId.has(l.parentId))
      problems.push({ type: 'missing-parent', id: l.id, parentId: l.parentId });
  }
  // ciklusi: 0 = neviđeno, 1 = na tekućem putu, 2 = gotovo (iterativno, bez rekurzije => radi za proizvoljnu dubinu)
  const state = new Map<string, 1 | 2>();
  for (const start of locs) {
    if (state.get(start.id) === 2) continue;
    const path: string[] = [];
    let cur: string | null = start.id;
    while (cur !== null && byId.has(cur)) {
      const st = state.get(cur);
      if (st === 2) break;
      if (st === 1) {
        problems.push({ type: 'cycle', ids: path.slice(path.indexOf(cur)) });
        break;
      }
      state.set(cur, 1);
      path.push(cur);
      cur = byId.get(cur)!.parentId;
    }
    for (const id of path) state.set(id, 2);
  }
  return problems;
}

// ---------------------------------------------------------------- potpunost snapshota (obveza P2-B)
export type TreeCheck =
  { status: 'incomplete' } | { status: 'ok' } | { status: 'corrupt'; problems: TreeProblem[] };

/**
 * P2-B OBVEZA: provjera integriteta stabla smije se pokrenuti TEK nad CJELOVITIM skupom lokacija, tj. kad je
 * stigao cijeli server-potvrđeni snapshot kolekcije (ne djelomični/prvi dio, ne keš, ne skup s lokalnim
 * nepotvrđenim upisima). Na djelomičnom skupu roditelj može jednostavno još nedostajati pa bi `missing-parent`
 * bio LAŽNA uzbuna. Dok skup nije cjelovit, ishod je 'incomplete' (UI: učitavanje), nikad 'corrupt'.
 * Pozivatelj određuje `complete`; ako ne može biti siguran, mora proslijediti false.
 */
export function checkTreeIntegrity(locs: LocNode[], snapshot: { complete: boolean }): TreeCheck {
  if (!snapshot.complete) return { status: 'incomplete' };
  const problems = findTreeProblems(locs);
  return problems.length ? { status: 'corrupt', problems } : { status: 'ok' };
}
