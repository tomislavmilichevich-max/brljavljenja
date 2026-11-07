// Pretpostavke Firestore Rules na kojima počiva ADR (docs/P2_A_ADR.md). Izmjereno u EMULATORU; ponašanje
// produkcije za ove granice NIJE neovisno provjereno (vidi izvještaj). Ako se neki test promijeni nakon
// nadogradnje firebase-tools, dizajn provjere acikličnosti i ključeva treba preispitati.
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, writeBatch } from 'firebase/firestore';
import { afterEach, describe, expect, it } from 'vitest';

const head = "rules_version='2'; service cloud.firestore { match /databases/{database}/documents {";
const tail = '}}';
const P = (p: string) => `/databases/$(database)/documents/${p}`;
let env: RulesTestEnvironment | undefined;
let n = 0;
const mk = async (rules: string) =>
  (env = await initializeTestEnvironment({
    projectId: `demo-limits-${process.pid}-${++n}`,
    firestore: { rules },
  }));
afterEach(async () => {
  await env?.cleanup();
  env = undefined;
});
const seedDocs = async (e: RulesTestEnvironment, ids: string[]) =>
  e.withSecurityRulesDisabled(async (c) => {
    for (const id of ids) await setDoc(doc(c.firestore(), `d/${id}`), { v: 1 });
  });
const ok = (p: Promise<unknown>) =>
  p.then(
    () => 'OK',
    () => 'DENIED',
  );
const getsOf = (ids: string[]) => ids.map((id) => `get(${P('d/' + id)}).data.v == 1`).join(' && ');
const ids = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}`);
const base = `match /d/{id} { allow read, write: if true; }`; // samo za priprema; testira se zaseban match /t

describe('granice poziva get()/getAfter() u Rules', () => {
  it('ponovljeni get ISTOG dokumenta ne troši limit (21 poziv prolazi)', async () => {
    const e = await mk(
      `${head} ${base} match /t/{id} { allow create: if ${Array(21)
        .fill(`get(${P('d/x')}).data.v == 1`)
        .join(' && ')}; } ${tail}`,
    );
    await seedDocs(e, ['x']);
    expect(await ok(setDoc(doc(e.unauthenticatedContext().firestore(), 't/1'), { a: 1 }))).toBe(
      'OK',
    );
  });
  it('limit je 10 RAZLIČITIH dokumenata po upisu: 10 prolazi, 11 pada', async () => {
    for (const [count, expected] of [
      [10, 'OK'],
      [11, 'DENIED'],
    ] as const) {
      const list = ids('x', count);
      const e = await mk(
        `${head} ${base} match /t/{id} { allow create: if ${getsOf(list)}; } ${tail}`,
      );
      await seedDocs(e, list);
      expect(
        await ok(setDoc(doc(e.unauthenticatedContext().firestore(), 't/1'), { a: 1 })),
        `${count} dokumenata`,
      ).toBe(expected);
      await e.cleanup();
    }
  });
  it('batch: 2 operacije × 10 različitih (ukupno 20) prolazi', async () => {
    const a = ids('a', 10),
      b = ids('b', 10);
    const e = await mk(
      `${head} ${base} match /t/{id} { allow create: if (request.resource.data.op == 'a' ? ${getsOf(a)} : ${getsOf(b)}); } ${tail}`,
    );
    await seedDocs(e, [...a, ...b]);
    const db = e.unauthenticatedContext().firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 't/1'), { op: 'a' });
    batch.set(doc(db, 't/2'), { op: 'b' });
    expect(await ok(batch.commit())).toBe('OK');
  });
});

describe('semantika koju koriste ključevi i CAS', () => {
  it('drugi set() na postojeći dokument je UPDATE (create-only pravilo ga odbija) => ključevi su jedinstveni', async () => {
    const e = await mk(
      `${head} match /k/{id} { allow create: if true; allow update: if false; } ${tail}`,
    );
    const db = e.unauthenticatedContext().firestore();
    expect(await ok(setDoc(doc(db, 'k/1'), { a: 1 }))).toBe('OK');
    expect(await ok(setDoc(doc(db, 'k/1'), { a: 2 }))).toBe('DENIED');
  });
  it('existsAfter/getAfter vide ostale zapise ISTOG batcha (atomarna provjera između dokumenata)', async () => {
    const e = await mk(
      `${head} match /d/{id} { allow create: if existsAfter(${P('k/$(id)')}); } match /k/{id} { allow create: if true; } ${tail}`,
    );
    const db = e.unauthenticatedContext().firestore();
    expect(await ok(setDoc(doc(db, 'd/1'), { a: 1 }))).toBe('DENIED');
    const b = writeBatch(db);
    b.set(doc(db, 'd/2'), { a: 1 });
    b.set(doc(db, 'k/2'), { a: 1 });
    expect(await ok(b.commit())).toBe('OK');
  });
  it('list.join() NE provjerava tipove elemenata (aliases se u Rules ne mogu provjeriti element-po-element)', async () => {
    const e = await mk(
      `${head} match /t/{id} { allow create: if request.resource.data.al.join('|').size() <= 10; } ${tail}`,
    );
    expect(
      await ok(setDoc(doc(e.unauthenticatedContext().firestore(), 't/1'), { al: [1, 2, 3] })),
    ).toBe('OK');
  });
});
