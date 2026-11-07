// P2B-REV-04: atomarno stvaranje Item + prvi Placement + placementKey u JEDNOJ transakciji/batchu.
// Dokazi: izvedivo je s getAfter() u pravilima; jedinstvenost, limiti pristupa dokumentima, paralelni upisi,
// negativni slučajevi i kompatibilnost s P2-A. Stvarna pravila u emulatoru, sintetski UID-ovi, demo kuća.
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  H,
  UID_A,
  UID_B,
  adminRead,
  as,
  barrier,
  newEnv,
  outcome,
  seedDemoHouse,
  keyIdFor,
} from './helpers';
import { createItemWithPlacement } from './ops';

let env: RulesTestEnvironment;
beforeAll(async () => void (env = await newEnv()));
afterAll(async () => env.cleanup());
beforeEach(async () => seedDemoHouse(env));

type Db = ReturnType<typeof as>;
const audit = (uid: string) => ({
  version: 1,
  archived: false,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  createdBy: uid,
  updatedBy: uid,
});
const itemDoc = (uid: string, kind: 'type' | 'unique' = 'type', extra: object = {}) => ({
  name: 'Novi',
  kind,
  aliases: [],
  category: null,
  note: null,
  ...audit(uid),
  ...extra,
});
const plDoc = (uid: string, itemId: string, locationId: string) => ({
  itemId,
  locationId,
  ...audit(uid),
});
const keyDoc = (
  kind: 'type' | 'unique',
  placementId: string,
  itemId: string,
  locationId: string,
) => (kind === 'unique' ? { placementId, itemId } : { placementId, itemId, locationId });
const ref = (db: Db, path: string) => doc(db, `households/${H}/${path}`);

/** Sirovi batch "item + placement + key" — zaobilazi referentni protokol, ostaju samo pravila. */
function atomicBatch(
  db: Db,
  uid: string,
  o: {
    item: string;
    pl: string;
    loc: string;
    kind?: 'type' | 'unique';
    keyId?: string;
    key?: object;
    itemExtra?: object;
    plItem?: string;
  },
) {
  const kind = o.kind ?? 'type';
  const b = writeBatch(db);
  b.set(ref(db, `items/${o.item}`), itemDoc(uid, kind, o.itemExtra));
  b.set(ref(db, `placements/${o.pl}`), plDoc(uid, o.plItem ?? o.item, o.loc));
  b.set(
    ref(db, `placementKeys/${o.keyId ?? keyIdFor(kind, o.item, o.loc)}`),
    o.key ?? keyDoc(kind, o.pl, o.item, o.loc),
  );
  return b;
}
const exists = (path: string) =>
  adminRead(env, async (db) => (await getDoc(doc(db, `households/${H}/${path}`))).exists());

describe('REV-04 pozitivno: Item + Placement + placementKey atomarno (A i B)', () => {
  for (const uid of [UID_A, UID_B]) {
    it(`${uid}: type predmet s prvom lokacijom jednim batchem`, async () => {
      await assertSucceeds(
        atomicBatch(as(env, uid), uid, { item: 'n1', pl: 'pn1', loc: 'garage-tool' }).commit(),
      );
      expect(await exists('items/n1')).toBe(true);
      expect(await exists('placements/pn1')).toBe(true);
      expect(await exists('placementKeys/n1__at__garage-tool')).toBe(true);
    });
    it(`${uid}: unique predmet s prvom lokacijom`, async () => {
      await assertSucceeds(
        atomicBatch(as(env, uid), uid, {
          item: 'u1',
          pl: 'pu1',
          loc: 'hall-cabinet',
          kind: 'unique',
        }).commit(),
      );
      expect(await exists('placementKeys/u1__unique')).toBe(true);
    });
  }
  it('referentni protokol (runTransaction) uspijeva i vraća ID-ove', async () => {
    const r = await createItemWithPlacement(as(env, UID_A), UID_A, {
      id: 'rt1',
      pl: 'prt1',
      name: 'Preko transakcije',
      kind: 'type',
      locationId: 'kitchen-cabinet',
    });
    expect(r).toEqual({ itemId: 'rt1', placementId: 'prt1' });
  });
  it('drugi smještaj ISTOG (već postojećeg) predmeta i dalje radi kao prije (P2-A tok nepromijenjen)', async () => {
    await assertSucceeds(
      atomicBatch(as(env, UID_A), UID_A, { item: 'n2', pl: 'pn2', loc: 'garage-tool' }).commit(),
    );
    const db = as(env, UID_B);
    const b = writeBatch(db);
    b.set(ref(db, 'placements/pn2b'), plDoc(UID_B, 'n2', 'hall-cabinet'));
    b.set(
      ref(db, 'placementKeys/n2__at__hall-cabinet'),
      keyDoc('type', 'pn2b', 'n2', 'hall-cabinet'),
    );
    await assertSucceeds(b.commit());
  });
});

