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
import {
  H,
  UID_A,
  UID_B,
  adminRead,
  as,
  keyIdFor,
  newEnv,
  outcome,
  seedDemoHouse,
} from './helpers';
import {
  addPlacement,
  archiveItem,
  archivePlacement,
  createItem,
  movePlacement,
  renameItem,
} from './ops';

let env: RulesTestEnvironment;
beforeAll(async () => void (env = await newEnv()));
afterAll(async () => env.cleanup());
beforeEach(async () => seedDemoHouse(env));

const P = (db: ReturnType<typeof as>, id: string) => doc(db, `households/${H}/placements/${id}`);
const K = (db: ReturnType<typeof as>, id: string) => doc(db, `households/${H}/placementKeys/${id}`);
const I = (db: ReturnType<typeof as>, id: string) => doc(db, `households/${H}/items/${id}`);
const stamp = (extra: object) => ({
  version: 1,
  archived: false,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  createdBy: UID_A,
  updatedBy: UID_A,
  ...extra,
});
const keyDocs = () =>
  adminRead(env, async (db) =>
    (await getDocs(collection(db, `households/${H}/placementKeys`))).docs.map((d) => d.id).sort(),
  );
const placementOf = (id: string) =>
  adminRead(env, async (db) => (await getDoc(P(db as never, id))).data());

describe('MD-09 / MD-13 vrsta (type) na više lokacija; premještaj samo odabranog smještaja', () => {
  it('MD-09 baterije imaju dva zasebna smještaja (fixture)', async () => {
    const db = as(env, UID_A);
    const snap = await getDocs(collection(db, `households/${H}/placements`));
    expect(
      snap.docs
        .filter((d) => d.data().itemId === 'battery')
        .map((d) => d.id)
        .sort(),
    ).toEqual(['pl-battery-1', 'pl-battery-2']);
  });
  it('scenarij 4 / MD-13: premjesti SAMO pl-battery-2; pl-battery-1 ostaje bit-po-bit isti', async () => {
    const db = as(env, UID_A);
    const before = JSON.stringify(await placementOf('pl-battery-1'));
    await assertSucceeds(movePlacement(db, UID_A, 'pl-battery-2', 'kitchen-drawer', 1));
    expect((await placementOf('pl-battery-2'))!.locationId).toBe('kitchen-drawer');
    expect((await placementOf('pl-battery-2'))!.version).toBe(2);
    expect(JSON.stringify(await placementOf('pl-battery-1'))).toBe(before);
    const keys = await keyDocs();
    expect(keys).toContain('battery__at__kitchen-drawer');
    expect(keys).not.toContain('battery__at__garage-box'); // stari ključ pušten
    expect(keys).toContain('battery__at__living-drawer'); // netaknut
  });
});

