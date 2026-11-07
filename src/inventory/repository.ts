// Produkcijski podatkovni sloj za Location / Item / Placement (shema P2-A, docs/P2_A_ADR.md).
//
// PRAVILA OVOG MODULA (odluke glavnog razvoja):
//  - SVE izmjene isključivo kroz runTransaction: bez veze transakcija pada ('offline'); nema skrivenog offline reda,
//    nema lažnog statusa spremanja, nema automatskog naknadnog slanja. Ovo je JEDINO mjesto u src/ koje smije
//    uvesti setDoc/updateDoc/deleteDoc/writeBatch/addDoc (ESLint to provodi), a ovdje se ne koriste.
//  - D1: premještaj lokacije = puni lanac predaka u transakciji + CAS na meta/tree. Rules NE jamče acikličnost.
//  - D2: archived na Location/Item se ne mijenja. D4: Placement se arhivira jednosmjerno.
//  - D5: pri svakom permission-denied najprije provjeri pristup SA SERVERA -> 'access-revoked'; tek onda sukob.
//  - P2-LOC-ROOM-01: room smije imati isključivo roditelja root i ne premješta se.
import {
  doc,
  getDocFromServer,
  runTransaction,
  serverTimestamp,
  type Firestore,
  type Transaction,
} from 'firebase/firestore';
import { isAccessRevoked } from './access';
import { DomainError, isPermissionDenied, toDomainError } from './errors';
import { ROOT_ID, type ItemKind, type LocationKind } from './types';
import {
  checkItemKind,
  checkLocationKind,
  cleanAliases,
  cleanName,
  cleanOptional,
  LIMITS,
  newId,
} from './validation';

/** Samo za testove: omogućuje prisilno preklapanje transakcija. U produkciji se ne postavlja. */
export interface TestHooks {
  afterReads?: () => Promise<void>;
}

export interface RepositoryContext {
  db: Firestore;
  householdId: string;
  uid: string;
  testHooks?: TestHooks;
}

export interface ItemPatch {
  name?: string;
  aliases?: string[];
  category?: string | null;
  note?: string | null;
}

export interface InventoryRepository {
  /** Stvara meta/tree i root ako ne postoje (izričita radnja korisnika; ne stvara nikakve demo podatke). */
  bootstrap(): Promise<{ created: string[] }>;
  createLocation(input: {
    name: string;
    parentId: string;
    kind: LocationKind;
  }): Promise<{ id: string }>;
  renameLocation(id: string, name: string, expectedVersion: number): Promise<void>;
  moveLocation(id: string, newParentId: string, expectedVersion?: number): Promise<void>;
  /**
   * P2B-REV-04: JEDINI način stvaranja predmeta — naziv i početna lokacija su obavezni (P2 handoff). Item, prvi
   * Placement i placementKey nastaju ATOMARNO u jednoj transakciji (nema predmeta bez smještaja nakon greške).
   */
  createItemWithPlacement(input: {
    name: string;
    kind: ItemKind;
    locationId: string;
    aliases?: string[];
    category?: string | null;
    note?: string | null;
  }): Promise<{ itemId: string; placementId: string }>;
  updateItem(id: string, patch: ItemPatch, expectedVersion: number): Promise<void>;
  addPlacement(itemId: string, locationId: string): Promise<{ id: string }>;
  movePlacement(id: string, newLocationId: string, expectedVersion: number): Promise<void>;
  archivePlacement(id: string, expectedVersion: number): Promise<void>;
}

export const keyIdFor = (kind: ItemKind, itemId: string, locationId: string) =>
  kind === 'unique' ? `${itemId}__unique` : `${itemId}__at__${locationId}`;

