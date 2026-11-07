/* E2E P2-B u pravom Chromiumu (pravi Firestore web SDK / WebChannel) protiv Auth + Firestore EMULATORA.
 * Pokretanje: npm run test:e2e:inventory (traži predinstalirani Playwright; nije ovisnost projekta).
 * Sintetski računi i podaci; nikad produkcija. NAPOMENA: ne pokriva pravi Google popup/redirect ni Android. */
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-home-inventory-e2e-inv';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const BASE = 'http://127.0.0.1:5173';
const H = 'h1';
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};
const hdr = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
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
    headers: hdr,
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`admin write ${path}: ${r.status}`);
}
async function adminList(col) {
  const r = await fetch(`${FS}/households/${H}/${col}?pageSize=300`, { headers: hdr });
  const j = await r.json();
  return (j.documents || []).map((d) => d.fields || {});
}
const names = async (col) => (await adminList(col)).map((f) => f.name && f.name.stringValue);

async function signInAs(page, name) {
  await page.evaluate((n) => window.__e2eSignInWithEmulatorAccount(n), name.toLowerCase());
}
async function joinHousehold(page, name) {
  await page.getByRole('heading', { name: 'Nemaš pristup' }).waitFor({ timeout: 20000 });
  const uid = await page.inputValue('[data-testid=own-uid]');
  await adminPatch(`households/${H}/members/${uid}`, { uid, role: 'member', enabled: true });
  await page.getByRole('button', { name: 'Provjeri ponovno' }).click();
  await page.getByTestId('household-name').waitFor({ timeout: 20000 });
  return uid;
}
const saved = (page, text) =>
  page.getByTestId('inv-status').filter({ hasText: text }).waitFor({ timeout: 20000 });

