import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  doc,
  getDoc,
  getDocs,
  collection,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  increment,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { H, UID_A, UID_B, adminRead, as, fixture, newEnv, outcome, seedDemoHouse } from './helpers';
import { createLocation, moveLocation } from './ops';

let env: RulesTestEnvironment;
beforeAll(async () => void (env = await newEnv()));
afterAll(async () => env.cleanup());
beforeEach(async () => seedDemoHouse(env));

const loc = (db: ReturnType<typeof as>, id: string) => doc(db, `households/${H}/locations/${id}`);
const parentOf = (id: string) =>
  adminRead(env, async (db) => (await getDoc(loc(db, id))).data()!.parentId as string | null);
const version = (id: string) =>
  adminRead(env, async (db) => (await getDoc(loc(db, id))).data()!.version as number);
const rev = () =>
  adminRead(
    env,
    async (db) => (await getDoc(doc(db, `households/${H}/meta/tree`))).data()!.rev as number,
  );

describe('MD-01/02 stablo lokacija (demo kuća)', () => {
  it('MD-01 točno jedan root, svaki parent postoji, svaka lokacija doseže root', async () => {
    const byId = new Map(fixture.locations.map((l) => [l.id, l]));
    expect(fixture.locations.filter((l) => l.parentId === null).map((l) => l.id)).toEqual(['root']);
    for (const l of fixture.locations) {
      let cur: string | null = l.id;
      let steps = 0;
      while (cur) {
        cur = byId.get(cur)!.parentId;
        if (++steps > 50) throw new Error('ciklus u fixtureu');
      }
    }
    expect(fixture.locations.length).toBeGreaterThanOrEqual(7);
  });
  it('MD-02 dvije "Ladica 1" u različitim ormarima su dopuštene (naziv nije jedinstven)', async () => {
    const same = fixture.locations.filter((l) => l.name === 'Ladica 1');
    expect(same.map((l) => l.parentId).sort()).toEqual(['kitchen', 'living-tv']);
    const db = as(env, UID_A);
    await assertSucceeds(
      createLocation(db, UID_A, {
        id: 'garage-drawer',
        name: 'Ladica 1',
        parentId: 'garage-tool',
        kind: 'drawer',
      }),
    );
  });
});

describe('stvaranje lokacije', () => {
  it('član stvara podlokaciju pod aktivnim roditeljem', async () => {
    await assertSucceeds(
      createLocation(as(env, UID_A), UID_A, {
        id: 'new-shelf',
        name: 'Nova polica',
        parentId: 'garage-tool',
        kind: 'shelf',
      }),
    );
  });
  it('nepostojeći roditelj => odbijeno (MD-12 za lokacije)', async () => {
    const r = await outcome(
      createLocation(as(env, UID_A), UID_A, {
        id: 'x1',
        name: 'X',
        parentId: 'ne-postoji',
        kind: 'box',
      }),
    );
    expect(r).not.toBe('OK');
  });
  it('arhivirani roditelj => odbijeno', async () => {
    await env.withSecurityRulesDisabled(
      async (c) => void (await updateDoc(loc(c.firestore(), 'pantry-shelf'), { archived: true })),
    );
    const r = await outcome(
      createLocation(as(env, UID_A), UID_A, {
        id: 'x2',
        name: 'X',
        parentId: 'pantry-shelf',
        kind: 'box',
      }),
    );
    expect(r).not.toBe('OK');
  });
  it('drugi root (parentId null, id != root) i root koji nije kuća su odbijeni', async () => {
    const db = as(env, UID_A);
    const base = {
      version: 1,
      archived: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: UID_A,
      updatedBy: UID_A,
    };
    await assertFails(
      setDoc(loc(db, 'root2'), { ...base, name: 'Drugi root', parentId: null, kind: 'house' }),
    );
    await assertFails(setDoc(loc(db, 'x3'), { ...base, name: 'X', parentId: null, kind: 'box' }));
    // 'root' već postoji => ponovni create je update => odbijen
    await assertFails(
      setDoc(loc(db, 'root'), { ...base, name: 'Kuća 2', parentId: null, kind: 'house' }),
    );
  });
  it('lokacija s roditeljem sebe samog ili nevaljanim ID-em (injekcija putanje) je odbijena', async () => {
    const db = as(env, UID_A);
    const base = {
      name: 'X',
      kind: 'box',
      version: 1,
      archived: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: UID_A,
      updatedBy: UID_A,
    };
    await assertFails(setDoc(loc(db, 'self'), { ...base, parentId: 'self' }));
    await assertFails(setDoc(loc(db, 'inj1'), { ...base, parentId: 'garage/../root' }));
    await assertFails(
      setDoc(loc(db, 'inj2'), { ...base, parentId: `root/placements/pl-aku-drill-1` }),
    );
  });
});

