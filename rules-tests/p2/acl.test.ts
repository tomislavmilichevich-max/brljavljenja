// ACL-21…ACL-32 (docs/P2_ACCEPTANCE.md B) — stvarna pravila iz firestore.rules, sintetski UID-ovi, izolirani emulator.
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { H, UID_A, UID_B, UID_C, UID_OFF, UID_OTHER, as, newEnv, seedDemoHouse } from './helpers';
import {
  addPlacement,
  archivePlacement,
  createItem,
  createLocation,
  moveLocation,
  movePlacement,
  renameItem,
} from './ops';

let env: RulesTestEnvironment;
beforeAll(async () => void (env = await newEnv()));
afterAll(async () => env.cleanup());
beforeEach(async () => seedDemoHouse(env));

type Db = ReturnType<typeof as>;
const C = (db: Db, path: string) => collection(db, `households/${H}/${path}`);
const D = (db: Db, path: string) => doc(db, `households/${H}/${path}`);
const audit = (uid: string) => ({
  version: 1,
  archived: false,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  createdBy: uid,
  updatedBy: uid,
});
const validItem = (uid: string) => ({
  name: 'Novi',
  kind: 'type',
  aliases: [],
  category: null,
  note: null,
  ...audit(uid),
});
const validLoc = (uid: string) => ({ name: 'Nova', parentId: 'root', kind: 'room', ...audit(uid) });

const READABLE = [
  ['locations', 'garage-box'],
  ['items', 'hammer'],
  ['placements', 'pl-hammer-1'],
  ['meta', 'tree'],
  ['placementKeys', 'hammer__unique'],
] as const;
const LISTABLE = ['locations', 'items', 'placements'] as const;

describe('ACL-21/22 aktivni članovi A i B', () => {
  for (const uid of [UID_A, UID_B]) {
    it(`ACL-21 ${uid}: get dokumenata i list kolekcija inventara ALLOW`, async () => {
      const db = as(env, uid);
      for (const [c, id] of READABLE) await assertSucceeds(getDoc(D(db, `${c}/${id}`)));
      for (const c of LISTABLE) await assertSucceeds(getDocs(C(db, c)));
    });
    it(`ACL-21 ${uid}: list placementKeys je odbijen (nije potreban; get je dovoljan)`, async () => {
      await assertFails(getDocs(C(as(env, uid), 'placementKeys')));
    });
    it(`ACL-22 ${uid}: dopušteni create/update/arhiviranje prema strogoj shemi`, async () => {
      const db = as(env, uid);
      await assertSucceeds(
        createLocation(db, uid, {
          id: `loc-${uid.toLowerCase()}`,
          name: 'Polica',
          parentId: 'garage-tool',
          kind: 'shelf',
        }),
      );
      await assertSucceeds(
        createItem(db, uid, { id: `item-${uid.toLowerCase()}`, name: 'Nešto', kind: 'type' }),
      );
      await assertSucceeds(
        addPlacement(db, uid, {
          id: `pl-${uid.toLowerCase()}`,
          itemId: `item-${uid.toLowerCase()}`,
          locationId: 'garage-tool',
        }),
      );
      await assertSucceeds(renameItem(db, uid, 'hammer', `Čekić ${uid}`, 1));
      await assertSucceeds(moveLocation(db, uid, 'pantry-box', 'kitchen'));
      await assertSucceeds(movePlacement(db, uid, 'pl-hex-keys-1', 'garage-tool', 1));
      await assertSucceeds(archivePlacement(db, uid, 'pl-charger-2', 1));
    });
  }
});

describe('ACL-23 neprijavljen', () => {
  it('ne čita ni ne piše nijednu P2 putanju', async () => {
    const db = env.unauthenticatedContext().firestore() as Db;
    for (const [c, id] of READABLE) await assertFails(getDoc(D(db, `${c}/${id}`)));
    for (const c of LISTABLE) await assertFails(getDocs(C(db, c)));
    await assertFails(setDoc(D(db, 'items/anon'), validItem(UID_A)));
    await assertFails(updateDoc(D(db, 'items/hammer'), { name: 'x' }));
    await assertFails(deleteDoc(D(db, 'placementKeys/hammer__unique')));
  });
});

