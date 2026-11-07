// D5: opoziv članstva se MORA razlikovati od konflikta. Stvarna pravila, referentni protokol, sintetski UID-ovi.
import { type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { H, UID_A, UID_B, as, barrier, newEnv, outcome, seedDemoHouse } from './helpers';
import {
  accessRevoked,
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

const setEnabled = (uid: string, enabled: boolean) =>
  env.withSecurityRulesDisabled(
    async (c) =>
      void (await updateDoc(doc(c.firestore(), `households/${H}/members/${uid}`), { enabled })),
  );

describe('opozvani član: svaka mutacija javlja access-revoked (a ne konflikt ni generički DENIED)', () => {
  const ops: [string, (db: ReturnType<typeof as>) => Promise<unknown>][] = [
    ['renameItem', (db) => renameItem(db, UID_A, 'hammer', 'x', 1)],
    ['createItem', (db) => createItem(db, UID_A, { id: 'rev-item', name: 'x', kind: 'type' })],
    [
      'createLocation',
      (db) =>
        createLocation(db, UID_A, {
          id: 'rev-loc',
          name: 'x',
          parentId: 'garage-tool',
          kind: 'shelf',
        }),
    ],
    ['moveLocation', (db) => moveLocation(db, UID_A, 'garage-box', 'living-tv')],
    [
      'addPlacement',
      (db) =>
        addPlacement(db, UID_A, { id: 'pl-rev', itemId: 'battery', locationId: 'hall-cabinet' }),
    ],
    ['movePlacement', (db) => movePlacement(db, UID_A, 'pl-battery-2', 'hall-cabinet', 1)],
    ['archivePlacement', (db) => archivePlacement(db, UID_A, 'pl-battery-2', 1)],
  ];
  for (const [name, run] of ops) {
    it(`${name}: enabled:false => access-revoked`, async () => {
      await setEnabled(UID_A, false);
      await expect(run(as(env, UID_A))).rejects.toMatchObject({ code: 'access-revoked' });
    });
  }
  it('opoziv ima prednost pred konfliktom: zastarjela verzija + opoziv => access-revoked', async () => {
    await renameItem(as(env, UID_B), UID_B, 'hammer', 'B je prvi', 1); // verzija je sada 2
    await setEnabled(UID_A, false);
    await expect(renameItem(as(env, UID_A), UID_A, 'hammer', 'A kasni', 1)).rejects.toMatchObject({
      code: 'access-revoked',
    });
  });
  it('obrisan membership dokument (ne samo enabled:false) također je opoziv', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      const { deleteDoc } = await import('firebase/firestore');
      await deleteDoc(doc(c.firestore(), `households/${H}/members/${UID_A}`));
    });
    await expect(renameItem(as(env, UID_A), UID_A, 'hammer', 'x', 1)).rejects.toMatchObject({
      code: 'access-revoked',
    });
  });
  it('opoziv usred transakcije (nakon čitanja, prije commita) => access-revoked', async () => {
    const hooks = { afterReads: async () => setEnabled(UID_A, false) };
    await expect(renameItem(as(env, UID_A), UID_A, 'hammer', 'x', 1, hooks)).rejects.toMatchObject({
      code: 'access-revoked',
    });
    await expect(
      moveLocation(as(env, UID_A), UID_A, 'garage-box', 'living-tv', hooks),
    ).rejects.toMatchObject({ code: 'access-revoked' });
  });
  it('opoziv usred TRKE: B pobjeđuje, A je istodobno opozvan => A dobiva access-revoked, a ne changed-elsewhere', async () => {
    const wait = barrier(2);
    const revokeA = async () => {
      await wait();
      await setEnabled(UID_A, false);
    };
    const [ra, rb] = await Promise.all([
      outcome(renameItem(as(env, UID_A), UID_A, 'hammer', 'A', 1, { afterReads: revokeA })),
      outcome(renameItem(as(env, UID_B), UID_B, 'hammer', 'B', 1, { afterReads: wait })),
    ]);
    expect(rb).toBe('OK');
    expect(ra).toContain('access-revoked');
  });
});

describe('aktivni član: sukob se i dalje javlja kao sukob (ne kao opoziv)', () => {
  it('zastarjela verzija => changed-elsewhere', async () => {
    await renameItem(as(env, UID_B), UID_B, 'hammer', 'B je prvi', 1);
    await expect(renameItem(as(env, UID_A), UID_A, 'hammer', 'A kasni', 1)).rejects.toMatchObject({
      code: 'changed-elsewhere',
    });
  });
  it('duplikat smještaja => duplicate-placement', async () => {
    await expect(
      addPlacement(as(env, UID_A), UID_A, {
        id: 'pl-dup',
        itemId: 'battery',
        locationId: 'living-drawer',
      }),
    ).rejects.toMatchObject({ code: 'duplicate-placement' });
  });
  it('accessRevoked: false za aktivnog, true za opozvanog i za nečlana', async () => {
    expect(await accessRevoked(as(env, UID_A))).toBe(false);
    await setEnabled(UID_A, false);
    expect(await accessRevoked(as(env, UID_A))).toBe(true);
    expect(await accessRevoked(as(env, 'uidC'))).toBe(true);
  });
});
