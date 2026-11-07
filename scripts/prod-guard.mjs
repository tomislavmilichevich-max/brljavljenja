// Zaštitne provjere za P1.5 (stvarni Firebase projekt). Čiste funkcije — testirane u prod-guard.test.ts.
// Svrha: spriječiti da se u produkciju objavi build s emulatorom, krivim projektom ili placeholder
// konfiguracijom, te da se objave nepredviđene datoteke ili otvorena pravila.
import { createHash } from 'node:crypto';

export const EXPECTED = Object.freeze({
  projectId: 'home-inventory-pwa-218be',
  authDomain: 'home-inventory-pwa-218be.firebaseapp.com',
  householdId: 'kuca1',
});

/** Provjera VITE_* varijabli za produkcijski build. Vraća popis problema (prazno = u redu). */
export function checkEnv(env) {
  const problems = [];
  const v = (k) => (env[k] ?? '').trim();
  for (const k of [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
    'VITE_HOUSEHOLD_ID',
  ]) {
    if (!v(k)) problems.push(`${k} nije postavljen`);
  }
  if (v('VITE_FIREBASE_PROJECT_ID') && v('VITE_FIREBASE_PROJECT_ID') !== EXPECTED.projectId)
    problems.push(
      `VITE_FIREBASE_PROJECT_ID mora biti ${EXPECTED.projectId} (zadano: ${v('VITE_FIREBASE_PROJECT_ID')})`,
    );
  if (v('VITE_FIREBASE_AUTH_DOMAIN') && v('VITE_FIREBASE_AUTH_DOMAIN') !== EXPECTED.authDomain)
    problems.push(
      `VITE_FIREBASE_AUTH_DOMAIN mora biti ${EXPECTED.authDomain} (zadano: ${v('VITE_FIREBASE_AUTH_DOMAIN')})`,
    );
  if (v('VITE_HOUSEHOLD_ID') && v('VITE_HOUSEHOLD_ID') !== EXPECTED.householdId)
    problems.push(
      `VITE_HOUSEHOLD_ID mora biti ${EXPECTED.householdId} (zadano: ${v('VITE_HOUSEHOLD_ID')})`,
    );
  if (v('VITE_USE_EMULATORS'))
    problems.push('VITE_USE_EMULATORS ne smije biti postavljen u produkcijskom buildu');
  if (v('VITE_FIREBASE_API_KEY') && !/^AIza[0-9A-Za-z_-]{35}$/.test(v('VITE_FIREBASE_API_KEY')))
    problems.push(
      'VITE_FIREBASE_API_KEY nema oblik Firebase web API ključa (AIza…, 39 znakova) — placeholder?',
    );
  if (
    v('VITE_FIREBASE_MESSAGING_SENDER_ID') &&
    !/^\d{6,}$/.test(v('VITE_FIREBASE_MESSAGING_SENDER_ID'))
  )
    problems.push('VITE_FIREBASE_MESSAGING_SENDER_ID mora biti broj');
  if (v('VITE_FIREBASE_APP_ID') && !/^1:\d+:web:[0-9a-f]+$/.test(v('VITE_FIREBASE_APP_ID')))
    problems.push('VITE_FIREBASE_APP_ID nema oblik 1:<broj>:web:<hex>');
  return problems;
}

// Dopuštene datoteke u dist (ništa drugo ne smije u Hosting).
const ALLOWED = [
  /^index\.html$/,
  /^sw\.js$/,
  /^manifest\.webmanifest$/,
  /^assets\/[\w.-]+\.(js|css)$/,
  /^icons\/[\w.-]+\.(png|svg)$/,
];
// Tragovi razvojnog/emulatorskog koda i test podataka koji se ne smiju naći u produkcijskom bundleu.
const FORBIDDEN_IN_BUNDLE = [
  '__e2eSignInWithEmulatorAccount',
  'http://127.0.0.1:9099',
  'demo-home-inventory',
  'fake-api-key',
];

