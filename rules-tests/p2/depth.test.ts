// Granice server-side provjere acikličnosti (ADR R-1). Rules nemaju petlje: provjera je razmotana na
// y + 5 predaka (6 dokumenata); limit je 10 RAZLIČITIH dokumenata po upisu, a na samoj granici emulator nije
// pouzdan (ADR). Ovi testovi dokazuju
// (a) najgori LEGITIMNI slučaj stane u limit, (b) što je pokriveno, (c) gdje je PRAZNINA.
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { Timestamp, doc, setDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { H, UID_A, adminRead, as, newEnv, seedDemoHouse } from './helpers';
import { moveLocation } from './ops';

let env: RulesTestEnvironment;
beforeAll(async () => void (env = await newEnv()));
afterAll(async () => env.cleanup());

const CHAIN = 14; // c0 (pod root) ... c13
const cid = (i: number) => `c${i}`;

beforeEach(async () => {
  await seedDemoHouse(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = Timestamp.now();
    for (let i = 0; i < CHAIN; i++) {
      await setDoc(doc(db, `households/${H}/locations/${cid(i)}`), {
        name: `Razina ${i}`,
        parentId: i === 0 ? 'root' : cid(i - 1),
        kind: 'box',
        version: 1,
        archived: false,
        createdAt: now,
        updatedAt: now,
        createdBy: 'seed',
        updatedBy: 'seed',
      });
    }
  });
});

/** Sirovi batch BEZ klijentske provjere ciklusa, ali s ispravnim version/rev (zaobilazi protokol, ne CAS). */
async function rawReparent(id: string, newParent: string, fromVersion = 1, fromRev = 0) {
  const db = as(env, UID_A);
  const b = writeBatch(db);
  b.update(doc(db, `households/${H}/locations/${id}`), {
    parentId: newParent,
    version: fromVersion + 1,
    updatedAt: serverTimestamp(),
    updatedBy: UID_A,
  });
  b.update(doc(db, `households/${H}/meta/tree`), { rev: fromRev + 1 });
  return b.commit();
}

describe('server-side pokrivenost acikličnosti (udaljenost ≤ 6)', () => {
  it('POZITIVNA KONTROLA / najgori legitimni slučaj: premještaj ispod čvora dubine 14 (lanac duži od limita) USPIJEVA', async () => {
    // Pravila razmataju 6 gets + član + meta/tree (get i getAfter) = najviše 9 dokumenata; limit od 10 nije dotaknut.
    await assertSucceeds(rawReparent('garage-box', cid(CHAIN - 1), 1, 0));
  });
  it('ciklus na udaljenosti 1..6 od premještene lokacije ODBIJEN na serveru', async () => {
    // L = c0; cilj Y = c{d} je potomak od c0 na udaljenosti d
    for (const d of [1, 2, 4, 5, 6]) {
      await seedAgain();
      await assertFails(rawReparent(cid(0), cid(d), 1, 0));
    }
  });
  it('KNOWN GAP (ADR R-1): ciklus na udaljenosti 7+ server NE vidi — sirovi batch uspijeva (zaštita je samo protokol)', async () => {
    await assertSucceeds(rawReparent(cid(0), cid(7), 1, 0)); // c0 pod vlastitim potomkom c7 => ciklus u podacima
    const parent = await adminRead(env, async (db) => {
      const { getDoc } = await import('firebase/firestore');
      return (await getDoc(doc(db, `households/${H}/locations/${cid(0)}`))).data()!.parentId;
    });
    expect(parent).toBe(cid(7)); // dokaz da je ciklus stvarno zapisan
  });
  it('REFERENTNI PROTOKOL (transakcija s punom dubinom) odbija isti ciklus na udaljenosti 7 i 13', async () => {
    for (const d of [7, 13]) {
      await expect(moveLocation(as(env, UID_A), UID_A, cid(0), cid(d))).rejects.toMatchObject({
        code: 'cycle',
      });
    }
  });
});

async function seedAgain() {
  await seedDemoHouse(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = Timestamp.now();
    for (let i = 0; i < CHAIN; i++) {
      await setDoc(doc(db, `households/${H}/locations/${cid(i)}`), {
        name: `Razina ${i}`,
        parentId: i === 0 ? 'root' : cid(i - 1),
        kind: 'box',
        version: 1,
        archived: false,
        createdAt: now,
        updatedAt: now,
        createdBy: 'seed',
        updatedBy: 'seed',
      });
    }
  });
}
