// Istodobne izmjene dvaju korisnika (A i B) – PRAVE transakcije u emulatoru, s barijerom koja prisiljava
// preklapanje (oba čitaju prije nego itko piše). Dokazuje MD-06, MD-10, MD-11, MD-16, MD-17.
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { H, UID_A, UID_B, adminRead, as, barrier, newEnv, outcome, seedDemoHouse } from './helpers';
import { addPlacement, createItem, movePlacement, moveLocation, renameItem } from './ops';

let env: RulesTestEnvironment;
beforeAll(async () => void (env = await newEnv()));
afterAll(async () => env.cleanup());
beforeEach(async () => seedDemoHouse(env));

const loc = (db: ReturnType<typeof as>, id: string) => doc(db, `households/${H}/locations/${id}`);
const get = (path: string) =>
  adminRead(env, async (db) => (await getDoc(doc(db, `households/${H}/${path}`))).data());
async function assertTreeAcyclic() {
  const all = await adminRead(env, async (db) =>
    (await getDocs(collection(db, `households/${H}/locations`))).docs.map(
      (d) => [d.id, d.data().parentId as string | null] as const,
    ),
  );
  const parent = new Map(all);
  for (const [id] of all) {
    let cur: string | null = id;
    let n = 0;
    while (cur) {
      cur = parent.get(cur) ?? null;
      if (++n > 100) throw new Error(`ciklus u stablu kod ${id}`);
    }
  }
}

describe('MD-06 istodobno A pod B i B pod A (različiti uređaji)', () => {
  it('transakcije s prisilnim preklapanjem: točno jedna uspije, druga vidi promjenu i javlja ciklus; stablo ostaje acikilično', async () => {
    const wait = barrier(2);
    const hooks = { afterReads: wait };
    const [ra, rb] = await Promise.all([
      outcome(moveLocation(as(env, UID_A), UID_A, 'garage-rack', 'garage-tool', hooks)),
      outcome(moveLocation(as(env, UID_B), UID_B, 'garage-tool', 'garage-rack', hooks)),
    ]);
    const results = [ra, rb];
    expect(results.filter((r) => r === 'OK')).toHaveLength(1);
    expect(results.filter((r) => r !== 'OK')).toHaveLength(1);
    await assertTreeAcyclic();
    expect((await get('meta/tree'))!.rev).toBe(1); // točno jedna strukturna promjena
    console.log('MD-06 ishodi (A,B):', results);
  });
  it('SIROVI batchevi bez protokola čitanja: oba zasnovana na rev 0 — drugi pada na CAS-u (server serijalizira)', async () => {
    const mk = (uid: string, id: string, parent: string) => {
      const db = as(env, uid);
      const b = writeBatch(db);
      b.update(loc(db, id), {
        parentId: parent,
        version: 2,
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      });
      b.update(doc(db, `households/${H}/meta/tree`), { rev: 1 });
      return b.commit();
    };
    const res = await Promise.all([
      outcome(mk(UID_A, 'garage-rack', 'garage-tool')),
      outcome(mk(UID_B, 'garage-tool', 'garage-rack')),
    ]);
    expect(res.filter((r) => r === 'OK')).toHaveLength(1);
    expect(res.filter((r) => r === 'DENIED')).toHaveLength(1);
    await assertTreeAcyclic();
  });
  it('nepovezane istodobne strukturne promjene se serijaliziraju, ali obje uspiju (retry) — nema gubitka', async () => {
    const wait = barrier(2);
    const hooks = { afterReads: wait };
    const [ra, rb] = await Promise.all([
      outcome(moveLocation(as(env, UID_A), UID_A, 'garage-box', 'living-tv', hooks)),
      outcome(moveLocation(as(env, UID_B), UID_B, 'pantry-box', 'kitchen', hooks)),
    ]);
    expect([ra, rb]).toEqual(['OK', 'OK']);
    expect((await get('locations/garage-box'))!.parentId).toBe('living-tv');
    expect((await get('locations/pantry-box'))!.parentId).toBe('kitchen');
    expect((await get('meta/tree'))!.rev).toBe(2);
    await assertTreeAcyclic();
  });
});

