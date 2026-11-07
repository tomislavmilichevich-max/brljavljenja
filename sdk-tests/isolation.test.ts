// Izolacija podatkovnih sesija: privatni podaci, keš i listeneri se uništavaju pri odjavi, promjeni računa i opozivu.
// Pravi SDK (v13) i pravi produkcijski kod (dataSession.ts, watch.ts) u emulatoru. Memorijski keš po sesiji.
import { doc, getDocFromCache, getDocFromServer } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDataSession } from '../src/firebase/dataSession';
import { isAccessRevoked } from '../src/inventory/access';
import type { InventoryState } from '../src/inventory/gate';
import { watchInventory } from '../src/inventory/watch';
import {
  CONFIG,
  EMU,
  H,
  adminWrite,
  closeAdmin,
  openLive,
  seedFor,
  setEnabled,
  signInPrimary,
  signOutPrimary,
  sleep,
  switchAccount,
  waitFor,
  type Primary,
} from './helpers';

let pa: Primary;
beforeAll(async () => {
  pa = await signInPrimary('isoA');
  await seedFor([[pa.uid, true]]);
});
afterAll(closeAdmin);

const item = (db: Parameters<typeof doc>[0]) => doc(db, `households/${H}/items/hammer`);
/** Čitanje iz keša koje hvata i SINKRONE greške (doc() na uništenoj instanci baca odmah). */
const fromCache = async (db: Parameters<typeof doc>[0]) => getDocFromCache(item(db));

describe('zasebna instanca po sesiji; keš umire s dispose()', () => {
  it('svaka sesija je zasebna Firebase app instanca (različita imena), različita od primarne', async () => {
    const s1 = await openDataSession(pa.auth, CONFIG, EMU);
    const s2 = await openDataSession(pa.auth, CONFIG, EMU);
    expect(s1.db.app.name).not.toBe(s2.db.app.name);
    expect([s1.db.app.name, s2.db.app.name]).not.toContain(pa.app.name);
    await s1.dispose();
    await s2.dispose();
  });
  it('privatni dokument u kešu sesije je čitljiv; nakon dispose() instanca je uništena; NOVA sesija istog korisnika počinje s PRAZNIM kešom', async () => {
    const s1 = await openDataSession(pa.auth, CONFIG, EMU);
    await getDocFromServer(item(s1.db)); // poslužitelj -> puni keš
    expect((await fromCache(s1.db)).exists()).toBe(true);
    await s1.dispose();
    await expect(fromCache(s1.db)).rejects.toBeTruthy(); // terminirana instanca ne poslužuje ništa
    const s2 = await openDataSession(pa.auth, CONFIG, EMU);
    await expect(fromCache(s2.db)).rejects.toBeTruthy(); // nikakav ostatak iz s1
    await getDocFromServer(item(s2.db));
    await s2.dispose();
  });
  it('dispose() je idempotentan', async () => {
    const s = await openDataSession(pa.auth, CONFIG, EMU);
    await s.dispose();
    await expect(s.dispose()).resolves.toBeUndefined();
  });
  it('sekundarna instanca ima vlastiti Auth s kopijom korisnika; bez prijavljenog korisnika sesija se ne otvara', async () => {
    const p = await signInPrimary('isoTmp');
    const s = await openDataSession(p.auth, CONFIG, EMU);
    expect(getAuth(s.db.app).currentUser?.uid).toBe(p.uid);
    await s.dispose();
    await signOutPrimary(p);
    await expect(openDataSession(p.auth, CONFIG, EMU)).rejects.toMatchObject({
      code: 'access-revoked',
    });
  });
});