describe('ACL-24/25/26 nečlan, onemogućeni, član drugog kućanstva', () => {
  const actors: [string, string][] = [
    ['ACL-24 treći valjani UID', UID_C],
    ['ACL-25 enabled:false', UID_OFF],
    ['ACL-26 član DRUGOG kućanstva', UID_OTHER],
  ];
  for (const [label, uid] of actors) {
    it(`${label}: get/list/create/update/delete na SVIM P2 putanjama DENY`, async () => {
      const db = as(env, uid);
      for (const [c, id] of READABLE) await assertFails(getDoc(D(db, `${c}/${id}`)));
      for (const c of LISTABLE) await assertFails(getDocs(C(db, c)));
      await assertFails(setDoc(D(db, 'items/ghost'), validItem(uid)));
      await assertFails(setDoc(D(db, 'locations/ghost'), validLoc(uid)));
      await assertFails(
        updateDoc(D(db, 'items/hammer'), {
          name: 'x',
          version: 2,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        }),
      );
      await assertFails(
        updateDoc(D(db, 'locations/garage-box'), {
          name: 'x',
          version: 2,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        }),
      );
      await assertFails(updateDoc(D(db, 'meta/tree'), { rev: 1 }));
      await assertFails(deleteDoc(D(db, 'placementKeys/hammer__unique')));
      // referentni protokol (D5): nečlan/opozvani dobiva access-revoked, a ne sukob
      await expect(
        addPlacement(db, uid, { id: 'pl-ghost', itemId: 'hammer', locationId: 'garage-box' }),
      ).rejects.toMatchObject({ code: 'access-revoked' });
      await expect(moveLocation(db, uid, 'garage-box', 'living-tv')).rejects.toMatchObject({
        code: 'access-revoked',
      });
    });
  }
  it('ACL-26 član drugog kućanstva ne može ni "kopirati" tuđe dokumente u svoje (reference su ograničene na isto kućanstvo)', async () => {
    const db = as(env, UID_OTHER);
    // svoje kućanstvo: nema stavki pa smještaj koji referencira item iz demo-house ne može nastati
    await assertFails(
      setDoc(doc(db, 'households/other-house/placements/pl-x'), {
        itemId: 'hammer',
        locationId: 'garage-box',
        ...audit(UID_OTHER),
      }),
    );
    // čitanje istog ID-a u SVOM kućanstvu je dopušteno, ali ne vraća ništa (nema curenja između kućanstava)
    const mine = await assertSucceeds(getDoc(doc(db, 'households/other-house/items/hammer')));
    expect(mine.exists()).toBe(false);
  });
  it('opoziv tijekom rada: nakon enabled:false odmah DENY na čitanje i upis, B i dalje ALLOW', async () => {
    await assertSucceeds(getDoc(D(as(env, UID_A), 'items/hammer')));
    await env.withSecurityRulesDisabled(
      async (c) =>
        void (await updateDoc(doc(c.firestore(), `households/${H}/members/${UID_A}`), {
          enabled: false,
        })),
    );
    await assertFails(getDoc(D(as(env, UID_A), 'items/hammer')));
    await expect(renameItem(as(env, UID_A), UID_A, 'hammer', 'x', 1)).rejects.toMatchObject({
      code: 'access-revoked',
    });
    await assertFails(getDocs(C(as(env, UID_A), 'locations')));
    await assertSucceeds(renameItem(as(env, UID_B), UID_B, 'hammer', 'Čekić B', 1));
  });
});

describe('ACL-27/28 članstvo, kućanstvo, appliedOps, nepoznate putanje', () => {
  it('ACL-27 A ne može mijenjati members, role, enabled ni household (P1 ostaje netaknut)', async () => {
    const db = as(env, UID_A);
    await assertFails(updateDoc(D(db, `members/${UID_A}`), { role: 'owner' }));
    await assertFails(updateDoc(D(db, `members/${UID_B}`), { enabled: false }));
    await assertFails(
      setDoc(D(db, `members/${UID_C}`), { uid: UID_C, role: 'member', enabled: true }),
    );
    await assertFails(deleteDoc(D(db, `members/${UID_A}`)));
    await assertFails(getDocs(C(db, 'members')));
    await assertFails(getDoc(D(db, `members/${UID_B}`)));
    await assertFails(updateDoc(doc(db, `households/${H}`), { name: 'Hakirano' }));
    await assertFails(deleteDoc(doc(db, `households/${H}`)));
  });
  it('ACL-28 appliedOps i nepoznate putanje: čitanje i pisanje DENY', async () => {
    const db = as(env, UID_A);
    for (const p of [
      'appliedOps/op1',
      'secrets/x',
      'users/uidA',
      'items/hammer/extra/x',
      'meta/other',
      'meta/tree/sub/x',
    ]) {
      await assertFails(getDoc(D(db, p)));
      await assertFails(setDoc(D(db, p), { x: 1 }));
    }
    await assertFails(getDocs(C(db, 'appliedOps')));
  });
  it('meta/tree: samo rev+1, bez drugih polja, bez brisanja, ne može se "resetirati"', async () => {
    const db = as(env, UID_A);
    await assertFails(updateDoc(D(db, 'meta/tree'), { rev: 0 }));
    await assertFails(updateDoc(D(db, 'meta/tree'), { rev: 5 }));
    await assertFails(updateDoc(D(db, 'meta/tree'), { rev: 1, extra: true }));
    await assertFails(deleteDoc(D(db, 'meta/tree')));
    await assertSucceeds(updateDoc(D(db, 'meta/tree'), { rev: 1 }));
  });
});