describe('MD-11 / MD-10 paralelno stvaranje smještaja', () => {
  it('MD-11: dva korisnika istodobno dodaju ISTI item na ISTU lokaciju — najviše jedan uspije', async () => {
    const wait = barrier(2);
    const [ra, rb] = await Promise.all([
      outcome(
        addPlacement(
          as(env, UID_A),
          UID_A,
          { id: 'pl-par-a', itemId: 'battery', locationId: 'kitchen-drawer' },
          { afterReads: wait },
        ),
      ),
      outcome(
        addPlacement(
          as(env, UID_B),
          UID_B,
          { id: 'pl-par-b', itemId: 'battery', locationId: 'kitchen-drawer' },
          { afterReads: wait },
        ),
      ),
    ]);
    expect([ra, rb].filter((r) => r === 'OK')).toHaveLength(1);
    const all = await adminRead(env, async (db) =>
      (await getDocs(collection(db, `households/${H}/placements`))).docs.map((d) => d.data()),
    );
    expect(
      all.filter((p) => p.itemId === 'battery' && p.locationId === 'kitchen-drawer' && !p.archived),
    ).toHaveLength(1);
    console.log('MD-11 ishodi (A,B):', [ra, rb]);
  });
  it('MD-11 sirovo: oba bez čitanja ključa (slijepi batch) — drugi pada jer je "create" postojećeg ključa = update', async () => {
    const mk = (uid: string, pid: string) => {
      const db = as(env, uid);
      const b = writeBatch(db);
      b.set(doc(db, `households/${H}/placements/${pid}`), {
        itemId: 'battery',
        locationId: 'hall-cabinet',
        version: 1,
        archived: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: uid,
        updatedBy: uid,
      });
      b.set(doc(db, `households/${H}/placementKeys/battery__at__hall-cabinet`), {
        placementId: pid,
        itemId: 'battery',
        locationId: 'hall-cabinet',
      });
      return b.commit();
    };
    const res = await Promise.all([outcome(mk(UID_A, 'pl-raw-a')), outcome(mk(UID_B, 'pl-raw-b'))]);
    expect(res.filter((r) => r === 'OK')).toHaveLength(1);
    expect(res.filter((r) => r === 'DENIED')).toHaveLength(1);
  });
  it('MD-10: novi UNIQUE predmet smješten istodobno na dvije RAZLIČITE lokacije — najviše jedan uspije', async () => {
    await createItem(as(env, UID_A), UID_A, { id: 'ladder', name: 'Ljestve', kind: 'unique' });
    const wait = barrier(2);
    const [ra, rb] = await Promise.all([
      outcome(
        addPlacement(
          as(env, UID_A),
          UID_A,
          { id: 'pl-ladder-a', itemId: 'ladder', locationId: 'garage-tool' },
          { afterReads: wait },
        ),
      ),
      outcome(
        addPlacement(
          as(env, UID_B),
          UID_B,
          { id: 'pl-ladder-b', itemId: 'ladder', locationId: 'hall-cabinet' },
          { afterReads: wait },
        ),
      ),
    ]);
    expect([ra, rb].filter((r) => r === 'OK')).toHaveLength(1);
    const all = await adminRead(env, async (db) =>
      (await getDocs(collection(db, `households/${H}/placements`))).docs.map((d) => d.data()),
    );
    expect(all.filter((p) => p.itemId === 'ladder' && !p.archived)).toHaveLength(1);
  });
});

