// Tehnička provedba odluka glavnog razvoja (P2-B): izvorni kod aplikacije ne smije sadržavati putove do skrivenog
// offline reda, trajnog lokalnog keša ni lokalne pohrane privatnog inventara. (Dopuna ESLint pravilu.)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
const strip = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('politika izvornog koda (bez skrivenog reda, bez trajnog keša)', () => {
  const files = sources('src');
  it('izvan repozitorija nema setDoc/updateDoc/addDoc/deleteDoc/writeBatch; repozitorij ih ne koristi (samo runTransaction)', () => {
    for (const f of files) {
      const code = strip(readFileSync(f, 'utf8'));
      expect(code, f).not.toMatch(/\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch)\b/);
    }
  });
  it('nigdje nema trajnog Firestore keša, enable/disableNetwork, localStorage/sessionStorage/indexedDB za inventar', () => {
    for (const f of files) {
      const code = strip(readFileSync(f, 'utf8'));
      expect(code, f).not.toMatch(
        /\b(persistentLocalCache|persistentSingleTabManager|persistentMultipleTabManager|enableIndexedDbPersistence|enableMultiTabIndexedDbPersistence|enableNetwork|disableNetwork|localStorage|sessionStorage|indexedDB)\b/,
      );
    }
  });
  it('podatkovna sesija koristi memoryLocalCache i inMemoryPersistence', () => {
    const code = readFileSync('src/firebase/dataSession.ts', 'utf8');
    expect(code).toMatch(/memoryLocalCache\(\)/);
    expect(code).toMatch(/inMemoryPersistence/);
  });
  it('repozitorij piše isključivo kroz runTransaction', () => {
    const code = strip(readFileSync('src/inventory/repository.ts', 'utf8'));
    expect(code).toMatch(/runTransaction/);
    expect((code.match(/tx\.(set|update|delete)\(/g) ?? []).length).toBeGreaterThan(5);
  });
});