// P2-C: demo podaci i demo kontrole iz UI/UX prototipa NIKAD ne smiju u produkcijski bundle (nizovi su specifični za
// prototip i sintetski fixture; obični korisnički tekst ih ne sadrži).
export const DEMO_MARKERS = Object.freeze([
  'simulatedWrite',
  '__demoSeq',
  'fixtureOnly',
  'P2_DEMO_HOUSE',
  'demo-house',
  'testScenarios',
  'Demo i statusi',
  'set-outcome',
  'verifyResolution',
  'DEMO kuća',
  'Regal A',
  'Kutija začina',
  'Božićni ukrasi',
  'Đurđevak',
  'TV ormarić',
  'Set imbus',
  'Ormar s alatom',
]);

/** files: [{ path: 'assets/x.js', content: Buffer|string }] relativno na dist. */
export function checkDist(files, { projectId = EXPECTED.projectId } = {}) {
  const problems = [];
  for (const f of files) {
    if (!ALLOWED.some((re) => re.test(f.path)))
      problems.push(`nedopuštena datoteka u dist: ${f.path}`);
  }
  for (const need of ['index.html', 'sw.js', 'manifest.webmanifest']) {
    if (!files.some((f) => f.path === need)) problems.push(`nedostaje ${need}`);
  }
  const js = files.filter((f) => f.path.endsWith('.js') && f.path !== 'sw.js');
  const text = js.map((f) => f.content.toString()).join('\n');
  for (const bad of FORBIDDEN_IN_BUNDLE) {
    if (text.includes(bad)) problems.push(`bundle sadrži zabranjeni trag: ${bad}`);
  }
  for (const marker of DEMO_MARKERS) {
    if (text.includes(marker)) problems.push(`bundle sadrži demo podatak/kontrolu: ${marker}`);
  }
  if (!text.includes(projectId)) problems.push(`bundle ne sadrži očekivani projectId ${projectId}`);
  if (
    /AIza[0-9A-Za-z_-]{35}/.test(
      files
        .filter((f) => f.path === 'sw.js')
        .map((f) => f.content.toString())
        .join(''),
    )
  ) {
    problems.push('service worker sadrži API ključ');
  }
  return problems;
}

/** Što će se TOČNO objaviti: putanja, veličina, sha256 (prvih 12 znakova). */
export function manifestOf(files) {
  return files
    .map((f) => {
      const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content);
      return {
        path: f.path,
        bytes: buf.length,
        sha256: createHash('sha256').update(buf).digest('hex').slice(0, 12),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

// Jedine putanje koje pravila smiju sadržavati (P1 + P2-A). Nova putanja traži svjesnu izmjenu ovdje.
export const ALLOWED_MATCHES = Object.freeze([
  '/databases/{database}/documents',
  '/households/{householdId}',
  '/members/{uid}',
  '/meta/{docId}',
  '/locations/{locationId}',
  '/items/{itemId}',
  '/placements/{placementId}',
  '/placementKeys/{keyId}',
]);

/**
 * Pravila: verzija 2, bez `if true`, bez rekurzivnog wildcarda, SVAKI `allow` mora zahtijevati aktivnog člana
 * (isActiveMember), i samo poznate putanje. Vraća popis problema.
 */
export function checkRules(text) {
  const problems = [];
  const code = text.replace(/\/\/.*$/gm, '');
  if (!/rules_version\s*=\s*'2'/.test(code)) problems.push("nedostaje rules_version = '2'");
  if (/allow[^;]*:\s*if\s+true\b/.test(code)) problems.push('pravila sadrže "allow … if true"');
  if (/\{[A-Za-z_]*=\*\*\}/.test(code))
    problems.push('rekurzivni wildcard match ({x=**}) nije dopušten');
  for (const m of code.matchAll(/allow\s+([^:]+):\s*if\s+([\s\S]*?);/g)) {
    if (!m[2].includes('isActiveMember('))
      problems.push(`allow ${m[1].trim()} ne zahtijeva isActiveMember`);
  }
  for (const m of code.matchAll(/\bmatch\s+(\/[^\s{][^\s]*|\/\{[^\s]*)\s*\{/g)) {
    if (!ALLOWED_MATCHES.includes(m[1])) problems.push(`nepoznata putanja u pravilima: ${m[1]}`);
  }
  return problems;
}

export function rulesHash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}