describe('MD-11 / scenarij 5: duplikat (itemId, locationId)', () => {
  it('scenarij 5: baterije još jednom u living-drawer => klijent blokira i SERVER odbija sirovi upis', async () => {
    const db = as(env, UID_A);
    await expect(
      addPlacement(db, UID_A, { id: 'pl-dup', itemId: 'battery', locationId: 'living-drawer' }),
    ).rejects.toMatchObject({ code: 'duplicate-placement' });
    // zaobilazni upis: batch koji pokušava "ponovno stvoriti" postojeći ključ (= update) + novi smještaj
    const b = writeBatch(db);
    b.set(P(db, 'pl-dup'), stamp({ itemId: 'battery', locationId: 'living-drawer' }));
    b.set(K(db, 'battery__at__living-drawer'), {
      placementId: 'pl-dup',
      itemId: 'battery',
      locationId: 'living-drawer',
    });
    await assertFails(b.commit());
    expect(await placementOf('pl-dup')).toBeUndefined();
  });
  it('smještaj BEZ ključa je odbijen (nema načina da zaobiđe zaključavanje)', async () => {
    const db = as(env, UID_A);
    await assertFails(
      setDoc(P(db, 'pl-nokey'), stamp({ itemId: 'battery', locationId: 'kitchen-drawer' })),
    );
  });
  it('ključ koji pokazuje na tuđi smještaj ne prolazi', async () => {
    const db = as(env, UID_A);
    const b = writeBatch(db);
    b.set(P(db, 'pl-new'), stamp({ itemId: 'battery', locationId: 'kitchen-drawer' }));
    b.set(K(db, 'battery__at__kitchen-drawer'), {
      placementId: 'pl-battery-1',
      itemId: 'battery',
      locationId: 'kitchen-drawer',
    });
    await assertFails(b.commit());
  });
  it('sirotinjski ključ (bez smještaja) i ključ za pogrešnu lokaciju su odbijeni', async () => {
    const db = as(env, UID_A);
    await assertFails(
      setDoc(K(db, 'battery__at__bathroom-cabinet'), {
        placementId: 'ne-postoji',
        itemId: 'battery',
        locationId: 'bathroom-cabinet',
      }),
    );
    const b = writeBatch(db);
    b.set(P(db, 'pl-x'), stamp({ itemId: 'battery', locationId: 'bathroom-cabinet' }));
    b.set(K(db, 'battery__at__hall-cabinet'), {
      placementId: 'pl-x',
      itemId: 'battery',
      locationId: 'hall-cabinet',
    });
    await assertFails(b.commit());
  });
  it('ključ se ne može obrisati dok smještaj još zauzima mjesto', async () => {
    await assertFails(deleteDoc(K(as(env, UID_A), 'battery__at__living-drawer')));
  });
  it('ključ se ne može mijenjati (update zabranjen), ni pročitati list-om', async () => {
    const db = as(env, UID_A);
    await assertFails(
      updateDoc(K(db, 'battery__at__living-drawer'), { placementId: 'pl-battery-2' }),
    );
    await assertFails(getDocs(collection(db, `households/${H}/placementKeys`)));
    await assertSucceeds(getDoc(K(db, 'battery__at__living-drawer')));
  });
  it('premještaj type smještaja na lokaciju gdje već postoji isti item je odbijen (klijent i server)', async () => {
    const db = as(env, UID_A);
    await expect(
      movePlacement(db, UID_A, 'pl-battery-2', 'living-drawer', 1),
    ).rejects.toMatchObject({ code: 'duplicate-placement' });
    const b = writeBatch(db);
    b.update(P(db, 'pl-battery-2'), {
      locationId: 'living-drawer',
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: UID_A,
    });
    b.delete(K(db, 'battery__at__garage-box'));
    b.set(K(db, 'battery__at__living-drawer'), {
      placementId: 'pl-battery-2',
      itemId: 'battery',
      locationId: 'living-drawer',
    });
    await assertFails(b.commit());
  });
});

describe('MD-10 unique predmet: najviše jedan aktivan smještaj', () => {
  it('drugi smještaj jedinstvenog predmeta na DRUGOJ lokaciji je odbijen (klijent i server)', async () => {
    const db = as(env, UID_A);
    await expect(
      addPlacement(db, UID_A, { id: 'pl-drill-2', itemId: 'aku-drill', locationId: 'garage-box' }),
    ).rejects.toMatchObject({ code: 'duplicate-placement' });
    const b = writeBatch(db);
    b.set(P(db, 'pl-drill-2'), stamp({ itemId: 'aku-drill', locationId: 'garage-box' }));
    b.set(K(db, 'aku-drill__unique'), { placementId: 'pl-drill-2', itemId: 'aku-drill' }); // update postojećeg => odbijen
    await assertFails(b.commit());
    // pokušaj s "type" oblikom ključa za unique predmet također ne prolazi
    const c = writeBatch(db);
    c.set(P(db, 'pl-drill-3'), stamp({ itemId: 'aku-drill', locationId: 'garage-box' }));
    c.set(K(db, 'aku-drill__at__garage-box'), {
      placementId: 'pl-drill-3',
      itemId: 'aku-drill',
      locationId: 'garage-box',
    });
    await assertFails(c.commit());
  });
  it('premještaj jedinstvenog predmeta ostaje jedan smještaj i ključ se ne mijenja', async () => {
    const db = as(env, UID_A);
    await assertSucceeds(movePlacement(db, UID_A, 'pl-aku-drill-1', 'bedroom-top', 1));
    expect((await placementOf('pl-aku-drill-1'))!.locationId).toBe('bedroom-top');
    const keys = await keyDocs();
    expect(keys.filter((k) => k.startsWith('aku-drill'))).toEqual(['aku-drill__unique']);
  });
  it('arhiviranjem smještaja oslobađa se ključ pa se unique može ponovno smjestiti', async () => {
    const db = as(env, UID_A);
    await assertSucceeds(archivePlacement(db, UID_A, 'pl-aku-drill-1', 1));
    expect(await keyDocs()).not.toContain('aku-drill__unique');
    await assertSucceeds(
      addPlacement(db, UID_A, {
        id: 'pl-drill-new',
        itemId: 'aku-drill',
        locationId: 'bathroom-cabinet',
      }),
    );
    expect((await placementOf('pl-drill-new'))!.archived).toBe(false);
  });
});

