// ADR Q4/Q5: (4) jesu li izmjene "online-only" i ne ulaze li u skriveni offline red; (5) izolacija memorijskog keša.
// Ponašanje Firestore web SDK-a (v13) u Node okruženju prema emulatoru; ne dokazuje ponašanje Android WebViewa.
import { type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectFirestoreEmulator,
  disableNetwork,
  doc,
  getDoc,
  getDocFromCache,
  getFirestore,
  runTransaction,
  setDoc,
  terminate,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { H, UID_A, UID_C, as, newEnv, outcome, seedDemoHouse } from './helpers';
import { renameItem } from './ops';

let env: RulesTestEnvironment;
beforeAll(async () => void (env = await newEnv()));
afterAll(async () => env.cleanup());
beforeEach(async () => seedDemoHouse(env));

const race = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<'PENDING'>((r) => setTimeout(() => r('PENDING'), ms))]);

describe('Q4: bez veze transakcija se odbija, a običan setDoc ulazi u skriveni red', () => {
  it('instanca čiji je poslužitelj NEDOSTUPAN (stvarni gubitak veze): runTransaction pada, setDoc ostaje PENDING', async () => {
    const app = initializeApp(
      { projectId: 'demo-dead-endpoint', apiKey: 'x' },
      `dead-${process.pid}`,
    );
    const db = getFirestore(app);
    connectFirestoreEmulator(db, '127.0.0.1', 59999); // nitko ne sluša
    try {
      const started = Date.now();
      const tx = await race(
        outcome(
          runTransaction(
            db,
            async (t) => {
              await t.get(doc(db, 'x/y'));
              t.set(doc(db, 'x/y'), { a: 1 });
            },
            { maxAttempts: 1 },
          ),
        ),
        45000,
      );
      console.log(
        `Q4 transakcija bez veze: ${String(tx).slice(0, 60)} nakon ${Date.now() - started} ms`,
      );
      expect(tx, 'transakcija bez veze mora završiti greškom, ne ostati u redu').not.toBe(
        'PENDING',
      );
      expect(tx).not.toBe('OK');

      const queued = setDoc(doc(db, 'x/z'), { a: 1 });
      expect(
        await race(
          queued.then(
            () => 'DONE',
            () => 'REJECTED',
          ),
          2000,
        ),
        'običan setDoc se NE odbija nego čeka u redu',
      ).toBe('PENDING');
    } finally {
      await race(terminate(db), 3000);
      await race(deleteApp(app), 3000);
    }
  }, 90000);

  it('NALAZ: disableNetwork() NE blokira transakcije u ovom SDK-u — ne smije se koristiti kao zaštita od offline upisa', async () => {
    const db = as(env, UID_A);
    await getDoc(doc(db, `households/${H}/items/hammer`));
    await disableNetwork(db);
    const r = await race(
      outcome(renameItem(db, UID_A, 'hammer', 'Unatoč disableNetwork', 1)),
      20000,
    );
    console.log('Q4 transakcija uz disableNetwork():', r);
    expect(r).toBe('OK'); // zabilježeno ponašanje; ako se promijeni, ADR Q4 treba preispitati
  }, 40000);
});

describe('Q5: memorijski keš je vezan uz Firestore INSTANCU', () => {
  it('ista instanca nakon "odjave" još drži pročitani dokument (curenje); NOVA instanca drugog korisnika nema ništa', async () => {
    const dbA = as(env, UID_A);
    await getDoc(doc(dbA, `households/${H}/items/hammer`));
    expect((await getDocFromCache(doc(dbA, `households/${H}/items/hammer`))).exists()).toBe(true);
    const dbC = as(env, UID_C);
    await expect(getDocFromCache(doc(dbC, `households/${H}/items/hammer`))).rejects.toBeTruthy();
  });
});