describe('MD-03…07 premještanje lokacija (scenariji 1 i 2 iz fixturea)', () => {
  it('scenarij 1 / MD-03: garage-box pod living-tv i natrag; mijenja se SAMO parentId (+version), sadržaj netaknut', async () => {
    const db = as(env, UID_A);
    const placementsBefore = (await getDocs(collection(db, `households/${H}/placements`))).docs.map(
      (d) => JSON.stringify(d.data()),
    );
    await assertSucceeds(moveLocation(db, UID_A, 'garage-box', 'living-tv'));
    expect(await parentOf('garage-box')).toBe('living-tv');
    expect(await version('garage-box')).toBe(2);
    expect(await rev()).toBe(1);
    await assertSucceeds(moveLocation(db, UID_A, 'garage-box', 'garage-shelf')); // zasebna transakcija: povratak
    expect(await parentOf('garage-box')).toBe('garage-shelf');
    expect(await rev()).toBe(2);
    const placementsAfter = (await getDocs(collection(db, `households/${H}/placements`))).docs.map(
      (d) => JSON.stringify(d.data()),
    );
    expect(placementsAfter).toEqual(placementsBefore); // Item/Placement reference nisu dirnute
  });
  it('MD-04 lokacija u samu sebe: klijent blokira, a server odbija i zaobilazni upis', async () => {
    const db = as(env, UID_A);
    await expect(moveLocation(db, UID_A, 'garage-box', 'garage-box')).rejects.toMatchObject({
      code: 'cycle',
    });
    const b = writeBatch(db);
    b.update(loc(db, 'garage-box'), {
      parentId: 'garage-box',
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: UID_A,
    });
    b.update(doc(db, `households/${H}/meta/tree`), { rev: increment(1) });
    await assertFails(b.commit());
  });
  it('scenarij 2 / MD-05: garage-rack pod garage-box (vlastiti potomak) => ciklus odbijen i klijentom i SERVEROM', async () => {
    const db = as(env, UID_A);
    await expect(moveLocation(db, UID_A, 'garage-rack', 'garage-box')).rejects.toMatchObject({
      code: 'cycle',
    });
    // zaobilazni upis bez klijentske provjere (sirovi batch s ispravnim rev-om): pravila moraju sama odbiti
    const b = writeBatch(db);
    b.update(loc(db, 'garage-rack'), {
      parentId: 'garage-box',
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: UID_A,
    });
    b.update(doc(db, `households/${H}/meta/tree`), { rev: 1 });
    await assertFails(b.commit());
    expect(await parentOf('garage-rack')).toBe('garage');
  });
  it('MD-05 izravni potomak (dijete) i unuk također odbijeni na serveru', async () => {
    const db = as(env, UID_A);
    for (const target of ['garage-shelf', 'garage-box']) {
      const b = writeBatch(db);
      b.update(loc(db, 'garage-rack'), {
        parentId: target,
        version: 2,
        updatedAt: serverTimestamp(),
        updatedBy: UID_A,
      });
      b.update(doc(db, `households/${H}/meta/tree`), { rev: 1 });
      await assertFails(b.commit());
    }
  });
  it('MD-07 premještanje u istog roditelja: klijent ne piše ništa', async () => {
    const db = as(env, UID_A);
    await expect(moveLocation(db, UID_A, 'garage-box', 'garage-shelf')).rejects.toMatchObject({
      code: 'same-parent',
    });
    expect(await version('garage-box')).toBe(1);
    expect(await rev()).toBe(0);
  });
  it('root se ne može premjestiti ni arhivirati', async () => {
    const db = as(env, UID_A);
    const b = writeBatch(db);
    b.update(loc(db, 'root'), {
      parentId: 'kitchen',
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: UID_A,
    });
    b.update(doc(db, `households/${H}/meta/tree`), { rev: 1 });
    await assertFails(b.commit());
    await assertFails(
      updateDoc(loc(db, 'root'), {
        archived: true,
        version: 2,
        updatedAt: serverTimestamp(),
        updatedBy: UID_A,
      }),
    );
  });
  it('premještanje pod arhiviranog roditelja je odbijeno', async () => {
    await env.withSecurityRulesDisabled(
      async (c) => void (await updateDoc(loc(c.firestore(), 'living-tv'), { archived: true })),
    );
    const r = await outcome(moveLocation(as(env, UID_A), UID_A, 'garage-box', 'living-tv'));
    expect(r).not.toBe('OK');
  });
  it('MD-15 premještanje roditelja pa preimenovanje nadređene: nove putanje ispravne (putanja se izvodi, ne sprema)', async () => {
    const db = as(env, UID_A);
    await moveLocation(db, UID_A, 'garage-box', 'living-tv');
    await updateDoc(loc(db, 'living-tv'), {
      name: 'Media ormarić',
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: UID_A,
    });
    const all = new Map<string, { name: string; parentId: string | null }>();
    (await getDocs(collection(db, `households/${H}/locations`))).forEach((d) =>
      all.set(d.id, d.data() as never),
    );
    const path = (id: string): string => {
      const l = all.get(id)!;
      return l.parentId ? `${path(l.parentId)} › ${l.name}` : l.name;
    };
    expect(path('garage-box')).toBe('Kuća › Dnevni boravak › Media ormarić › Kutija B');
    // ni na jednom potomku nije pohranjen tekstualni path
    for (const v of all.values()) expect(Object.keys(v)).not.toContain('path');
  });
});

