// D1 (odluka glavnog razvoja): Rules NE jamče potpunu acikličnost. Server otkriva cikluse do udaljenosti 6; dalje je
// zaštita ISKLJUČIVO protokol u transakciji (puni lanac predaka + meta/tree CAS) i detekcija oštećenog stabla nakon
// učitavanja (findTreeProblems). Ovi testovi: (a) najgori legitimni upis stane u limit pravila, (b) što server hvata,
// (c) gdje je PROPUST, (d) protokol hvata isto na dubini 7, 10 i 20, (e) istodobna premještanja na dubokim lancima,
// (f) oštećeno stablo se otkriva. Nigdje se ne tvrdi da Rules garantiraju acikličnost.
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { H, UID_A, UID_B, adminRead, as, barrier, newEnv, outcome, seedDemoHouse } from './helpers';
import { findTreeProblems, moveLocation } from './ops';

let env: RulesTestEnvironment;
beforeAll(async () => void (env = await newEnv()));
afterAll(async () => env.cleanup());

const LEN = 24; // lanac c0 … c23 (c0 pod root)
const c = (i: number) => `c${i}`;
const e = (i: number) => `e${i}`; // drugi lanac e0 … e23 (e0 pod root)

async function seedWithChains() {
  await seedDemoHouse(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = Timestamp.now();
    for (const mk of [c, e]) {
      for (let i = 0; i < LEN; i++) {
        await setDoc(doc(db, `households/${H}/locations/${mk(i)}`), {
          name: `${mk(i)}`,
          parentId: i === 0 ? 'root' : mk(i - 1),
          kind: 'box',
          version: 1,
          archived: false,
          createdAt: now,
          updatedAt: now,
          createdBy: 'seed',
          updatedBy: 'seed',
        });
      }
    }
  });
}
beforeEach(seedWithChains);

/** Sirovi batch BEZ klijentske provjere ciklusa, ali s ispravnim version/rev (zaobilazi protokol, ne CAS). */
async function rawReparent(id: string, newParent: string, fromRev = 0) {
  const db = as(env, UID_A);
  const b = writeBatch(db);
  b.update(doc(db, `households/${H}/locations/${id}`), {
    parentId: newParent,
    version: 2,
    updatedAt: serverTimestamp(),
    updatedBy: UID_A,
  });
  b.update(doc(db, `households/${H}/meta/tree`), { rev: fromRev + 1 });
  return b.commit();
}
const loadTree = () =>
  adminRead(env, async (db) =>
    (await getDocs(collection(db, `households/${H}/locations`))).docs.map((d) => ({
      id: d.id,
      parentId: d.data().parentId as string | null,
    })),
  );

describe('server: ograničena provjera ciklusa (udaljenost ≤ 6) i budžet limita', () => {
  it('POZITIVNA KONTROLA / najgori legitimni slučaj: premještaj ispod čvora dubine 24 USPIJEVA (limit od 10 dokumenata nije probijen)', async () => {
    await assertSucceeds(rawReparent('garage-box', c(LEN - 1)));
  });
  it('ciklus na udaljenosti 1..6 od premještene lokacije ODBIJEN na serveru', async () => {
    for (const d of [1, 2, 4, 5, 6]) {
      await seedWithChains();
      await assertFails(rawReparent(c(0), c(d)));
    }
  });
  it('KNOWN GAP (D1): ciklus na udaljenosti 7, 10 i 20 server NE vidi — sirovi batch uspijeva; zaštita je samo protokol', async () => {
    for (const d of [7, 10, 20]) {
      await seedWithChains();
      await assertSucceeds(rawReparent(c(0), c(d)));
      const parent = await adminRead(
        env,
        async (db) => (await getDoc(doc(db, `households/${H}/locations/${c(0)}`))).data()!.parentId,
      );
      expect(parent, `dubina ${d}`).toBe(c(d)); // ciklus je stvarno zapisan
    }
  });
});

describe('P2-B protokol (referentna implementacija): puni lanac predaka u transakciji, dubina 7 / 10 / 20', () => {
  for (const d of [7, 10, 20]) {
    it(`dubina ${d}: ciklus se odbija prije pisanja; stablo i rev ostaju netaknuti`, async () => {
      await expect(moveLocation(as(env, UID_A), UID_A, c(0), c(d))).rejects.toMatchObject({
        code: 'cycle',
      });
      expect(
        await adminRead(
          env,
          async (db) => (await getDoc(doc(db, `households/${H}/meta/tree`))).data()!.rev,
        ),
      ).toBe(0);
      expect(findTreeProblems(await loadTree())).toEqual([]);
    });
    it(`dubina ${d}: legitimno premještanje ispod čvora te dubine uspijeva i stablo ostaje zdravo`, async () => {
      await assertSucceeds(moveLocation(as(env, UID_A), UID_A, 'garage-box', c(d)));
      expect(findTreeProblems(await loadTree())).toEqual([]);
    });
  }
});