describe('ACL-29/30 neodobrena polja, pogrešni tipovi, zaobilaženje version/audit', () => {
  const ok = (uid = UID_A) => validItem(uid);
  it('create predmeta: svaka od ovih povreda je odbijena', async () => {
    const db = as(env, UID_A);
    const cases: Record<string, object> = {
      'dodatno polje': { ...ok(), tajno: 1 },
      'nedostaje polje': Object.fromEntries(Object.entries(ok()).filter(([k]) => k !== 'note')),
      'version != 1': { ...ok(), version: 7 },
      'archived true': { ...ok(), archived: true },
      'createdBy tuđi': { ...ok(), createdBy: UID_B, updatedBy: UID_B },
      'createdAt klijentsko': { ...ok(), createdAt: new Date('2001-01-01') },
      'name broj': { ...ok(), name: 5 },
      'aliases string': { ...ok(), aliases: 'busilica' },
      'aliases > 20': { ...ok(), aliases: Array(21).fill('a') },
      'kind nepoznat': { ...ok(), kind: 'x' },
      'category predug': { ...ok(), category: 'c'.repeat(61) },
      'quantity (nije u P2)': { ...ok(), quantity: 3 },
    };
    for (const [name, data] of Object.entries(cases)) {
      await assertFails(
        setDoc(D(db, `items/neg-${name.replace(/[^a-z]/gi, '').toLowerCase()}`), data),
      );
      expect(name).toBeTruthy();
    }
    await assertSucceeds(setDoc(D(db, 'items/pos-ok'), ok()));
  });
  it('update lokacije/predmeta: zaobilaženje version, updatedBy, createdBy, kind je odbijeno', async () => {
    const db = as(env, UID_A);
    const now = { updatedAt: serverTimestamp() };
    await assertFails(
      updateDoc(D(db, 'items/hammer'), { name: 'x', version: 1, ...now, updatedBy: UID_A }),
    ); // isti version
    await assertFails(
      updateDoc(D(db, 'items/hammer'), { name: 'x', version: 3, ...now, updatedBy: UID_A }),
    ); // preskok
    await assertFails(
      updateDoc(D(db, 'items/hammer'), { name: 'x', version: 2, ...now, updatedBy: UID_B }),
    ); // tuđi updatedBy
    await assertFails(
      updateDoc(D(db, 'items/hammer'), {
        name: 'x',
        version: 2,
        ...now,
        updatedBy: UID_A,
        createdBy: UID_A,
      }),
    ); // createdBy
    await assertFails(
      updateDoc(D(db, 'items/hammer'), {
        name: 'x',
        version: 2,
        ...now,
        updatedBy: UID_A,
        kind: 'type',
      }),
    ); // kind
    await assertFails(
      updateDoc(D(db, 'items/hammer'), {
        name: 'x',
        version: 2,
        updatedAt: new Date(),
        updatedBy: UID_A,
      }),
    ); // klijentsko vrijeme
    await assertSucceeds(
      updateDoc(D(db, 'items/hammer'), { name: 'x', version: 2, ...now, updatedBy: UID_A }),
    );
  });
  it('batch koji miješa dopuštene i nedopuštene operacije se odbija u cijelosti (atomarno)', async () => {
    const db = as(env, UID_A);
    const b = writeBatch(db);
    b.set(D(db, 'items/good-one'), validItem(UID_A));
    b.set(D(db, 'items/bad-one'), { ...validItem(UID_A), tajno: 1 });
    await assertFails(b.commit());
    expect((await getDoc(D(db, 'items/good-one'))).exists()).toBe(false);
  });
});

