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
/** P2-C: račun (Odjava, Provjeri pristup) je u kartici "Više" (ili u kartici računa dok inventar još nije potvrđen). */
async function accountButton(page, name) {
  const any = page.getByRole('button', { name, exact: true });
  // sačekaj stabilno stanje (ne "Učitavanje inventara": tada se kartica računa još zamjenjuje)
  await page
    .locator(
      '[data-testid=tab-more], [data-testid=inv-error], [data-testid=inv-corrupt], [data-testid=inv-inconsistent], [data-testid=inv-open-error], [data-testid=own-uid], h1:has-text("Provjera pristupa nije uspjela")',
    )
    .first()
    .waitFor({ timeout: 30000 });
  if (await any.count()) return any.first();
  await page.getByTestId('tab-more').click();
  await page.getByTestId('account-card').waitFor({ timeout: 10000 });
  return any.first();
}

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
async function adminDelete(path) {
  const r = await fetch(`${FS}/${path}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer owner' },
  });
  if (!r.ok) throw new Error(`admin delete ${path}: ${r.status}`);
}

async function signInAs(page, _ctx, name) {
  await page.evaluate((n) => window.__e2eSignInWithEmulatorAccount(n), name.toLowerCase());
}

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
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    globalThis.__page = page; // za dijagnostiku pri padu
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
    await (await accountButton(page, 'Odjava')).click();
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
    await (await accountButton(page, 'Odjava')).click();
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

    // 8) P1-REV-02: opoziv tijekom otvorene sesije + jasno razlikovanje offline od potvrde sa servera.
    //    (Prag između povratka u prvi plan je 15 s — čekamo ga pa šaljemo visibilitychange.)
    await ctx.setOffline(true);
    await page.waitForTimeout(16000);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.getByTestId('stale-warning').waitFor({ timeout: 40000 });
    check(
      'E2E-11 offline revalidacija: prikaz ostaje, ali je označen kao NEPOTVRĐEN (ne "potvrđen sa servera")',
      (await page.getByTestId('household-name').count()) === 1 &&
        (await page.getByTestId('verified-at').count()) === 0,
    );
    await adminPatch(`households/${H}/members/${uidC}`, {
      uid: uidC,
      role: 'member',
      enabled: false,
    }); // vlasnik opoziva dok je korisnik offline
    await ctx.setOffline(false); // 'online' događaj -> odmah revalidacija
    await page.getByRole('heading', { name: 'Nemaš pristup' }).waitFor({ timeout: 40000 });
    check(
      'E2E-12 opoziv tijekom otvorene sesije: "Pristup odobren" nestaje bez reloada, naziv kućanstva uklonjen iz DOM-a',
      !(await page.locator('body').innerText()).includes('Testno kućanstvo') &&
        (await page.getByText('Pristup odobren').count()) === 0,
    );

    // 9) P1-REV-01: članstvo postoji, ali dokument kućanstva ne postoji -> NIJE odobren.
    await adminPatch(`households/${H}/members/${uidC}`, {
      uid: uidC,
      role: 'member',
      enabled: true,
    });
    await page.getByRole('button', { name: 'Provjeri ponovno' }).click();
    await page.getByTestId('household-name').waitFor({ timeout: 20000 });
    await adminDelete(`households/${H}`); // members/{uid} ostaje (subkolekcija bez roditelja)
    await (await accountButton(page, 'Provjeri pristup')).click();
    await page
      .getByRole('heading', { name: 'Provjera pristupa nije uspjela' })
      .waitFor({ timeout: 20000 });
    const body = await page.locator('body').innerText();
    check(
      'E2E-13 membership postoji, household ne postoji: poruka o nepostavljenom kućanstvu, NIKAD "Pristup odobren"',
      body.includes('dokument kućanstva nije postavljen') && !body.includes('Pristup odobren'),
    );

    check('E2E-14 nema neuhvaćenih JS grešaka', errors.length === 0, errors.join(' | '));
  } catch (e) {
    check('E2E izvršavanje', false, String(e).split('\n').slice(0, 12).join(' / '));
    if (globalThis.__page && process.env.E2E_SHOT) {
      await globalThis.__page
        .screenshot({ path: process.env.E2E_SHOT, fullPage: true })
        .catch(() => {});
      console.log(
        'BODY:',
        (
          await globalThis.__page
            .locator('body')
            .innerText()
            .catch(() => '')
        )
          .replace(/\s+/g, ' ')
          .slice(0, 600),
      );
    }
  } finally {
    await browser.close();
    try {
      process.kill(-vite.pid);
    } catch {
      /* već ugašen */
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nE2E: ${results.length - failed}/${results.length} PASS`);
  process.exit(failed ? 1 : 0);
})();