describe('MD-12 reference, MD-14 nepromjenjivost, ACL-29/30 oblik', () => {
  it('nepostojeći itemId ili locationId => odbijeno', async () => {
    const db = as(env, UID_A);
    for (const [item, loc] of [
      ['ne-postoji', 'garage-box'],
      ['battery', 'ne-postoji'],
    ] as const) {
      const b = writeBatch(db);
      b.set(P(db, 'pl-bad'), stamp({ itemId: item, locationId: loc }));
      b.set(K(db, `${item}__at__${loc}`), { placementId: 'pl-bad', itemId: item, locationId: loc });
      await assertFails(b.commit());
    }
  });
  it('smještaj u/na arhiviranu lokaciju ili arhivirani predmet je odbijen', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await updateDoc(doc(c.firestore(), `households/${H}/locations/hall-cabinet`), {
        archived: true,
      });
      await updateDoc(doc(c.firestore(), `households/${H}/items/hammer`), { archived: true });
    });
    const db = as(env, UID_A);
    expect(
      await outcome(
        addPlacement(db, UID_A, { id: 'pl-1', itemId: 'battery', locationId: 'hall-cabinet' }),
      ),
    ).not.toBe('OK');
    expect(
      await outcome(
        addPlacement(db, UID_A, { id: 'pl-2', itemId: 'hammer', locationId: 'kitchen-drawer' }),
      ),
    ).not.toBe('OK');
  });
  it('injekcija putanje u itemId/locationId je odbijena', async () => {
    const db = as(env, UID_A);
    const b = writeBatch(db);
    b.set(P(db, 'pl-inj'), stamp({ itemId: 'battery/../hammer', locationId: 'garage-box' }));
    b.set(K(db, 'battery__at__garage-box'), {
      placementId: 'pl-inj',
      itemId: 'battery',
      locationId: 'garage-box',
    });
    await assertFails(b.commit());
  });
  it('itemId je nepromjenjiv; količina i ostala nepoznata polja nisu dopuštena u P2', async () => {
    const db = as(env, UID_A);
    await assertFails(
      updateDoc(P(db, 'pl-battery-2'), {
        itemId: 'hammer',
        version: 2,
        updatedAt: serverTimestamp(),
        updatedBy: UID_A,
        locationId: 'kitchen-drawer',
      }),
    );
    await assertFails(
      updateDoc(P(db, 'pl-battery-2'), {
        quantity: 5,
        version: 2,
        updatedAt: serverTimestamp(),
        updatedBy: UID_A,
      }),
    );
    await assertFails(
      updateDoc(P(db, 'pl-battery-2'), {
        createdBy: UID_B,
        version: 2,
        updatedAt: serverTimestamp(),
        updatedBy: UID_A,
      }),
    );
  });
  it('premještaj i arhiviranje u istom upisu, ili upis bez ikakve promjene, su odbijeni', async () => {
    const db = as(env, UID_A);
    await assertFails(
      updateDoc(P(db, 'pl-battery-2'), {
        version: 2,
        updatedAt: serverTimestamp(),
        updatedBy: UID_A,
      }),
    );
    await assertFails(
      updateDoc(P(db, 'pl-battery-2'), {
        locationId: 'kitchen-drawer',
        archived: true,
        version: 2,
        updatedAt: serverTimestamp(),
        updatedBy: UID_A,
      }),
    );
  });
  it('arhivirani smještaj se ne može vratiti ni premjestiti (jednosmjerno; novi smještaj umjesto toga)', async () => {
    const db = as(env, UID_A);
    await archivePlacement(db, UID_A, 'pl-battery-2', 1);
    await assertFails(
      updateDoc(P(db, 'pl-battery-2'), {
        archived: false,
        version: 3,
        updatedAt: serverTimestamp(),
        updatedBy: UID_A,
      }),
    );
    await assertFails(
      updateDoc(P(db, 'pl-battery-2'), {
        locationId: 'hall-cabinet',
        version: 3,
        updatedAt: serverTimestamp(),
        updatedBy: UID_A,
      }),
    );
  });
  it('arhiviranje smještaja bez brisanja ključa je odbijeno (ključ mora nestati)', async () => {
    const db = as(env, UID_A);
    await assertFails(
      updateDoc(P(db, 'pl-battery-2'), {
        archived: true,
        version: 2,
        updatedAt: serverTimestamp(),
        updatedBy: UID_A,
      }),
    );
  });
  it('nema tvrdog brisanja smještaja', async () => {
    await assertFails(deleteDoc(P(as(env, UID_A), 'pl-battery-2')));
  });
});