describe('REV-04 negativno: svaka nevaljana kombinacija odbija CIJELI batch (nema djelomičnog stanja)', () => {
  const none = async (...paths: string[]) => {
    for (const p of paths) expect(await exists(p), p).toBe(false);
  };
  it('nepostojeća lokacija', async () => {
    await assertFails(
      atomicBatch(as(env, UID_A), UID_A, { item: 'x1', pl: 'px1', loc: 'ne-postoji' }).commit(),
    );
    await none('items/x1', 'placements/px1');
  });
  it('arhivirana lokacija (admin)', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      const { updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(c.firestore(), `households/${H}/locations/hall-cabinet`), {
        archived: true,
      });
    });
    await assertFails(
      atomicBatch(as(env, UID_A), UID_A, { item: 'x2', pl: 'px2', loc: 'hall-cabinet' }).commit(),
    );
    await none('items/x2', 'placements/px2');
  });
  it('smještaj bez ključa, ključ za pogrešnu lokaciju, ključ koji pokazuje na tuđi smještaj', async () => {
    const db = as(env, UID_A);
    const noKey = writeBatch(db);
    noKey.set(ref(db, 'items/x3'), itemDoc(UID_A));
    noKey.set(ref(db, 'placements/px3'), plDoc(UID_A, 'x3', 'garage-tool'));
    await assertFails(noKey.commit());
    await assertFails(
      atomicBatch(db, UID_A, {
        item: 'x4',
        pl: 'px4',
        loc: 'garage-tool',
        keyId: 'x4__at__hall-cabinet',
        key: keyDoc('type', 'px4', 'x4', 'hall-cabinet'),
      }).commit(),
    );
    await assertFails(
      atomicBatch(db, UID_A, {
        item: 'x5',
        pl: 'px5',
        loc: 'garage-tool',
        key: keyDoc('type', 'pl-battery-1', 'x5', 'garage-tool'),
      }).commit(),
    );
    await none('items/x3', 'items/x4', 'items/x5');
  });
  it('oblik ključa se ne slaže s vrstom predmeta (unique s "at" ključem i obrnuto)', async () => {
    const db = as(env, UID_A);
    await assertFails(
      atomicBatch(db, UID_A, {
        item: 'x6',
        pl: 'px6',
        loc: 'garage-tool',
        kind: 'unique',
        keyId: 'x6__at__garage-tool',
        key: keyDoc('type', 'px6', 'x6', 'garage-tool'),
      }).commit(),
    );
    await assertFails(
      atomicBatch(db, UID_A, {
        item: 'x7',
        pl: 'px7',
        loc: 'garage-tool',
        kind: 'type',
        keyId: 'x7__unique',
        key: keyDoc('unique', 'px7', 'x7', 'garage-tool'),
      }).commit(),
    );
  });
  it('smještaj referencira predmet koji NE postoji ni nakon batcha (P2-A MD-12 ostaje)', async () => {
    const db = as(env, UID_A);
    const b = writeBatch(db);
    b.set(ref(db, 'placements/px8'), plDoc(UID_A, 'nema-ga', 'garage-tool'));
    b.set(
      ref(db, 'placementKeys/nema-ga__at__garage-tool'),
      keyDoc('type', 'px8', 'nema-ga', 'garage-tool'),
    );
    await assertFails(b.commit());
    await assertFails(
      atomicBatch(db, UID_A, {
        item: 'x9',
        pl: 'px9',
        loc: 'garage-tool',
        plItem: 'nema-ga',
      }).commit(),
    );
  });
  it('nevaljan predmet u istom batchu (dodatno polje, archived=true, prazan naziv, krivi kind) poništava i smještaj', async () => {
    const db = as(env, UID_A);
    for (const [i, extra] of [
      { tajno: 1 },
      { archived: true },
      { name: '' },
      { kind: 'x' },
    ].entries()) {
      await assertFails(
        atomicBatch(db, UID_A, {
          item: `bad${i}`,
          pl: `pbad${i}`,
          loc: 'garage-tool',
          itemExtra: extra,
        }).commit(),
      );
      await none(`items/bad${i}`, `placements/pbad${i}`, `placementKeys/bad${i}__at__garage-tool`);
    }
  });
  it('nečlan, onemogućeni i neprijavljen ne mogu stvoriti atomarno', async () => {
    for (const uid of ['uidC', 'uidDisabled'])
      await assertFails(
        atomicBatch(as(env, uid), uid, {
          item: `nm-${uid.toLowerCase()}`,
          pl: `pnm-${uid.toLowerCase()}`,
          loc: 'garage-tool',
        }).commit(),
      );
    const anon = env.unauthenticatedContext().firestore() as Db;
    await assertFails(
      atomicBatch(anon, 'x', { item: 'anon1', pl: 'panon1', loc: 'garage-tool' }).commit(),
    );
  });
  it('dva smještaja jedinstvenog predmeta u istom batchu (dvije lokacije, isti ključ) — odbijeno', async () => {
    const db = as(env, UID_A);
    const b = writeBatch(db);
    b.set(ref(db, 'items/uu'), itemDoc(UID_A, 'unique'));
    b.set(ref(db, 'placements/pu1'), plDoc(UID_A, 'uu', 'garage-tool'));
    b.set(ref(db, 'placements/pu2'), plDoc(UID_A, 'uu', 'hall-cabinet'));
    b.set(ref(db, 'placementKeys/uu__unique'), keyDoc('unique', 'pu1', 'uu', 'garage-tool'));
    await assertFails(b.commit()); // pu2 nema svoj ključ => nema načina za drugi aktivni smještaj unique predmeta
  });
  it('postojeći ključ (već zauzeto mjesto) ne može se "ponovno stvoriti" ni uz novi predmet', async () => {
    const db = as(env, UID_A);
    const b = writeBatch(db);
    b.set(ref(db, 'items/dup'), itemDoc(UID_A));
    b.set(ref(db, 'placements/pdup'), plDoc(UID_A, 'dup', 'garage-tool'));
    b.set(
      ref(db, 'placementKeys/dup__at__garage-tool'),
      keyDoc('type', 'pdup', 'dup', 'garage-tool'),
    );
    await assertSucceeds(b.commit());
    const b2 = writeBatch(db);
    b2.set(ref(db, 'placements/pdup2'), plDoc(UID_A, 'dup', 'garage-tool'));
    b2.set(
      ref(db, 'placementKeys/dup__at__garage-tool'),
      keyDoc('type', 'pdup2', 'dup', 'garage-tool'),
    ); // = update ključa
    await assertFails(b2.commit());
  });
});

