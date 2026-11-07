import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Sintetski UID-ovi i izolirani demo projekt — nikakvi stvarni podaci.
const PROJECT_ID = 'demo-home-inventory-rules';
const H1 = 'h1';
const H2 = 'h2';
let env: RulesTestEnvironment;

async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'households', H1), { name: 'Testno kućanstvo 1', schemaVersion: 1 });
    await setDoc(doc(db, 'households', H2), { name: 'Testno kućanstvo 2', schemaVersion: 1 });
    const m = (uid: string, enabled: boolean) =>
      setDoc(doc(db, 'households', H1, 'members', uid), { uid, role: 'member', enabled });
    await m('uidA', true);
    await m('uidB', true);
    await m('uidDisabled', false);
    await setDoc(doc(db, 'households', H2, 'members', 'uidOther'), {
      uid: 'uidOther',
      role: 'member',
      enabled: true,
    });
    await setDoc(doc(db, 'households', H1, 'locations', 'loc1'), { name: 'Garaža' });
    await setDoc(doc(db, 'households', H1, 'items', 'item1'), { name: 'Kabel' });
    await setDoc(doc(db, 'households', H1, 'placements', 'pl1'), { itemId: 'item1' });
    await setDoc(doc(db, 'households', H1, 'appliedOps', 'op1'), { done: true });
  });
}

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    // Pravila se eksplicitno učitavaju iz stvarne datoteke firestore.rules (ne mock).
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(seed);

describe('ACL — čitanje', () => {
  it('ACL-01 neautentificiran GET household', async () => {
    await assertFails(getDoc(doc(anon(), 'households', H1)));
  });
  it('ACL-02 neautentificiran GET membership', async () => {
    await assertFails(getDoc(doc(anon(), 'households', H1, 'members', 'uidA')));
  });
  it('ACL-03 uidC (nije član) GET household', async () => {
    await assertFails(getDoc(doc(as('uidC'), 'households', H1)));
  });
  it('ACL-04 uidDisabled GET household', async () => {
    await assertFails(getDoc(doc(as('uidDisabled'), 'households', H1)));
  });
  it('ACL-05 uidA GET household h1', async () => {
    const snap = await assertSucceeds(getDoc(doc(as('uidA'), 'households', H1)));
    expect(snap.data()?.name).toBe('Testno kućanstvo 1');
  });
  it('ACL-06 uidB GET household h1', async () => {
    await assertSucceeds(getDoc(doc(as('uidB'), 'households', H1)));
  });
  it('ACL-07 uidA GET vlastiti membership', async () => {
    const snap = await assertSucceeds(getDoc(doc(as('uidA'), 'households', H1, 'members', 'uidA')));
    expect(snap.data()?.enabled).toBe(true);
  });
  it('ACL-08 uidA GET uidB membership', async () => {
    await assertFails(getDoc(doc(as('uidA'), 'households', H1, 'members', 'uidB')));
  });
  it('ACL-09 uidA LIST members', async () => {
    await assertFails(getDocs(collection(as('uidA'), 'households', H1, 'members')));
  });
  it('ACL-10 uidA LIST households', async () => {
    await assertFails(getDocs(collection(as('uidA'), 'households')));
  });
  it('ACL-11 uidA GET household h2', async () => {
    await assertFails(getDoc(doc(as('uidA'), 'households', H2)));
  });
  it('dodatno: uidA ne smije ni membership u h2 (ni vlastiti ID)', async () => {
    await assertFails(getDoc(doc(as('uidA'), 'households', H2, 'members', 'uidA')));
  });
  it('dodatno: onemogućeni član ne smije dohvatiti ni vlastiti membership', async () => {
    await assertFails(getDoc(doc(as('uidDisabled'), 'households', H1, 'members', 'uidDisabled')));
  });
  it('dodatno: GET nepostojećeg household-a odbijen za nečlana', async () => {
    await assertFails(getDoc(doc(as('uidA'), 'households', 'nepostoji')));
  });
});