describe('istodobna premještanja na dubokim lancima (A i B, prisilno preklapanje)', () => {
  it('c10 → pod e23 (A) i e10 → pod c23 (B): svako samo za sebe je valjano, zajedno bi činili ciklus — točno jedno uspije', async () => {
    const wait = barrier(2);
    const hooks = { afterReads: wait };
    const [ra, rb] = await Promise.all([
      outcome(moveLocation(as(env, UID_A), UID_A, c(10), e(23), hooks)),
      outcome(moveLocation(as(env, UID_B), UID_B, e(10), c(23), hooks)),
    ]);
    expect([ra, rb].filter((r) => r === 'OK')).toHaveLength(1);
    expect([ra, rb].filter((r) => r.includes('cycle'))).toHaveLength(1);
    expect(findTreeProblems(await loadTree())).toEqual([]);
    expect(
      await adminRead(
        env,
        async (db) => (await getDoc(doc(db, `households/${H}/meta/tree`))).data()!.rev,
      ),
    ).toBe(1);
    console.log('D1 duboke istodobne (A,B):', [ra, rb]);
  });
  it('nepovezana duboka premještanja istodobno: oba uspiju (serijalizirana CAS-om i ponovljena), stablo zdravo', async () => {
    const wait = barrier(2);
    const hooks = { afterReads: wait };
    const [ra, rb] = await Promise.all([
      outcome(moveLocation(as(env, UID_A), UID_A, 'garage-box', c(20), hooks)),
      outcome(moveLocation(as(env, UID_B), UID_B, 'pantry-box', e(20), hooks)),
    ]);
    expect([ra, rb]).toEqual(['OK', 'OK']);
    expect(findTreeProblems(await loadTree())).toEqual([]);
  });
  it('istodobno: A pokušava ciklus (c0 pod c20), B premješta nepovezani list — ciklus se odbija, B uspijeva', async () => {
    // A baca 'cycle' PRIJE točke preklapanja (nikad ne dođe do upisa), pa ovdje nema barijere.
    const [ra, rb] = await Promise.all([
      outcome(moveLocation(as(env, UID_A), UID_A, c(0), c(20))),
      outcome(moveLocation(as(env, UID_B), UID_B, 'garage-box', e(5))),
    ]);
    expect(ra).toContain('cycle');
    expect(rb).toBe('OK');
    expect(findTreeProblems(await loadTree())).toEqual([]);
  });
});

describe('findTreeProblems: detekcija oštećenog stabla nakon učitavanja (proizvoljna dubina)', () => {
  const n = (id: string, parentId: string | null) => ({ id, parentId });
  it('zdravo stablo (demo kuća + dva lanca dubine 24) nema problema', async () => {
    expect(findTreeProblems(await loadTree())).toEqual([]);
  });
  it('ciklus napravljen sirovim zapisom na dubini 7, 10 i 20 se OTKRIVA nakon učitavanja', async () => {
    for (const d of [7, 10, 20]) {
      await seedWithChains();
      await assertSucceeds(rawReparent(c(0), c(d)));
      const problems = findTreeProblems(await loadTree());
      const cycle = problems.find((p) => p.type === 'cycle');
      expect(cycle, `dubina ${d}`).toBeTruthy();
      expect((cycle as { ids: string[] }).ids).toHaveLength(d + 1); // c0 … c{d}
    }
  });
  it('samopetlja, dvočlani ciklus, nedostajući roditelj, nema roota, dodatni root', () => {
    expect(findTreeProblems([n('root', null), n('a', 'a')]).map((p) => p.type)).toEqual(['cycle']);
    expect(
      findTreeProblems([n('root', null), n('a', 'b'), n('b', 'a')]).map((p) => p.type),
    ).toEqual(['cycle']);
    expect(findTreeProblems([n('root', null), n('a', 'nema')])).toEqual([
      { type: 'missing-parent', id: 'a', parentId: 'nema' },
    ]);
    expect(
      findTreeProblems([n('a', 'root')])
        .map((p) => p.type)
        .sort(),
    ).toEqual(['missing-parent', 'no-root']);
    expect(findTreeProblems([n('root', null), n('x', null)])).toEqual([
      { type: 'extra-root', ids: ['x'] },
    ]);
  });
  it('vrlo dubok lanac (5000 čvorova) ne prepunjuje stog i nema lažnih alarma', () => {
    const locs = [
      n('root', null),
      ...Array.from({ length: 5000 }, (_, i) => n(`n${i}`, i === 0 ? 'root' : `n${i - 1}`)),
    ];
    expect(findTreeProblems(locs)).toEqual([]);
    locs[1] = n('n0', 'n4999'); // zatvori krug
    expect(findTreeProblems(locs).some((p) => p.type === 'cycle')).toBe(true);
  });
});
