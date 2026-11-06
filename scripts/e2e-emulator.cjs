/* NAPOMENA: ne pokriva pravi Google popup/redirect (Android) — to ostaje NOT VERIFIED.
 * E2E provjera P1 u pravom Chromiumu protiv Firebase Auth + Firestore EMULATORA (demo projekt, sintetski računi).
 * Pokretanje: npm run test:e2e   (traži predinstalirani Playwright: require('playwright'); nije ovisnost projekta).
 * Ne dira produkcijski Firebase; nikakvi stvarni računi ni podaci. */
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-home-inventory-e2e';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const BASE = 'http://127.0.0.1:5173';
const H = 'h1';
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

// Admin zapis (zaobilazi pravila — kao Firebase Console): "Authorization: Bearer owner".
async function adminPatch(path, fields) {
  const body = {
    fields: Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [
        k,
        typeof v === 'boolean' ? { booleanValue: v } : { stringValue: v },
      ]),
    ),
  };
  const r = await fetch(`${FS}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`admin write ${path}: ${r.status} ${await r.text()}`);
}

// Pravi Google popup nije izvediv u sandboxu (apis.google.com blokiran); koristi se emulatorski račun.
async function signInAs(page, _ctx, name) {
  await page.evaluate((n) => window.__e2eSignInWithEmulatorAccount(n), name.toLowerCase());
}

(async () => {
  const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    env: {
      ...process.env,
      VITE_FIREBASE_API_KEY: 'fake-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: '127.0.0.1',
      VITE_FIREBASE_PROJECT_ID: PROJECT,
      VITE_FIREBASE_MESSAGING_SENDER_ID: '1',
      VITE_FIREBASE_APP_ID: '1:1:web:1',
      VITE_HOUSEHOLD_ID: H,
      VITE_USE_EMULATORS: 'true',
    },
    stdio: 'ignore',
  });
  const browser = await chromium.launch();
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(BASE)).ok) break;
      } catch {
        /* čekaj */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE);

    // 1) Nečlan (C)
    await page.getByRole('button', { name: 'Prijava Google računom' }).waitFor();
    check('E2E-1 početno: ekran prijave', true);
    await signInAs(page, ctx, 'Carl');
    await page.getByRole('heading', { name: 'Nemaš pristup' }).waitFor({ timeout: 15000 });
    const uidC = await page.inputValue('[data-testid=own-uid]');
    check(
      'E2E-2 prijavljen nečlan -> "Nemaš pristup" + vlastiti UID',
      uidC.length > 5,
      `uid=${uidC.slice(0, 6)}…`,
    );
    check(
      'E2E-3 nečlan ne vidi podatke kućanstva',
      !(await page.locator('body').innerText()).includes('Testno kućanstvo'),
    );

    // 2) Vlasnik ručno odobri (kao u Console), korisnik pritisne "Provjeri ponovno"
    await adminPatch(`households/${H}`, { name: 'Testno kućanstvo', schemaVersion: '1' });
    await adminPatch(`households/${H}/members/${uidC}`, {
      uid: uidC,
      role: 'member',
      enabled: true,
    });
    await page.getByRole('button', { name: 'Provjeri ponovno' }).click();
    await page.getByTestId('household-name').waitFor({ timeout: 15000 });
    check(
      'E2E-4 nakon ručnog odobrenja: pristup odobren + naziv kućanstva',
      (await page.getByTestId('household-name').innerText()).includes('Testno kućanstvo'),
    );

    // 3) Reload zadržava prijavu i ponovno provjerava pristup
    await page.reload();
    await page.getByTestId('household-name').waitFor({ timeout: 15000 });
    check('E2E-5 reload: sesija ostaje, pristup ponovno potvrđen sa servera', true);

    // 4) Odjava
    await page.getByRole('button', { name: 'Odjava' }).click();
    await page.getByRole('button', { name: 'Prijava Google računom' }).waitFor();
    check(
      'E2E-6 odjava: ekran prijave, naziv kućanstva nije u DOM-u',
      !(await page.locator('body').innerText()).includes('Testno kućanstvo'),
    );

    // 5) Drugi račun (D) na istom uređaju: nema pristupa, ne vidi C-ove podatke
    await signInAs(page, ctx, 'Dora');
    await page.getByRole('heading', { name: 'Nemaš pristup' }).waitFor({ timeout: 15000 });
    const uidD = await page.inputValue('[data-testid=own-uid]');
    check(
      'E2E-7 drugi račun na istom uređaju: nema pristupa, drugi UID',
      uidD !== uidC && !(await page.locator('body').innerText()).includes('Testno kućanstvo'),
    );
    await page.getByRole('button', { name: 'Odjava' }).click();
    await page.getByRole('button', { name: 'Prijava Google računom' }).waitFor();

    // 6) Opoziv: C je i dalje prijavljen u emulatoru, ali enabled:false -> odbijen
    await adminPatch(`households/${H}/members/${uidC}`, {
      uid: uidC,
      role: 'member',
      enabled: false,
    });
    await signInAs(page, ctx, 'Carl');
    await page.getByRole('heading', { name: 'Nemaš pristup' }).waitFor({ timeout: 15000 });
    check(
      'E2E-8 opozvan član (enabled:false) -> "Nemaš pristup"',
      (await page.inputValue('[data-testid=own-uid]')) === uidC,
    );

    // 7) Ponovno odobren + offline provjera
    await adminPatch(`households/${H}/members/${uidC}`, {
      uid: uidC,
      role: 'member',
      enabled: true,
    });
    await ctx.setOffline(true);
    await page.getByRole('button', { name: 'Provjeri ponovno' }).click();
    await page
      .getByText('Nema veze s poslužiteljem')
      .waitFor({ timeout: 40000 })
      .catch(async (e) => {
        console.log('DEBUG body:', (await page.locator('body').innerText()).replace(/\s+/g, ' '));
        throw e;
      });
    check(
      'E2E-9 offline: pristup NIJE prikazan kao odobren, jasna poruka',
      (await page.getByTestId('household-name').count()) === 0,
    );
    await ctx.setOffline(false);
    await page.getByTestId('household-name').waitFor({ timeout: 20000 });
    check('E2E-10 povratak mreže: automatska ponovna provjera daje pristup', true);

    check('E2E-11 nema neuhvaćenih JS grešaka', errors.length === 0, errors.join(' | '));
  } catch (e) {
    check('E2E izvršavanje', false, String(e).split('\n')[0]);
  } finally {
    await browser.close();
    vite.kill();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nE2E: ${results.length - failed}/${results.length} PASS`);
  process.exit(failed ? 1 : 0);
})();
