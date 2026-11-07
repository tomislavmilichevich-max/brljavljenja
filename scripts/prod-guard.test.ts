import { describe, expect, it } from 'vitest';
// @ts-expect-error — čisti ESM modul bez deklaracija tipova
import { EXPECTED, checkDist, checkEnv, checkRules, manifestOf } from './prod-guard.mjs';

const goodEnv = {
  VITE_FIREBASE_API_KEY: 'AIza' + 'A'.repeat(35),
  VITE_FIREBASE_AUTH_DOMAIN: EXPECTED.authDomain,
  VITE_FIREBASE_PROJECT_ID: EXPECTED.projectId,
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789012',
  VITE_FIREBASE_APP_ID: '1:123456789012:web:abcdef0123456789',
  VITE_HOUSEHOLD_ID: EXPECTED.householdId,
};

describe('checkEnv', () => {
  it('ispravna produkcijska konfiguracija nema problema', () => {
    expect(checkEnv(goodEnv)).toEqual([]);
  });
  it('prazan env: navodi sve obavezne varijable', () => {
    expect(checkEnv({}).length).toBe(6);
  });
  it('krivi projekt / authDomain / household se odbijaju', () => {
    expect(checkEnv({ ...goodEnv, VITE_FIREBASE_PROJECT_ID: 'drugi-projekt' }).join()).toContain(
      'PROJECT_ID',
    );
    expect(checkEnv({ ...goodEnv, VITE_FIREBASE_AUTH_DOMAIN: 'localhost' }).join()).toContain(
      'AUTH_DOMAIN',
    );
    expect(checkEnv({ ...goodEnv, VITE_HOUSEHOLD_ID: 'h1' }).join()).toContain('HOUSEHOLD_ID');
  });
  it('emulatori u produkcijskom buildu se odbijaju (i vrijednost "false")', () => {
    expect(checkEnv({ ...goodEnv, VITE_USE_EMULATORS: 'true' }).join()).toContain(
      'VITE_USE_EMULATORS',
    );
    expect(checkEnv({ ...goodEnv, VITE_USE_EMULATORS: 'false' }).join()).toContain(
      'VITE_USE_EMULATORS',
    );
  });
  it('placeholder API ključ i pogrešan oblik appId/senderId se odbijaju', () => {
    expect(checkEnv({ ...goodEnv, VITE_FIREBASE_API_KEY: 'fake-api-key' }).join()).toContain(
      'API_KEY',
    );
    expect(checkEnv({ ...goodEnv, VITE_FIREBASE_APP_ID: 'abc' }).join()).toContain('APP_ID');
    expect(checkEnv({ ...goodEnv, VITE_FIREBASE_MESSAGING_SENDER_ID: 'x' }).join()).toContain(
      'SENDER',
    );
  });
});

const f = (path: string, content: string) => ({ path, content: Buffer.from(content) });
const goodDist = () => [
  f('index.html', '<html>'),
  f('sw.js', 'const x=1'),
  f('manifest.webmanifest', '{}'),
  f('assets/index-abc.js', `projectId:"${EXPECTED.projectId}"`),
  f('assets/index-abc.css', 'a{}'),
  f('icons/icon.svg', '<svg/>'),
];

describe('checkDist', () => {
  it('ispravan dist prolazi', () => {
    expect(checkDist(goodDist())).toEqual([]);
  });
  it('emulatorska kuka / localhost URL / demo projekt u bundleu se odbijaju', () => {
    for (const bad of [
      '__e2eSignInWithEmulatorAccount',
      'http://127.0.0.1:9099',
      'demo-home-inventory-e2e',
    ]) {
      const d = goodDist();
      d[3] = f('assets/index-abc.js', `projectId:"${EXPECTED.projectId}" ${bad}`);
      expect(checkDist(d).join()).toContain('zabranjeni trag');
    }
  });
  it('nedopuštene datoteke (.env, source map, nepoznata JSON) se odbijaju', () => {
    for (const p of ['.env.production.local', 'assets/index-abc.js.map', 'secrets.json']) {
      expect(checkDist([...goodDist(), f(p, 'x')]).join()).toContain(p);
    }
  });
  it('bundle bez očekivanog projectId (npr. build bez konfiguracije) se odbija', () => {
    const d = goodDist();
    d[3] = f('assets/index-abc.js', 'nista');
    expect(checkDist(d).join()).toContain('projectId');
  });
  it('API ključ u service workeru se odbija', () => {
    const d = goodDist();
    d[1] = f('sw.js', 'AIza' + 'B'.repeat(35));
    expect(checkDist(d).join()).toContain('service worker');
  });
});

describe('manifestOf', () => {
  it('daje putanju, veličinu i skraćeni sha256, sortirano', () => {
    const m = manifestOf([f('b.js', 'bb'), f('a.js', 'a')]);
    expect(m.map((x: { path: string }) => x.path)).toEqual(['a.js', 'b.js']);
    expect(m[0]).toMatchObject({ bytes: 1 });
    expect(m[0].sha256).toHaveLength(12);
  });
});

describe('checkRules', () => {
  const good = `rules_version = '2';
service cloud.firestore { match /databases/{database}/documents {
  function isActiveMember(h) { return request.auth != null; }
  match /households/{householdId} { allow get: if isActiveMember(householdId);
    match /items/{itemId} { allow create, update: if isActiveMember(householdId) && true == true; } } } }`;
  it('pravila s upisima koji traže člana i poznatim putanjama prolaze', () => {
    expect(checkRules(good)).toEqual([]);
  });
  it('allow … if true, wildcard i upis bez provjere članstva se odbijaju', () => {
    expect(checkRules(good.replace('isActiveMember(householdId);', 'true;')).join()).toContain(
      'if true',
    );
    expect(checkRules(good + ' match /{document=**} { allow read: if false; }').join()).toContain(
      'wildcard',
    );
    expect(
      checkRules(
        good.replace(
          'allow create, update: if isActiveMember(householdId) && true == true;',
          'allow write: if request.auth != null;',
        ),
      ).join(),
    ).toContain('ne zahtijeva isActiveMember');
  });
  it('nepoznata putanja (npr. novi kolekcijski match) se odbija', () => {
    expect(
      checkRules(good.replace('match /items/{itemId}', 'match /secrets/{id}')).join(),
    ).toContain('nepoznata putanja');
  });
  it('komentar s "if true" ne daje lažni alarm', () => {
    expect(checkRules('// nikad allow read: if true\n' + good)).toEqual([]);
  });
  it('stvarna datoteka firestore.rules iz repozitorija prolazi', async () => {
    const { readFileSync } = await import('node:fs');
    expect(checkRules(readFileSync('firestore.rules', 'utf8'))).toEqual([]);
  });
});