describe('MD-16 paralelne izmjene istog zapisa: bez tihog prepisivanja', () => {
  it('dva preimenovanja istog predmeta s verzije 1: jedno uspije, drugo dobije "changed-elsewhere"; pobjednik ostaje', async () => {
    const wait = barrier(2);
    const [ra, rb] = await Promise.all([
      outcome(renameItem(as(env, UID_A), UID_A, 'hammer', 'Čekić A', 1, { afterReads: wait })),
      outcome(renameItem(as(env, UID_B), UID_B, 'hammer', 'Čekić B', 1, { afterReads: wait })),
    ]);
    expect([ra, rb].filter((r) => r === 'OK')).toHaveLength(1);
    expect([ra, rb].some((r) => r.includes('changed-elsewhere'))).toBe(true);
    const item = (await get('items/hammer'))!;
    expect(item.version).toBe(2);
    expect(['Čekić A', 'Čekić B']).toContain(item.name);
    expect(item.updatedBy).toBe(item.name === 'Čekić A' ? UID_A : UID_B); // zapis pripada pobjedniku, nema miješanja
  });
  it('dva premještaja ISTOG smještaja iz iste verzije: jedan uspije, drugi javlja promjenu; ključevi konzistentni', async () => {
    const wait = barrier(2);
    const [ra, rb] = await Promise.all([
      outcome(
        movePlacement(as(env, UID_A), UID_A, 'pl-battery-2', 'kitchen-drawer', 1, {
          afterReads: wait,
        }),
      ),
      outcome(
        movePlacement(as(env, UID_B), UID_B, 'pl-battery-2', 'hall-cabinet', 1, {
          afterReads: wait,
        }),
      ),
    ]);
    expect([ra, rb].filter((r) => r === 'OK')).toHaveLength(1);
    expect([ra, rb].some((r) => r.includes('changed-elsewhere'))).toBe(true);
    const pl = (await get('placements/pl-battery-2'))!;
    expect(pl.version).toBe(2);
    const keys = (
      await adminRead(env, async (db) =>
        (await getDocs(collection(db, `households/${H}/placementKeys`))).docs.map((d) => d.id),
      )
    ).filter((k) => k.startsWith('battery__'));
    expect(keys.sort()).toEqual(
      ['battery__at__living-drawer', `battery__at__${pl.locationId}`].sort(),
    );
  });
  it('SIROVO: zastarjeli upis (klijent misli da je verzija 1 pa piše 2 nakon što je netko već podigao na 2) je odbijen na serveru', async () => {
    await renameItem(as(env, UID_B), UID_B, 'hammer', 'Čekić B', 1);
    await assertFails(
      updateDoc(doc(as(env, UID_A), `households/${H}/items/hammer`), {
        name: 'Čekić A',
        version: 2,
        updatedAt: serverTimestamp(),
        updatedBy: UID_A,
      }),
    );
    expect((await get('items/hammer'))!.name).toBe('Čekić B');
  });
});

describe('MD-17 različiti zapisi paralelno: bez nepotrebnih blokada', () => {
  it('preimenovanja dvaju RAZLIČITIH predmeta uz prisilno preklapanje: oba uspiju iz prvog pokušaja', async () => {
    const wait = barrier(2);
    const [ra, rb] = await Promise.all([
      outcome(renameItem(as(env, UID_A), UID_A, 'hammer', 'Čekić X', 1, { afterReads: wait })),
      outcome(renameItem(as(env, UID_B), UID_B, 'hex-keys', 'Imbus Y', 1, { afterReads: wait })),
    ]);
    expect([ra, rb]).toEqual(['OK', 'OK']);
    expect((await get('items/hammer'))!.name).toBe('Čekić X');
    expect((await get('items/hex-keys'))!.name).toBe('Imbus Y');
  });
  it('premještaj dvaju RAZLIČITIH smještaja istodobno (čak i u istu lokaciju): oba uspiju', async () => {
    const wait = barrier(2);
    const [ra, rb] = await Promise.all([
      outcome(
        movePlacement(as(env, UID_A), UID_A, 'pl-hammer-1', 'hall-cabinet', 1, {
          afterReads: wait,
        }),
      ),
      outcome(
        movePlacement(as(env, UID_B), UID_B, 'pl-usb-cable-1', 'hall-cabinet', 1, {
          afterReads: wait,
        }),
      ),
    ]);
    expect([ra, rb]).toEqual(['OK', 'OK']);
  });
  it('dodavanje RAZLIČITIH predmeta u istu lokaciju istodobno: oba uspiju (nema brojača koji bi blokirao)', async () => {
    await createItem(as(env, UID_A), UID_A, {
      id: 'new-tape',
      name: 'Ljepljiva traka',
      kind: 'type',
    });
    await createItem(as(env, UID_B), UID_B, { id: 'new-glue', name: 'Ljepilo', kind: 'type' });
    const wait = barrier(2);
    const [ra, rb] = await Promise.all([
      outcome(
        addPlacement(
          as(env, UID_A),
          UID_A,
          { id: 'pl-tape', itemId: 'new-tape', locationId: 'hall-cabinet' },
          { afterReads: wait },
        ),
      ),
      outcome(
        addPlacement(
          as(env, UID_B),
          UID_B,
          { id: 'pl-glue', itemId: 'new-glue', locationId: 'hall-cabinet' },
          { afterReads: wait },
        ),
      ),
    ]);
    expect([ra, rb]).toEqual(['OK', 'OK']);
  });
});

describe('transakcije nikad ne ulaze u skriveni offline red (ADR Q4)', () => {
  it('assertSucceeds sanity: ispravan protokol prolazi i kad su oba korisnika aktivna', async () => {
    await assertSucceeds(renameItem(as(env, UID_A), UID_A, 'hammer', 'Čekić 2', 1));
    await assertSucceeds(renameItem(as(env, UID_B), UID_B, 'hammer', 'Čekić 3', 2));
  });
});