describe('ACL-31 testovi imaju zube: namjerno pokvarena pravila MORAJU oboriti sigurnosne provjere', () => {
  const original = readFileSync('firestore.rules', 'utf8');
  interface Mutation {
    name: string;
    mutate: (r: string) => string;
    probe: (e: RulesTestEnvironment) => Promise<unknown>;
  }
  const rawReparent = (e: RulesTestEnvironment, id: string, parent: string, bump = true) => {
    const db = as(e, UID_A);
    const b = writeBatch(db);
    b.update(D(db, `locations/${id}`), {
      parentId: parent,
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: UID_A,
    });
    if (bump) b.update(D(db, 'meta/tree'), { rev: 1 });
    return b.commit();
  };
  const mutations: Mutation[] = [
    {
      name: 'M1 enabled se ignorira',
      mutate: (r) => r.replace(".data.get('enabled', false) == true", '.data != null'),
      probe: (e) => getDoc(D(as(e, UID_OFF), 'items/hammer')),
    },
    {
      name: 'M2 čitanje lokacija otvoreno svima',
      mutate: (r) =>
        r.replace(
          /(match \/locations\/\{locationId\} \{\s*allow get, list: if )isActiveMember\(householdId\)/,
          '$1true',
        ),
      probe: (e) => getDocs(C(as(e, UID_C), 'locations')),
    },
    {
      name: 'M3 create predmeta za svakog prijavljenog',
      mutate: (r) =>
        r.replace(
          'allow create: if isActiveMember(householdId) && validId(itemId)',
          'allow create: if request.auth != null && validId(itemId)',
        ),
      probe: (e) => setDoc(D(as(e, UID_C), 'items/intruder'), validItem(UID_C)),
    },
    {
      name: 'M4 version+1 se ne provjerava',
      mutate: (r) => r.replace('&& n.version == o.version + 1', ''),
      probe: (e) =>
        updateDoc(D(as(e, UID_A), 'items/hammer'), {
          name: 'x',
          version: 9,
          updatedAt: serverTimestamp(),
          updatedBy: UID_A,
        }),
    },
    {
      name: 'M5 meta/tree CAS izbačen iz premještanja',
      mutate: (r) => r.replace('&& treeBumped(h)))', '))'),
      probe: (e) => rawReparent(e, 'garage-box', 'living-tv', false),
    },
    {
      name: 'M6 provjera ciklusa izbačena',
      mutate: (r) => r.replace('noCycle(h, id, n.parentId)', 'true'),
      probe: (e) => rawReparent(e, 'garage-rack', 'garage-box'),
    },
    {
      name: 'M7 ključevi se smiju prepisivati (update)',
      mutate: (r) =>
        r.replace(
          'allow delete: if isActiveMember(householdId) && validKeyDelete(householdId, resource.data);',
          'allow update: if isActiveMember(householdId);\n        allow delete: if isActiveMember(householdId) && validKeyDelete(householdId, resource.data);',
        ),
      probe: (e) => {
        const db = as(e, UID_A);
        const b = writeBatch(db);
        b.set(D(db, 'placements/pl-dup'), {
          itemId: 'battery',
          locationId: 'living-drawer',
          ...audit(UID_A),
        });
        b.set(D(db, 'placementKeys/battery__at__living-drawer'), {
          placementId: 'pl-dup',
          itemId: 'battery',
          locationId: 'living-drawer',
        });
        return b.commit();
      },
    },
    {
      name: 'M8 smještaj ne mora imati ključ',
      mutate: (r) =>
        r.replace(
          /&& getAfter\(keyP\(h, keyIdFor\(getAfter\(itemP\(h, d\.itemId\)\)\.data\.kind, d\.itemId, d\.locationId\)\)\)\.data\.placementId == id;/,
          ';',
        ),
      probe: (e) =>
        setDoc(D(as(e, UID_A), 'placements/pl-nokey'), {
          itemId: 'battery',
          locationId: 'kitchen-drawer',
          ...audit(UID_A),
        }),
    },
    {
      name: 'M9 appliedOps otvoren',
      mutate: (r) =>
        r.replace(
          '// appliedOps (P3) i sve ostalo: bez pravila => DENY.',
          'match /appliedOps/{opId} { allow read, write: if isActiveMember(householdId); }',
        ),
      probe: (e) => setDoc(D(as(e, UID_A), 'appliedOps/op1'), { x: 1 }),
    },
    {
      name: 'M10 članovi se smiju pisati',
      mutate: (r) =>
        r.replace(
          'allow get: if isActiveMember(householdId) && request.auth.uid == uid;',
          'allow get, write: if isActiveMember(householdId);',
        ),
      probe: (e) => updateDoc(D(as(e, UID_A), `members/${UID_A}`), { role: 'owner' }),
    },
    {
      name: 'M11 Location.kind se smije mijenjati',
      mutate: (r) =>
        r.replace(/(function validLocationUpdate[\s\S]*?)&& n\.kind == o\.kind\s*\n/, '$1'),
      probe: (e) =>
        updateDoc(D(as(e, UID_A), 'locations/garage-box'), {
          kind: 'shelf',
          version: 2,
          updatedAt: serverTimestamp(),
          updatedBy: UID_A,
        }),
    },
    {
      name: 'M12 prostorije se smiju premještati',
      mutate: (r) => r.replace("o.kind != 'room' && ", ''),
      probe: (e) => rawReparent(e, 'kitchen', 'living'),
    },
    {
      name: 'M13 Location se smije arhivirati',
      mutate: (r) =>
        r.replace(/(function validLocationUpdate[\s\S]*?)\n\s*&& n\.archived == o\.archived/, '$1'),
      probe: (e) =>
        updateDoc(D(as(e, UID_A), 'locations/garage-box'), {
          archived: true,
          version: 2,
          updatedAt: serverTimestamp(),
          updatedBy: UID_A,
        }),
    },
    {
      name: 'M14 Item se smije arhivirati',
      mutate: (r) =>
        r.replace(
          /(function validItemUpdate[\s\S]*?&& n\.kind == o\.kind)\s*\n\s*&& n\.archived == o\.archived;/,
          '$1;',
        ),
      probe: (e) =>
        updateDoc(D(as(e, UID_A), 'items/hammer'), {
          archived: true,
          version: 2,
          updatedAt: serverTimestamp(),
          updatedBy: UID_A,
        }),
    },
    {
      name: 'M15 kind=house smije imati i ne-root lokacija',
      mutate: (r) => r.replace("d.kind != 'house' && validId(d.parentId)", 'validId(d.parentId)'),
      probe: (e) =>
        createLocation(as(e, UID_A), UID_A, {
          id: 'house2',
          name: 'Druga',
          parentId: 'root',
          kind: 'house',
        }),
    },
    {
      name: 'M16 root smije biti drugog kinda od house',
      mutate: (r) => r.replace("(d.parentId == null && d.kind == 'house')", 'd.parentId == null'),
      probe: async (e) => {
        await e.withSecurityRulesDisabled(
          async (c) => void (await deleteDoc(doc(c.firestore(), `households/${H}/locations/root`))),
        );
        return setDoc(D(as(e, UID_A), 'locations/root'), {
          name: 'Kuća',
          parentId: null,
          kind: 'room',
          ...audit(UID_A),
        });
      },
    },
    {
      name: 'M17 prostorija smije imati roditelja koji nije root',
      mutate: (r) => r.replace(/\n\s*&& \(d\.kind != 'room' \|\| d\.parentId == 'root'\)/, ''),
      probe: (e) =>
        setDoc(D(as(e, UID_A), 'locations/room-in-cabinet'), {
          name: 'Soba u ormaru',
          parentId: 'garage-tool',
          kind: 'room',
          ...audit(UID_A),
        }),
    },
  ];

  it('kontrola: originalna pravila odbijaju sve probe (inače bi mutacije bile besmislene)', async () => {
    for (const m of mutations) await assertFails(m.probe(env));
  });
  for (const m of mutations) {
    it(`${m.name}: sa slomljenim pravilom proba USPIJEVA => sigurnosni test bi PAO`, async () => {
      const broken = m.mutate(original);
      expect(broken, 'mutacija mora stvarno promijeniti pravila').not.toBe(original);
      const menv = await newEnv('demo-home-inventory-mut', broken);
      try {
        await seedDemoHouse(menv);
        await expect(assertFails(m.probe(menv))).rejects.toThrow(); // assertFails baca jer je operacija prošla
      } finally {
        await menv.cleanup();
      }
    });
  }
});