describe('ACL — pisanje članstva i eskalacija', () => {
  it('ACL-12 uidC CREATE self membership u household bez odobrenja', async () => {
    await assertFails(
      setDoc(doc(as('uidC'), 'households', H1, 'members', 'uidC'), {
        uid: 'uidC',
        role: 'member',
        enabled: true,
      }),
    );
  });
  it('ACL-12b uidA CREATE self membership u tuđi household h2', async () => {
    await assertFails(
      setDoc(doc(as('uidA'), 'households', H2, 'members', 'uidA'), {
        uid: 'uidA',
        role: 'member',
        enabled: true,
      }),
    );
  });
  it('ACL-12c uidDisabled ne može sam sebi vratiti enabled', async () => {
    await assertFails(
      updateDoc(doc(as('uidDisabled'), 'households', H1, 'members', 'uidDisabled'), {
        enabled: true,
      }),
    );
  });
  it('ACL-13 uidA CREATE membership za trećeg korisnika', async () => {
    await assertFails(
      setDoc(doc(as('uidA'), 'households', H1, 'members', 'uidC'), {
        uid: 'uidC',
        role: 'member',
        enabled: true,
      }),
    );
  });
  it('ACL-14a uidA UPDATE vlastiti role', async () => {
    await assertFails(
      updateDoc(doc(as('uidA'), 'households', H1, 'members', 'uidA'), { role: 'owner' }),
    );
  });
  it('ACL-14b uidA UPDATE tuđi enabled', async () => {
    await assertFails(
      updateDoc(doc(as('uidA'), 'households', H1, 'members', 'uidB'), { enabled: false }),
    );
  });
  it('ACL-14c uidA UPDATE vlastiti enabled', async () => {
    await assertFails(
      updateDoc(doc(as('uidA'), 'households', H1, 'members', 'uidA'), { enabled: false }),
    );
  });
  it('ACL-15 uidA DELETE membership (vlastiti i tuđi)', async () => {
    await assertFails(deleteDoc(doc(as('uidA'), 'households', H1, 'members', 'uidA')));
    await assertFails(deleteDoc(doc(as('uidA'), 'households', H1, 'members', 'uidB')));
  });
  it('ACL-15b masovno brisanje članstva (batch) odbijeno', async () => {
    const db = as('uidA');
    const batch = writeBatch(db);
    batch.delete(doc(db, 'households', H1, 'members', 'uidA'));
    batch.delete(doc(db, 'households', H1, 'members', 'uidB'));
    batch.delete(doc(db, 'households', H1));
    await assertFails(batch.commit());
  });
  it('ACL-16 uidA WRITE household h1 (update, set, delete)', async () => {
    const ref = doc(as('uidA'), 'households', H1);
    await assertFails(updateDoc(ref, { name: 'Hakirano' }));
    await assertFails(setDoc(ref, { name: 'Hakirano' }));
    await assertFails(deleteDoc(ref));
  });
  it('ACL-16b CREATE novog household-a od strane prijavljenog korisnika', async () => {
    await assertFails(setDoc(doc(as('uidC'), 'households', 'h3'), { name: 'Moje' }));
  });
});