describe('promjena računa na istom uređaju (isti primarni Auth)', () => {
  it('A učita i kešira privatne podatke; odjava + prijava računa C: stara sesija mrtva, nova sesija C ne vidi NIŠTA od A-ovih podataka', async () => {
    const p = await signInPrimary('isoSwitchA');
    await seedFor([[p.uid, true]]);
    const A = await openLive(p);
    const statesA: InventoryState[] = [];
    const unA = watchInventory(A.session.db, H, (s) => statesA.push(s));
    await waitFor(() => statesA.find((s) => s.status === 'ready'));
    expect((await fromCache(A.session.db)).exists()).toBe(true); // A-ov keš je pun

    // aplikacija pri odjavi: odjavi listenere, uništi sesiju, zatim odjava/prijava drugog računa
    unA();
    await A.session.dispose();
    await signOutPrimary(p);
    const cUid = await switchAccount(p, 'isoSwitchC');
    expect(cUid).not.toBe(A.session.uid);

    await expect(fromCache(A.session.db)).rejects.toBeTruthy(); // A-ova instanca ne poslužuje ništa
    const C = await openLive(p);
    expect(C.session.uid).toBe(cUid);
    await expect(fromCache(C.session.db)).rejects.toBeTruthy(); // C-ova sesija je prazna
    const statesC: InventoryState[] = [];
    const unC = watchInventory(C.session.db, H, (s) => statesC.push(s));
    const revoked = await waitFor(() => statesC.find((s) => s.status === 'revoked'));
    expect(revoked.status).toBe('revoked');
    expect(statesC.some((s) => s.status === 'ready' || s.status === 'stale')).toBe(false); // nikakvi podaci
    await expect(fromCache(C.session.db)).rejects.toBeTruthy(); // ni nakon listenera
    await expect(C.repo.createItem({ name: 'x', kind: 'type' })).rejects.toMatchObject({
      code: 'access-revoked',
    });
    unC();
    await C.session.dispose();
  });
});

describe('listeneri se uklanjaju', () => {
  it('nakon odjave pretplate nema daljnjih povratnih poziva ni kad se podaci mijenjaju', async () => {
    const A = await openLive(pa);
    let calls = 0;
    const un = watchInventory(A.session.db, H, () => calls++);
    await waitFor(() => calls > 0);
    un();
    const base = calls;
    await adminWrite(async (db) => {
      const { updateDoc, doc: d } = await import('firebase/firestore');
      await updateDoc(d(db, `households/${H}/items/hammer`), {
        name: 'Promjena nakon odjave',
        version: 99,
      });
    });
    await sleep(2000);
    expect(calls).toBe(base);
    await A.session.dispose();
  });
  it('dispose() sesije također gasi listenere: nakon što se već poslani događaji isprazne, NOVI podaci se više ne isporučuju', async () => {
    await seedFor([[pa.uid, true]]);
    const A = await openLive(pa);
    let calls = 0;
    watchInventory(A.session.db, H, () => calls++); // namjerno NE pozivamo unsubscribe
    await waitFor(() => calls > 0);
    await A.session.dispose();
    await sleep(500); // događaji koji su već bili u redu prije uništenja
    const base = calls;
    await adminWrite(async (db) => {
      const { updateDoc, doc: d } = await import('firebase/firestore');
      await updateDoc(d(db, `households/${H}/items/hammer`), {
        name: 'Promjena nakon dispose',
        version: 98,
      });
    });
    await sleep(2500);
    expect(calls).toBe(base);
  });
});

describe('opoziv članstva', () => {
  it('nakon enabled:false: provjera pristupa sa servera = opozvan; operacije = access-revoked; (zabilježeno) ponašanje otvorenog listenera', async () => {
    await seedFor([[pa.uid, true]]);
    const A = await openLive(pa);
    const states: InventoryState[] = [];
    const un = watchInventory(A.session.db, H, (s) => states.push(s));
    await waitFor(() => states.find((s) => s.status === 'ready'));
    await setEnabled(pa.uid, false);
    // promijeni podatke da bi poslužitelj imao razlog ponovno evaluirati listener
    await adminWrite(async (db) => {
      const { updateDoc, doc: d } = await import('firebase/firestore');
      await updateDoc(d(db, `households/${H}/items/hammer`), {
        name: 'Nakon opoziva',
        version: 77,
      });
    });
    await sleep(4000);
    const listenerSaw = states.some((s) => s.status === 'revoked')
      ? 'listener je prijavio revoked'
      : 'listener je OSTAO TIHO (nema događaja opoziva)';
    console.log(
      'OPOZIV otvoreni listener:',
      listenerSaw,
      '| zadnje stanje:',
      states.at(-1)?.status,
    );
    // nezavisno od ponašanja listenera, aplikacija MORA moći utvrditi opoziv:
    expect(await isAccessRevoked(A.session.db, H)).toBe(true);
    await expect(A.repo.updateItem('hammer', { name: 'x' }, 77)).rejects.toMatchObject({
      code: 'access-revoked',
    });
    un();
    await A.session.dispose();
    // nova sesija opozvanog korisnika: listener odmah revoked, bez podataka
    const A2 = await openLive(pa);
    const s2: InventoryState[] = [];
    const un2 = watchInventory(A2.session.db, H, (s) => s2.push(s));
    await waitFor(() => s2.find((s) => s.status === 'revoked'));
    expect(s2.some((s) => s.status === 'ready' || s.status === 'stale')).toBe(false);
    un2();
    await A2.session.dispose();
  });
});