(async () => {
  // zaštita: ako je port 5173 zauzet starim poslužiteljem, testovi bi tiho pogađali krivi projekt
  if (
    await fetch(BASE).then(
      () => true,
      () => false,
    )
  ) {
    console.log('FAIL  port 5173 je zauzet (zaostali dev poslužitelj) — ugasi ga i ponovi');
    process.exit(2);
  }
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
    detached: true, // vlastita grupa procesa: kill(-pid) ubija i npx i vite (inače ostaje zaostali poslužitelj)
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
    await adminPatch(`households/${H}`, { name: 'E2E kuća', schemaVersion: '1' });
    const ctxA = await browser.newContext();
    const A = await ctxA.newPage();
    const errors = [];
    A.on('pageerror', (e) => errors.push(String(e)));
    await A.goto(BASE);
    await A.getByRole('button', { name: 'Prijava Google računom' }).waitFor();
    await signInAs(A, 'Ana');
    const uidA = await joinHousehold(A, 'Ana');

    // 1) prazno kućanstvo -> bootstrap
    await A.getByText('Kućanstvo još nema lokacija.').waitFor({ timeout: 20000 });
    check(
      'INV-1 prazno kućanstvo: ponuđena priprema (nikakvi demo podaci)',
      (await A.getByTestId('loc-list').locator('li').count()) === 0,
    );
    await A.getByRole('button', { name: 'Pripremi kućanstvo' }).first().click();
    await saved(A, 'spremljeno na serveru');
    await A.getByTestId('loc-root').waitFor();
    check(
      'INV-2 bootstrap stvorio root "Kuća" (potvrda sa servera, status "spremljeno na serveru")',
      true,
    );

    // 2) prostorija (samo pod root), ormar pod prostorijom
    await A.getByLabel('Naziv lokacije').fill('Kuhinja');
    await A.getByLabel('Vrsta lokacije').selectOption('room');
    const parentDisabled = await A.getByLabel('Nadređena lokacija').isDisabled();
    await A.getByRole('button', { name: 'Dodaj lokaciju' }).click();
    await A.getByTestId('loc-list').getByText('Kuhinja').waitFor({ timeout: 20000 });
    check(
      'INV-3 P2-LOC-ROOM-01 u UI: za prostoriju je roditelj zaključan na root, prostorija stvorena',
      parentDisabled,
    );
    await A.getByLabel('Naziv lokacije').fill('Ormar1');
    await A.getByLabel('Vrsta lokacije').selectOption('cabinet');
    await A.getByLabel('Nadređena lokacija').selectOption({ label: 'Kuća › Kuhinja' });
    await A.getByRole('button', { name: 'Dodaj lokaciju' }).click();
    await A.getByTestId('loc-list').getByText('Ormar1').waitFor({ timeout: 20000 });
    const kitchenLi = A.getByTestId('loc-list').locator('li', { hasText: 'Kuhinja' }).first();
    check(
      'INV-4 prostorija nema radnju premještanja u UI-ju',
      (await kitchenLi.getByText('Premjesti cijelu lokaciju').count()) === 0,
    );

    // 3) predmeti i smještaji
    await A.getByLabel('Naziv predmeta').fill('Čekić');
    await A.getByLabel('Vrsta predmeta').selectOption('unique');
    await A.getByLabel('Početna lokacija').selectOption({ label: 'Kuća › Kuhinja › Ormar1' });
    await A.getByRole('button', { name: 'Dodaj predmet' }).click();
    await A.getByTestId('item-list')
      .locator('li', { hasText: 'Čekić' })
      .getByTestId('pl-path')
      .filter({ hasText: 'Kuća › Kuhinja › Ormar1' })
      .waitFor({ timeout: 20000 });
    check('INV-5 predmet + prvi smještaj; prikazana puna putanja', true);
    await A.getByLabel('Naziv predmeta').fill('Baterije');
    await A.getByLabel('Vrsta predmeta').selectOption('type');
    await A.getByRole('button', { name: 'Dodaj predmet' }).click();
    const bat = A.getByTestId('item-list').locator('li', { hasText: 'Baterije' }).first();
    await bat.getByText('bez smještaja').waitFor({ timeout: 20000 });
    await bat.locator('summary').click();
    await bat
      .getByLabel('Dodaj smještaj za Baterije')
      .selectOption({ label: 'Kuća › Kuhinja › Ormar1' });
    await bat.getByRole('button', { name: 'Dodaj smještaj' }).click();
    await bat.getByTestId('pl-path').first().waitFor({ timeout: 20000 });
    await bat.getByLabel('Dodaj smještaj za Baterije').selectOption({ label: 'Kuća' });
    await bat.getByRole('button', { name: 'Dodaj smještaj' }).click();
    await bat.getByTestId('pl-path').nth(1).waitFor({ timeout: 20000 });
    const opts = await bat
      .getByLabel('Dodaj smještaj za Baterije')
      .locator('option')
      .allTextContents();
    check(
      'INV-6 isti predmet na dvije lokacije; već zauzete lokacije se više ne nude (duplikat se ni ne može odabrati)',
      !opts.includes('Kuća') && !opts.includes('Kuća › Kuhinja › Ormar1'),
    );

    // 4) premještaj jednog smještaja i cijele lokacije
    const hammer = A.getByTestId('item-list').locator('li', { hasText: 'Čekić' }).first();
    await hammer.getByLabel(/Premjesti smještaj Čekić/).selectOption({ label: 'Kuća' });
    await hammer.getByRole('button', { name: 'Premjesti', exact: true }).click();
    await hammer
      .getByTestId('pl-path')
      .filter({ hasText: /^Kuća$/ })
      .waitFor({ timeout: 20000 });
    check(
      'INV-7 premještaj jednog smještaja (drugi smještaji ostaju)',
      (await bat.getByTestId('pl-path').count()) === 2,
    );
    const cab = A.getByTestId('loc-list').locator('li', { hasText: 'Ormar1' }).first();
    await cab.locator('summary').click();
    await cab.getByLabel(/Premjesti Ormar1 pod/).selectOption({ label: 'Kuća' });
    await cab.getByRole('button', { name: 'Premjesti cijelu lokaciju' }).click();
    await A.getByTestId('loc-list').locator('li', { hasText: 'Ormar1' }).first().waitFor();
    await bat
      .getByTestId('pl-path')
      .filter({ hasText: /^Kuća › Ormar1$/ })
      .waitFor({ timeout: 20000 });
    check(
      'INV-8 premještaj cijele lokacije mijenja samo parentId: putanje smještaja se izvode iznova',
      true,
    );

    // 5) drugi korisnik vidi uživo
    const ctxB = await browser.newContext();
    const B = await ctxB.newPage();
    await B.goto(BASE);
    await B.getByRole('button', { name: 'Prijava Google računom' }).waitFor();
    await signInAs(B, 'Bruno');
    const uidB = await joinHousehold(B, 'Bruno');
    await B.getByTestId('item-list')
      .locator('li', { hasText: 'Čekić' })
      .waitFor({ timeout: 20000 });
    await A.getByLabel('Naziv predmeta').fill('Uživo predmet');
    await A.getByRole('button', { name: 'Dodaj predmet' }).click();
    await B.getByTestId('item-list')
      .locator('li', { hasText: 'Uživo predmet' })
      .waitFor({ timeout: 20000 });
    // A mora primiti potvrdu vlastitog spremanja prije prekida veze (inače bi test mjerio neodređen ishod)
    await A.getByTestId('inv-status')
      .filter({ hasText: 'spremljeno na serveru' })
      .waitFor({ timeout: 20000 });
    check('INV-9 korisnik B vidi izmjenu korisnika A uživo, bez ponovnog učitavanja', true);

    // 6) offline u pravom Chromiumu: UI odmah prelazi u "stale" i blokira izmjene; nema skrivenog reda
    await ctxA.setOffline(true);
    await A.getByTestId('inv-stale').waitFor({ timeout: 45000 });
    await A.getByLabel('Naziv predmeta').fill('OFFLINE-predmet');
    const addDisabled = await A.getByRole('button', { name: 'Dodaj predmet' }).isDisabled();
    await A.getByLabel('Naziv predmeta').press('Enter'); // Enter ne smije zaobići onemogućeni gumb
    await A.waitForTimeout(1500);
    const statusAfterEnter = await A.getByTestId('inv-status')
      .innerText()
      .catch(() => '');
    check(
      'INV-10 offline u Chromiumu: banner "veza prekinuta", gumbi onemogućeni, Enter ne šalje, nema statusa "Spremanje"',
      addDisabled &&
        !statusAfterEnter.includes('Spremanje') &&
        !statusAfterEnter.includes('spremljeno'),
      statusAfterEnter.slice(0, 80),
    );
    await ctxA.setOffline(false);
    await A.getByTestId('inv-stale').waitFor({ state: 'detached', timeout: 60000 });
    await A.waitForTimeout(5000);
    const afterOnline = await names('items');
    check(
      'INV-11 nakon povratka veze: stanje opet "ready", a NIŠTA što je tipkano offline nije poslano (nema skrivenog reda)',
      !afterOnline.some((n) => n && n.startsWith('OFFLINE')),
    );

    // 7) opoziv B tijekom otvorenog panela
    await adminPatch(`households/${H}/members/${uidB}`, {
      uid: uidB,
      role: 'member',
      enabled: false,
    });
    await A.getByLabel('Naziv predmeta').fill('Okidač promjene');
    await A.getByRole('button', { name: 'Dodaj predmet' }).click();
    let viaListener = true;
    await B.getByRole('heading', { name: 'Nemaš pristup' })
      .waitFor({ timeout: 25000 })
      .catch(() => (viaListener = false));
    console.log(
      'INFO opoziv: B je to otkrio ' +
        (viaListener ? 'preko listenera (nakon promjene podataka)' : 'tek ručnom provjerom'),
    );
    if (!viaListener) {
      await B.getByRole('button', { name: 'Provjeri pristup' }).click();
      await B.getByRole('heading', { name: 'Nemaš pristup' }).waitFor({ timeout: 20000 });
    }
    const bodyB = await B.locator('body').innerText();
    check(
      'INV-12 opoziv: B nema prikaz inventara, nijedan naziv nije u DOM-u',
      !bodyB.includes('Čekić') &&
        !bodyB.includes('Kuhinja') &&
        (await B.getByTestId('inventory').count()) === 0,
    );

    // 8) IndexedDB: nikakav Firestore keš ni sekundarni auth token u trajnoj pohrani
    const dbNames = await A.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    const authKeys = await A.evaluate(
      async () =>
        new Promise((resolve) => {
          const req = indexedDB.open('firebaseLocalStorageDb');
          req.onerror = () => resolve([]);
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('firebaseLocalStorage')) return resolve([]);
            const all = db
              .transaction('firebaseLocalStorage')
              .objectStore('firebaseLocalStorage')
              .getAllKeys();
            all.onsuccess = () => resolve(all.result);
            all.onerror = () => resolve([]);
          };
        }),
    );
    console.log(
      'INFO IndexedDB baze:',
      JSON.stringify(dbNames),
      '| auth ključevi:',
      JSON.stringify(authKeys),
    );
    check(
      'INV-13 u IndexedDB nema Firestore keša; trajni auth token postoji samo za primarnu app ([DEFAULT]), nikad za podatkovne sesije (data-*)',
      !dbNames.some((n) => n && n.startsWith('firestore/')) &&
        authKeys.every((k) => String(k).endsWith(':[DEFAULT]')) &&
        !authKeys.some((k) => String(k).includes('data-')),
    );

    // 9) odjava A: sve nestaje; promjena računa na nečlana
    await A.getByRole('button', { name: 'Odjava' }).click();
    await A.getByRole('button', { name: 'Prijava Google računom' }).waitFor();
    const bodyA = await A.locator('body').innerText();
    check(
      'INV-14 odjava: nijedan podatak inventara u DOM-u, panel uklonjen',
      !bodyA.includes('Čekić') &&
        !bodyA.includes('Ormar1') &&
        (await A.getByTestId('inventory').count()) === 0,
    );
    const keysAfter = await A.evaluate(
      async () =>
        new Promise((resolve) => {
          const req = indexedDB.open('firebaseLocalStorageDb');
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('firebaseLocalStorage')) return resolve([]);
            const all = db
              .transaction('firebaseLocalStorage')
              .objectStore('firebaseLocalStorage')
              .getAllKeys();
            all.onsuccess = () => resolve(all.result);
          };
          req.onerror = () => resolve([]);
        }),
    );
    check(
      'INV-15 nakon odjave u trajnoj pohrani nema nikakvog auth tokena',
      keysAfter.length === 0,
      JSON.stringify(keysAfter),
    );
    await signInAs(A, 'Cvijeta'); // drugi račun na ISTOM uređaju, nije član
    await A.getByRole('heading', { name: 'Nemaš pristup' }).waitFor({ timeout: 20000 });
    const bodyC = await A.locator('body').innerText();
    check(
      'INV-16 promjena računa: nečlan na istom uređaju ne vidi NIŠTA od prethodnog inventara',
      !bodyC.includes('Čekić') && !bodyC.includes('Kuhinja') && !bodyC.includes('Baterije'),
    );
    check(
      'INV-17 nema neuhvaćenih JS grešaka (korisnik A)',
      errors.length === 0,
      errors.join(' | ').slice(0, 300),
    );
    void uidA;
  } catch (e) {
    check('E2E izvršavanje', false, String(e).split('\n')[0]);
  } finally {
    await browser.close();
    try {
      process.kill(-vite.pid);
    } catch {
      /* već ugašen */
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nE2E-INV: ${results.length - failed}/${results.length} PASS`);
  process.exit(failed ? 1 : 0);
})();