describe('MD-08 arhiviranje lokacije sa sadržajem', () => {
  it('ZNANO OGRANIČENJE (ADR R-3): server NE sprječava arhiviranje lokacije koja ima potomke/smještaje — to mora blokirati klijent; ništa se ne briše', async () => {
    const db = as(env, UID_A);
    // garage-shelf ima potomka (garage-box) koji ima smještaj (pl-battery-2): Rules ne mogu provjeriti "ima li djece" (nema upita)
    await assertSucceeds(
      updateDoc(loc(db, 'garage-shelf'), {
        archived: true,
        version: 2,
        updatedAt: serverTimestamp(),
        updatedBy: UID_A,
      }),
    );
    expect((await getDoc(loc(db, 'garage-box'))).exists()).toBe(true); // ništa nije obrisano
    expect(
      (await getDoc(doc(db, `households/${H}/placements/pl-battery-2`))).data()!.archived,
    ).toBe(false);
  });
  it('ali: u arhiviranu lokaciju se ne mogu stvarati nove podlokacije ni smještaji (server)', async () => {
    const db = as(env, UID_A);
    await updateDoc(loc(db, 'pantry-shelf'), {
      archived: true,
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: UID_A,
    });
    expect(
      await outcome(
        createLocation(db, UID_A, {
          id: 'late-child',
          name: 'Kasno dijete',
          parentId: 'pantry-shelf',
          kind: 'box',
        }),
      ),
    ).not.toBe('OK');
  });
  it('root se ne može arhivirati (server); vraćanje iz arhive traži aktivnog roditelja', async () => {
    const db = as(env, UID_A);
    await updateDoc(loc(db, 'pantry-shelf'), {
      archived: true,
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: UID_A,
    });
    await updateDoc(loc(db, 'pantry'), {
      archived: true,
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: UID_A,
    });
    // pantry-shelf se ne može vratiti dok je roditelj (pantry) arhiviran
    await assertFails(
      updateDoc(loc(db, 'pantry-shelf'), {
        archived: false,
        version: 3,
        updatedAt: serverTimestamp(),
        updatedBy: UID_A,
      }),
    );
    await assertSucceeds(
      updateDoc(loc(db, 'pantry'), {
        archived: false,
        version: 3,
        updatedAt: serverTimestamp(),
        updatedBy: UID_A,
      }),
    );
    await assertSucceeds(
      updateDoc(loc(db, 'pantry-shelf'), {
        archived: false,
        version: 3,
        updatedAt: serverTimestamp(),
        updatedBy: UID_A,
      }),
    );
  });
});

