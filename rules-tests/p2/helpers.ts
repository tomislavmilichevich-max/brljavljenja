// Pomoćni sloj za P2-A testove: izolirani emulator + seed sintetske demo kuće + REFERENTNI klijentski protokol.
// Referentni protokol (ops.ts) je ono što će P2-B repozitorij morati raditi; ovdje služi kao dokaz da pravila
// dopuštaju ispravan protokol i odbijaju sve ostalo. Nikakvi stvarni podaci ni UID-ovi.
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, doc, setDoc, type Firestore } from 'firebase/firestore';

export const H = 'demo-house';
export const UID_A = 'uidA';
export const UID_B = 'uidB';
export const UID_C = 'uidC'; // autenticiran, nije član
export const UID_OFF = 'uidDisabled'; // član s enabled:false
export const UID_OTHER = 'uidOther'; // član drugog kućanstva

interface FixtureLocation {
  id: string;
  name: string;
  parentId: string | null;
  kind: string;
  version: number;
  archived: boolean;
}
interface FixtureItem {
  id: string;
  name: string;
  kind: 'unique' | 'type';
  aliases: string[];
  category: string | null;
  note: string | null;
  version: number;
  archived: boolean;
}
interface FixturePlacement {
  id: string;
  itemId: string;
  locationId: string;
  version: number;
  archived: boolean;
}
export interface Fixture {
  householdId: string;
  firebaseProjectId: string;
  fixtureOnly: boolean;
  household: { name: string; schemaVersion: number };
  locations: FixtureLocation[];
  items: FixtureItem[];
  placements: FixturePlacement[];
}

export const fixture: Fixture = JSON.parse(
  readFileSync('docs/fixtures/P2_DEMO_HOUSE.json', 'utf8'),
);

let counter = 0;
export async function newEnv(
  prefix = 'demo-home-inventory-p2',
  rules: string = readFileSync('firestore.rules', 'utf8'),
): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    // Jedinstven projekt po okruženju => potpuna izolacija između testova; uvijek demo- (nikad pravi projekt).
    projectId: `${prefix}-${process.pid}-${++counter}`,
    firestore: { rules },
  });
}

export const as = (env: RulesTestEnvironment, uid: string): Firestore =>
  env.authenticatedContext(uid).firestore();

export const keyIdFor = (kind: 'unique' | 'type', itemId: string, locationId: string) =>
  kind === 'unique' ? `${itemId}__unique` : `${itemId}__at__${locationId}`;

/** Seed demo kuće ADMIN putem (zaobilazi pravila, kao Console). Samo u emulatoru. */
export async function seedDemoHouse(
  env: RulesTestEnvironment,
  members: readonly (readonly [string, boolean])[] = [
    [UID_A, true],
    [UID_B, true],
    [UID_OFF, false],
  ],
): Promise<void> {
  if (fixture.householdId !== 'demo-house' || !fixture.fixtureOnly)
    throw new Error('Neočekivan fixture');
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = Timestamp.now();
    const audit = { createdAt: now, updatedAt: now, createdBy: 'seed', updatedBy: 'seed' };
    const h = (p: string) => `households/${H}/${p}`;
    await setDoc(doc(db, `households/${H}`), fixture.household);
    for (const [uid, enabled] of members)
      await setDoc(doc(db, h(`members/${uid}`)), { uid, role: 'member', enabled });
    await setDoc(doc(db, 'households/other-house'), { name: 'Druga kuća', schemaVersion: 1 });
    await setDoc(doc(db, `households/other-house/members/${UID_OTHER}`), {
      uid: UID_OTHER,
      role: 'member',
      enabled: true,
    });
    await setDoc(doc(db, h('meta/tree')), { rev: 0 });
    for (const { id, ...l } of fixture.locations)
      await setDoc(doc(db, h(`locations/${id}`)), { ...l, ...audit });
    const kinds = new Map<string, 'unique' | 'type'>();
    for (const { id, ...i } of fixture.items) {
      kinds.set(id, i.kind);
      await setDoc(doc(db, h(`items/${id}`)), { ...i, ...audit });
    }
    for (const { id, ...p } of fixture.placements) {
      await setDoc(doc(db, h(`placements/${id}`)), { ...p, ...audit });
      if (p.archived) continue;
      const kind = kinds.get(p.itemId)!;
      await setDoc(
        doc(db, h(`placementKeys/${keyIdFor(kind, p.itemId, p.locationId)}`)),
        kind === 'unique'
          ? { placementId: id, itemId: p.itemId }
          : { placementId: id, itemId: p.itemId, locationId: p.locationId },
      );
    }
  });
}

/** Barijera: svih n sudionika čeka dok se svi ne pojave (za namjerno preklapanje transakcija). */
export function barrier(n: number) {
  let waiting = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return async () => {
    if (++waiting >= n) release();
    await gate;
  };
}

/** Pretvara ishod u 'OK' | 'DENIED' | poruku — radi čitljivijih usporedbi u testovima. */
export async function outcome(p: Promise<unknown>): Promise<'OK' | 'DENIED' | string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return err.code === 'permission-denied'
      ? 'DENIED'
      : `ERR:${err.code ?? ''}:${err.message ?? e}`;
  }
}

/** Admin čitanje (zaobilazi pravila) — withSecurityRulesDisabled ne vraća vrijednost pa koristimo zatvorenje. */
export async function adminRead<T>(
  env: RulesTestEnvironment,
  fn: (db: Firestore) => Promise<T>,
): Promise<T> {
  let out: T | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    out = await fn(ctx.firestore());
  });
  return out as T;
}