describe('ACL — ostale putanje (P2/P3 kolekcije i nepoznato)', () => {
  // P2-A: locations/items/placements su sada čitljivi aktivnim članovima, ali svaki upis mora proći strogu
  // shemu (testirano u rules-tests/p2). appliedOps (P3) ostaje potpuno zatvoren.
  const open = ['locations', 'items', 'placements'] as const;
  const ids: Record<string, string> = {
    locations: 'loc1',
    items: 'item1',
    placements: 'pl1',
    appliedOps: 'op1',
  };
  for (const sub of open) {
    it(`ACL-17 (P2-A) uidA čita ${sub}, ali NESTRUKTURIRAN upis ({x:1}) je odbijen; nečlan ne smije ništa`, async () => {
      const db = as('uidA');
      const ref = doc(db, 'households', H1, sub, ids[sub]!);
      await assertSucceeds(getDoc(ref));
      await assertSucceeds(getDocs(collection(db, 'households', H1, sub)));
      await assertFails(setDoc(doc(db, 'households', H1, sub, 'novi'), { x: 1 }));
      await assertFails(updateDoc(ref, { x: 2 }));
      await assertFails(deleteDoc(ref));
      const other = as('uidC');
      await assertFails(getDoc(doc(other, 'households', H1, sub, ids[sub]!)));
      await assertFails(getDocs(collection(other, 'households', H1, sub)));
    });
  }
  it('ACL-17 uidA READ/WRITE appliedOps (P3) i dalje potpuno odbijeno', async () => {
    const db = as('uidA');
    const ref = doc(db, 'households', H1, 'appliedOps', 'op1');
    await assertFails(getDoc(ref));
    await assertFails(getDocs(collection(db, 'households', H1, 'appliedOps')));
    await assertFails(setDoc(doc(db, 'households', H1, 'appliedOps', 'novi'), { x: 1 }));
    await assertFails(updateDoc(ref, { x: 2 }));
    await assertFails(deleteDoc(ref));
  });
  it('ACL-18 nepoznate putanje (read i write)', async () => {
    const db = as('uidA');
    for (const path of [
      ['nepoznato', 'x'],
      ['households', H1, 'tajno', 'x'],
      ['households', H1, 'members', 'uidA', 'dubje', 'x'],
      ['users', 'uidA'],
    ] as const) {
      const [first, ...rest] = path;
      const ref = doc(db, first, ...rest);
      await assertFails(getDoc(ref));
      await assertFails(setDoc(ref, { x: 1 }));
    }
  });
  it('ACL-18b collection-group upit odbijen', async () => {
    const { collectionGroup } = await import('firebase/firestore');
    await assertFails(getDocs(query(collectionGroup(as('uidA'), 'members'))));
  });
});

describe('ACL — household dokument ne postoji (kontekst P1-REV-01)', () => {
  it('aktivni član (membership postoji) smije GET nepostojećeg household dokumenta -> exists()==false; nečlan ostaje DENY', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'households', H1));
    });
    const snap = await assertSucceeds(getDoc(doc(as('uidA'), 'households', H1)));
    // Pravila to namjerno/nužno dopuštaju (subkolekcija postoji bez roditelja) — zato klijent
    // MORA exists()==false tretirati kao "nije postavljeno", a ne kao odobren pristup.
    expect(snap.exists()).toBe(false);
    await assertFails(getDoc(doc(as('uidC'), 'households', H1)));
  });
});

describe('ACL — opoziv', () => {
  it('ACL-19/20 nakon enabled:false za uidA: A odbijen, B i dalje dopušten', async () => {
    await assertSucceeds(getDoc(doc(as('uidA'), 'households', H1)));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'households', H1, 'members', 'uidA'), {
        enabled: false,
      });
    });
    await assertFails(getDoc(doc(as('uidA'), 'households', H1)));
    await assertFails(getDoc(doc(as('uidA'), 'households', H1, 'members', 'uidA')));
    await assertSucceeds(getDoc(doc(as('uidB'), 'households', H1)));
  });
  it('opoziv brisanjem membership dokumenta također zatvara pristup', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'households', H1, 'members', 'uidA'));
    });
    await assertFails(getDoc(doc(as('uidA'), 'households', H1)));
  });
  it('membership bez polja enabled ne daje pristup', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'households', H1, 'members', 'uidC'), { uid: 'uidC' });
    });
    await assertFails(getDoc(doc(as('uidC'), 'households', H1)));
  });
  it('enabled kao string "true" ne daje pristup', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'households', H1, 'members', 'uidC'), { enabled: 'true' });
    });
    await assertFails(getDoc(doc(as('uidC'), 'households', H1)));
  });
});