describe('Item: kind, arhiviranje, MD-18 (jedinstveni predmet)', () => {
  it('stvaranje novog predmeta s propisanim poljima; naziv + vrsta obavezni', async () => {
    await assertSucceeds(
      createItem(as(env, UID_A), UID_A, { id: 'new-item', name: 'Novi predmet', kind: 'type' }),
    );
    const db = as(env, UID_A);
    await assertFails(
      setDoc(
        I(db, 'bad-kind'),
        stamp({ name: 'X', kind: 'gadget', aliases: [], category: null, note: null }),
      ),
    );
    await assertFails(
      setDoc(
        I(db, 'bad-name'),
        stamp({ name: '', kind: 'type', aliases: [], category: null, note: null }),
      ),
    );
    await assertFails(
      setDoc(I(db, 'no-aliases'), stamp({ name: 'X', kind: 'type', category: null, note: null })),
    );
    await assertFails(
      setDoc(
        I(db, 'many-aliases'),
        stamp({
          name: 'X',
          kind: 'type',
          aliases: Array(21).fill('a'),
          category: null,
          note: null,
        }),
      ),
    );
    await assertFails(
      setDoc(
        I(db, 'long-note'),
        stamp({ name: 'X', kind: 'type', aliases: [], category: null, note: 'n'.repeat(1001) }),
      ),
    );
    await assertFails(
      setDoc(
        I(db, 'Bad_ID'),
        stamp({ name: 'X', kind: 'type', aliases: [], category: null, note: null }),
      ),
    );
  });
  it('kind se ne može promijeniti (ključevi ovise o njemu)', async () => {
    await assertFails(
      updateDoc(I(as(env, UID_A), 'battery'), {
        kind: 'unique',
        version: 2,
        updatedAt: serverTimestamp(),
        updatedBy: UID_A,
      }),
    );
  });
  it('uređivanje naziva ne dira smještaje (Edit nema polje lokacije)', async () => {
    const before = JSON.stringify(await placementOf('pl-battery-1'));
    await assertSucceeds(renameItem(as(env, UID_A), UID_A, 'battery', 'AA baterije (kutija)', 1));
    expect(JSON.stringify(await placementOf('pl-battery-1'))).toBe(before);
  });
  it('D2: arhiviranje predmeta je ZABRANJENO na serveru (unique i type, sa i bez smještaja); archived se ne može promijeniti ni natrag', async () => {
    const db = as(env, UID_A);
    await assertFails(archiveItem(db, UID_A, 'aku-drill', 1)); // unique sa smještajem
    await assertFails(archiveItem(db, UID_A, 'battery', 1)); // type sa smještajima
    await archivePlacement(db, UID_A, 'pl-aku-drill-1', 1);
    await assertFails(archiveItem(db, UID_A, 'aku-drill', 1)); // unique BEZ smještaja — i dalje zabranjeno
    await assertFails(
      updateDoc(I(db, 'hammer'), {
        archived: true,
        version: 2,
        updatedAt: serverTimestamp(),
        updatedBy: UID_A,
      }),
    );
    // arhiviran od strane admina (npr. ručni zahvat): klijent ga ne može vratiti
    await env.withSecurityRulesDisabled(
      async (c) =>
        void (await updateDoc(doc(c.firestore(), `households/${H}/items/hex-keys`), {
          archived: true,
        })),
    );
    await assertFails(
      updateDoc(I(db, 'hex-keys'), {
        archived: false,
        version: 2,
        updatedAt: serverTimestamp(),
        updatedBy: UID_A,
      }),
    );
    // uređivanje naziva i dalje radi
    await assertSucceeds(renameItem(db, UID_A, 'battery', 'AA baterije', 1));
  });
  it('keyIdFor pomoćnik je u skladu s pravilima', () => {
    expect(keyIdFor('unique', 'a', 'b')).toBe('a__unique');
    expect(keyIdFor('type', 'a', 'b')).toBe('a__at__b');
  });
});