describe('MD-14 / ACL-29/30 nepromjenjiva i sistemska polja, tipovi', () => {
  const upd = (db: ReturnType<typeof as>, id: string, extra: Record<string, unknown>, v = 2) =>
    updateDoc(loc(db, id), {
      version: v,
      updatedAt: serverTimestamp(),
      updatedBy: UID_A,
      ...extra,
    });
  it('dozvoljeno: preimenovanje s version+1 i serverskim vremenom', async () => {
    await assertSucceeds(upd(as(env, UID_A), 'garage-box', { name: 'Kutija C' }));
  });
  it('odbijeno: createdAt/createdBy promjena, krivi updatedBy, ručno vrijeme', async () => {
    const db = as(env, UID_A);
    await assertFails(
      upd(db, 'garage-box', { createdAt: Timestamp.fromDate(new Date('2001-01-01')) }),
    );
    await assertFails(upd(db, 'garage-box', { createdBy: UID_A }));
    await assertFails(
      updateDoc(loc(db, 'garage-box'), {
        version: 2,
        updatedAt: serverTimestamp(),
        updatedBy: UID_B,
        name: 'x',
      }),
    );
    await assertFails(
      updateDoc(loc(db, 'garage-box'), {
        version: 2,
        updatedAt: Timestamp.fromDate(new Date('2001-01-01')),
        updatedBy: UID_A,
        name: 'x',
      }),
    );
  });
  it('odbijeno: version ne raste za točno 1 (preskok, isti, unatrag, ne-broj)', async () => {
    const db = as(env, UID_A);
    for (const v of [1, 3, 0, 2.5, '2'])
      await assertFails(upd(db, 'garage-box', { name: 'x' }, v as number));
  });
  it('odbijeno: dodatna polja, krivi tipovi, prazno/predugo ime, nepoznat kind, polje id', async () => {
    const db = as(env, UID_A);
    await assertFails(upd(db, 'garage-box', { vlasnik: 'ja' }));
    await assertFails(upd(db, 'garage-box', { id: 'drugi' }));
    await assertFails(upd(db, 'garage-box', { name: 42 }));
    await assertFails(upd(db, 'garage-box', { name: '   ' }));
    await assertFails(upd(db, 'garage-box', { name: ' razmaci ' }));
    await assertFails(upd(db, 'garage-box', { name: 'x'.repeat(121) }));
    await assertFails(upd(db, 'garage-box', { kind: 'svemirski-brod' }));
    await assertFails(upd(db, 'garage-box', { archived: 'false' }));
  });
  it('odbijeno: brisanje lokacije (nema tvrdog brisanja u P2)', async () => {
    await assertFails(
      (await import('firebase/firestore')).deleteDoc(loc(as(env, UID_A), 'garage-box')),
    );
  });
  it('odbijeno: promjena roditelja BEZ meta/tree bump-a ili sa starim rev-om (CAS)', async () => {
    const db = as(env, UID_A);
    await assertFails(upd(db, 'garage-box', { parentId: 'living-tv' })); // bez bump-a
    const b = writeBatch(db);
    b.update(loc(db, 'garage-box'), {
      parentId: 'living-tv',
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: UID_A,
    });
    b.update(doc(db, `households/${H}/meta/tree`), { rev: 5 }); // preskok
    await assertFails(b.commit());
  });
});