export function createInventoryRepository(ctx: RepositoryContext): InventoryRepository {
  const { db, householdId, uid } = ctx;
  const ref = (path: string) => doc(db, `households/${householdId}/${path}`);
  const stamp = () => ({
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: uid,
    updatedBy: uid,
  });
  const touch = (version: number) => ({
    version: version + 1,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });

  const accessRevoked = () => isAccessRevoked(db, householdId);

  /** runTransaction koji označi (mark) trenutak kad je callback završio, tj. kad slijedi commit. */
  const commitTx = <T>(mark: () => void, fn: (tx: Transaction) => Promise<T>) =>
    runTransaction(db, async (tx) => {
      const out = await fn(tx);
      mark();
      return out;
    });

  /**
   * Jedinstvena točka obrade grešaka transakcije: opoziv ≠ sukob ≠ offline ≠ nepoznat ishod.
   * `mark()` poziva SAMA transakcija kad je sve pročitala i postavila pisanja (neposredno prije commita).
   * Mrežna greška PRIJE toga znači da ništa nije poslano ('offline'); POSLIJE toga poslužitelj je mogao primiti
   * commit, a odgovor se izgubio — tada ne smijemo tvrditi "nije spremljeno" ('outcome-unknown').
   */
  async function run<T>(
    fn: (mark: () => void) => Promise<T>,
    recheck?: () => Promise<DomainError | null>,
  ): Promise<T> {
    let reachedCommit = false;
    try {
      return await fn(() => {
        reachedCommit = true;
      });
    } catch (e) {
      if (isPermissionDenied(e)) {
        if (await accessRevoked()) throw new DomainError('access-revoked');
        const reason = await recheck?.().catch(() => null);
        if (reason) throw reason;
        throw new DomainError('unknown', 'Pravila su odbila promjenu.');
      }
      const d = toDomainError(e);
      if (d.code === 'offline' && reachedCommit) throw new DomainError('outcome-unknown');
      throw d;
    }
  }

  const once = (): TestHooks => {
    let done = false;
    return {
      afterReads: async () => {
        if (!done) {
          done = true;
          await ctx.testHooks?.afterReads?.();
        }
      },
    };
  };

  const versionChanged = (path: string, expected: number) => async () => {
    const s = await getDocFromServer(ref(path));
    return s.exists() && s.data().version !== expected
      ? new DomainError('changed-elsewhere')
      : null;
  };

  async function readLiveLocation(tx: Transaction, id: string) {
    const s = await tx.get(ref(`locations/${id}`));
    if (!s.exists()) throw new DomainError('not-found');
    return s.data() as {
      name: string;
      parentId: string | null;
      kind: LocationKind;
      version: number;
      archived: boolean;
    };
  }

  return {
    async bootstrap() {
      return run((mark) =>
        commitTx(mark, async (tx) => {
          const [tree, root] = await Promise.all([
            tx.get(ref('meta/tree')),
            tx.get(ref(`locations/${ROOT_ID}`)),
          ]);
          const created: string[] = [];
          if (!tree.exists()) {
            tx.set(ref('meta/tree'), { rev: 0 });
            created.push('meta/tree');
          }
          if (!root.exists()) {
            tx.set(ref(`locations/${ROOT_ID}`), {
              name: 'Kuća',
              parentId: null,
              kind: 'house',
              version: 1,
              archived: false,
              ...stamp(),
            });
            created.push('locations/root');
          }
          return { created };
        }),
      );
    },

    async createLocation({ name, parentId, kind }) {
      const cleaned = cleanName(name);
      checkLocationKind(kind);
      // P2-LOC-ROOM-01 (isto pravilo kao u firestore.rules): prostorija isključivo pod root
      if (kind === 'room' && parentId !== ROOT_ID) throw new DomainError('room-parent');
      const hooks = once();
      const id = newId();
      await run((mark) =>
        commitTx(mark, async (tx) => {
          const parent = await tx.get(ref(`locations/${parentId}`));
          if (!parent.exists() || parent.data().archived) throw new DomainError('bad-parent');
          await hooks.afterReads?.();
          tx.set(ref(`locations/${id}`), {
            name: cleaned,
            parentId,
            kind,
            version: 1,
            archived: false,
            ...stamp(),
          });
        }),
      );
      return { id };
    },

    async renameLocation(id, name, expectedVersion) {
      const cleaned = cleanName(name);
      const hooks = once();
      await run(
        (mark) =>
          commitTx(mark, async (tx) => {
            const loc = await readLiveLocation(tx, id);
            if (loc.version !== expectedVersion) throw new DomainError('changed-elsewhere');
            await hooks.afterReads?.();
            tx.update(ref(`locations/${id}`), { name: cleaned, ...touch(loc.version) });
          }),
        versionChanged(`locations/${id}`, expectedVersion),
      );
    },

    async moveLocation(id, newParentId, expectedVersion) {
      const hooks = once();
      for (let attempt = 1; ; attempt++) {
        let usedRev = -1;
        let reachedCommit = false;
        try {
          await runTransaction(db, async (tx) => {
            const treeRef = ref('meta/tree');
            const tree = await tx.get(treeRef); // CAS: rev se čita PRVI
            if (!tree.exists()) throw new DomainError('not-bootstrapped');
            usedRev = tree.data().rev as number;
            const loc = await readLiveLocation(tx, id);
            if (loc.kind === 'room') throw new DomainError('room-immovable'); // P2-LOC-ROOM-01
            if (id === ROOT_ID) throw new DomainError('room-immovable');
            if (expectedVersion !== undefined && loc.version !== expectedVersion)
              throw new DomainError('changed-elsewhere');
            if (loc.parentId === newParentId) throw new DomainError('same-parent');
            // D1: PUNI lanac predaka (bez ograničenja dubine) unutar transakcije
            let cur: string | null = newParentId;
            const seen = new Set<string>();
            while (cur) {
              if (cur === id) throw new DomainError('cycle');
              if (seen.has(cur)) throw new DomainError('corrupt-tree');
              seen.add(cur);
              const s = await tx.get(ref(`locations/${cur}`));
              if (!s.exists()) throw new DomainError('bad-parent');
              if (cur === newParentId && s.data().archived) throw new DomainError('bad-parent');
              cur = s.data().parentId as string | null;
            }
            await hooks.afterReads?.();
            tx.update(ref(`locations/${id}`), { parentId: newParentId, ...touch(loc.version) });
            tx.update(treeRef, { rev: usedRev + 1 });
            reachedCommit = true; // sve pročitano i postavljeno: slijedi commit
          });
          return;
        } catch (e) {
          if (isPermissionDenied(e)) {
            if (await accessRevoked()) throw new DomainError('access-revoked');
            if (attempt < 3) {
              const now = (await getDocFromServer(ref('meta/tree'))).data()?.rev;
              if (now !== usedRev) continue; // drugi uređaj je promijenio stablo => ponovi protokol nad svježim stanjem
            }
            throw new DomainError('contention');
          }
          const d = toDomainError(e);
          if (d.code === 'offline' && reachedCommit) throw new DomainError('outcome-unknown');
          throw d;
        }
      }
    },

    async createItemWithPlacement({ name, kind, locationId, aliases, category, note }) {
      const cleaned = cleanName(name);
      checkItemKind(kind);
      if (!locationId || !locationId.trim())
        throw new DomainError('invalid-input', 'Početna lokacija je obavezna.');
      const data = {
        aliases: cleanAliases(aliases),
        category: cleanOptional(category, LIMITS.category, 'Kategorija'),
        note: cleanOptional(note, LIMITS.note, 'Napomena'),
      };
      const hooks = once();
      const itemId = newId();
      const placementId = newId();
      await run((mark) =>
        commitTx(mark, async (tx) => {
          // Čitanje lokacije PRIJE pisanja: bez veze pada prije commita => sigurno 'offline' (ne 'outcome-unknown').
          const loc = await tx.get(ref(`locations/${locationId}`));
          if (!loc.exists() || loc.data().archived) throw new DomainError('bad-location');
          await hooks.afterReads?.();
          tx.set(ref(`items/${itemId}`), {
            name: cleaned,
            kind,
            ...data,
            version: 1,
            archived: false,
            ...stamp(),
          });
          tx.set(ref(`placements/${placementId}`), {
            itemId,
            locationId,
            version: 1,
            archived: false,
            ...stamp(),
          });
          tx.set(
            ref(`placementKeys/${keyIdFor(kind, itemId, locationId)}`),
            kind === 'unique' ? { placementId, itemId } : { placementId, itemId, locationId },
          );
        }),
      );
      return { itemId, placementId };
    },

    async updateItem(id, patch, expectedVersion) {
      const change: Record<string, unknown> = {};
      if (patch.name !== undefined) change.name = cleanName(patch.name);
      if (patch.aliases !== undefined) change.aliases = cleanAliases(patch.aliases);
      if (patch.category !== undefined)
        change.category = cleanOptional(patch.category, LIMITS.category, 'Kategorija');
      if (patch.note !== undefined)
        change.note = cleanOptional(patch.note, LIMITS.note, 'Napomena');
      if (Object.keys(change).length === 0)
        throw new DomainError('invalid-input', 'Nema promjena.');
      const hooks = once();
      await run(
        (mark) =>
          commitTx(mark, async (tx) => {
            const it = await tx.get(ref(`items/${id}`));
            if (!it.exists()) throw new DomainError('not-found');
            if (it.data().version !== expectedVersion) throw new DomainError('changed-elsewhere');
            await hooks.afterReads?.();
            tx.update(ref(`items/${id}`), { ...change, ...touch(it.data().version) });
          }),
        versionChanged(`items/${id}`, expectedVersion),
      );
    },

    async addPlacement(itemId, locationId) {
      const hooks = once();
      const id = newId();
      await run(
        (mark) =>
          commitTx(mark, async (tx) => {
            const [item, loc] = await Promise.all([
              tx.get(ref(`items/${itemId}`)),
              tx.get(ref(`locations/${locationId}`)),
            ]);
            if (!item.exists() || item.data().archived) throw new DomainError('bad-item');
            if (!loc.exists() || loc.data().archived) throw new DomainError('bad-location');
            const kid = keyIdFor(item.data().kind, itemId, locationId);
            const key = await tx.get(ref(`placementKeys/${kid}`));
            if (key.exists()) throw new DomainError('duplicate-placement');
            await hooks.afterReads?.();
            tx.set(ref(`placements/${id}`), {
              itemId,
              locationId,
              version: 1,
              archived: false,
              ...stamp(),
            });
            tx.set(
              ref(`placementKeys/${kid}`),
              item.data().kind === 'unique'
                ? { placementId: id, itemId }
                : { placementId: id, itemId, locationId },
            );
          }),
        async () => {
          const item = await getDocFromServer(ref(`items/${itemId}`));
          if (!item.exists()) return null;
          const key = await getDocFromServer(
            ref(`placementKeys/${keyIdFor(item.data().kind, itemId, locationId)}`),
          );
          return key.exists() ? new DomainError('duplicate-placement') : null;
        },
      );
      return { id };
    },

    async movePlacement(id, newLocationId, expectedVersion) {
      const hooks = once();
      await run(
        (mark) =>
          commitTx(mark, async (tx) => {
            const pl = await tx.get(ref(`placements/${id}`));
            if (!pl.exists() || pl.data().archived) throw new DomainError('not-found');
            if (pl.data().version !== expectedVersion) throw new DomainError('changed-elsewhere');
            if (pl.data().locationId === newLocationId) throw new DomainError('same-location');
            const itemId = pl.data().itemId as string;
            const [item, loc] = await Promise.all([
              tx.get(ref(`items/${itemId}`)),
              tx.get(ref(`locations/${newLocationId}`)),
            ]);
            if (!loc.exists() || loc.data().archived) throw new DomainError('bad-location');
            const kind = item.data()!.kind as ItemKind;
            if (kind === 'type') {
              const nk = await tx.get(
                ref(`placementKeys/${keyIdFor(kind, itemId, newLocationId)}`),
              );
              if (nk.exists()) throw new DomainError('duplicate-placement');
            }
            await hooks.afterReads?.();
            tx.update(ref(`placements/${id}`), {
              locationId: newLocationId,
              ...touch(pl.data().version),
            });
            if (kind === 'type') {
              tx.delete(ref(`placementKeys/${keyIdFor(kind, itemId, pl.data().locationId)}`));
              tx.set(ref(`placementKeys/${keyIdFor(kind, itemId, newLocationId)}`), {
                placementId: id,
                itemId,
                locationId: newLocationId,
              });
            }
          }),
        versionChanged(`placements/${id}`, expectedVersion),
      );
    },

    async archivePlacement(id, expectedVersion) {
      const hooks = once();
      await run(
        (mark) =>
          commitTx(mark, async (tx) => {
            const pl = await tx.get(ref(`placements/${id}`));
            if (!pl.exists() || pl.data().archived) throw new DomainError('not-found');
            if (pl.data().version !== expectedVersion) throw new DomainError('changed-elsewhere');
            const item = await tx.get(ref(`items/${pl.data().itemId}`));
            const kind = item.data()!.kind as ItemKind;
            await hooks.afterReads?.();
            tx.update(ref(`placements/${id}`), { archived: true, ...touch(pl.data().version) });
            tx.delete(
              ref(`placementKeys/${keyIdFor(kind, pl.data().itemId, pl.data().locationId)}`),
            );
          }),
        versionChanged(`placements/${id}`, expectedVersion),
      );
    },
  };
}