describe('REV-04 limiti pristupa dokumentima i paralelni upisi', () => {
  it('nema probijanja limita: operacija koristi ≤ 5 različitih dokumenata po operaciji (limit 10), 30 uzastopnih stvaranja svih prolazi', async () => {
    const db = as(env, UID_A);
    for (let i = 0; i < 30; i++)
      await assertSucceeds(
        atomicBatch(db, UID_A, { item: `bulk${i}`, pl: `pbulk${i}`, loc: 'garage-tool' }).commit(),
      );
    const items = await adminRead(
      env,
      async (a) => (await getDocs(collection(a, `households/${H}/items`))).size,
    );
    expect(items).toBe(29 + 30);
  });
  it('A i B istodobno stvaraju RAZLIČITE predmete s prvom lokacijom u ISTOJ lokaciji: oba uspiju (nema brojača)', async () => {
    const wait = barrier(2);
    const [ra, rb] = await Promise.all([
      outcome(
        createItemWithPlacement(
          as(env, UID_A),
          UID_A,
          { id: 'pa1', pl: 'ppa1', name: 'A', kind: 'type', locationId: 'hall-cabinet' },
          { afterReads: wait },
        ),
      ),
      outcome(
        createItemWithPlacement(
          as(env, UID_B),
          UID_B,
          { id: 'pb1', pl: 'ppb1', name: 'B', kind: 'type', locationId: 'hall-cabinet' },
          { afterReads: wait },
        ),
      ),
    ]);
    expect([ra, rb]).toEqual(['OK', 'OK']);
  });
  it('10 istodobnih atomarnih stvaranja (A i B naizmjence): sva uspiju, svaki predmet ima točno jedan ključ', async () => {
    const jobs = Array.from({ length: 10 }, (_, i) => {
      const uid = i % 2 ? UID_B : UID_A;
      return outcome(
        atomicBatch(as(env, uid), uid, {
          item: `par${i}`,
          pl: `ppar${i}`,
          loc: 'bathroom-cabinet',
        }).commit(),
      );
    });
    expect(await Promise.all(jobs)).toEqual(Array(10).fill('OK'));
    const keys = await adminRead(env, async (a) =>
      (await getDocs(collection(a, `households/${H}/placementKeys`))).docs.map((d) => d.id),
    );
    expect(keys.filter((k) => k.startsWith('par')).length).toBe(10);
  });
  it('istodobno: A atomarno stvara predmet, a B odmah pokušava dodati smještaj za isti ID PRIJE nego što predmet postoji — B je odbijen, A uspije', async () => {
    const a = atomicBatch(as(env, UID_A), UID_A, {
      item: 'race1',
      pl: 'prace1',
      loc: 'garage-tool',
    });
    const dbB = as(env, UID_B);
    const b = writeBatch(dbB);
    b.set(ref(dbB, 'placements/prace1b'), plDoc(UID_B, 'race1', 'hall-cabinet'));
    b.set(
      ref(dbB, 'placementKeys/race1__at__hall-cabinet'),
      keyDoc('type', 'prace1b', 'race1', 'hall-cabinet'),
    );
    const rb = await outcome(b.commit()); // predmet još ne postoji
    expect(rb).toBe('DENIED');
    expect(await outcome(a.commit())).toBe('OK');
  });
});

describe('REV-04 nužnost promjene pravila (mutacija): sa starim get() atomarno stvaranje je odbijeno', () => {
  it('vraćanje getAfter(item) -> get(item) ponovno ruši atomarno stvaranje (dokaz da je izmjena pravila bila nužna)', async () => {
    const original = readFileSync('firestore.rules', 'utf8');
    const old = original.replaceAll('getAfter(itemP(h, d.itemId))', 'get(itemP(h, d.itemId))');
    expect(old).not.toBe(original);
    const e2 = await newEnv('demo-home-inventory-old', old);
    try {
      await seedDemoHouse(e2);
      await assertFails(
        atomicBatch(as(e2, UID_A), UID_A, { item: 'o1', pl: 'po1', loc: 'garage-tool' }).commit(),
      );
    } finally {
      await e2.cleanup();
    }
  });
});
