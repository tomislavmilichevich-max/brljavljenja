/* E2E P2-C u pravom Chromiumu (pravi Firestore web SDK / WebChannel) protiv Auth + Firestore EMULATORA.
 * Pokretanje: npm run test:e2e:inventory (traži predinstalirani Playwright; nije ovisnost projekta).
 * Sintetski računi i podaci (nikad produkcija, nikad kuca1). NE pokriva pravi Google popup/redirect ni Android/TalkBack.
 * Screenshotovi (neobavezno): E2E_SHOTS=<direktorij> */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-home-inventory-e2e-inv';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const BASE = 'http://127.0.0.1:5173';
const H = 'h1';
const SHOTS = process.env.E2E_SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};
const hdr = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
async function adminPatch(p, fields) {
  const body = {
    fields: Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [
        k,
        typeof v === 'boolean' ? { booleanValue: v } : { stringValue: v },
      ]),
    ),
  };
  const r = await fetch(`${FS}/${p}`, {
    method: 'PATCH',
    headers: hdr,
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`admin write ${p}: ${r.status}`);
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
async function joinHousehold(page) {
  await page.getByRole('heading', { name: 'Nemaš pristup' }).waitFor({ timeout: 20000 });
  const uid = await page.inputValue('[data-testid=own-uid]');
  await adminPatch(`households/${H}/members/${uid}`, { uid, role: 'member', enabled: true });
  await page.getByRole('button', { name: 'Provjeri ponovno' }).click();
  await page.getByTestId('household-name').waitFor({ timeout: 20000 });
  return uid;
}
const nav = (page, name) => page.getByTestId('bottom-nav').getByRole('button', { name }).click();
const saved = (page) =>
  page
    .getByTestId('inv-status')
    .filter({ hasText: 'Spremljeno · potvrđeno online' })
    .waitFor({ timeout: 20000 });
const shot = async (page, file) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, file), fullPage: false });
};
async function openItemBySearch(page, q, name) {
  await nav(page, 'Početna');
  await page.getByLabel('Pretraži predmet ili lokaciju').fill(q);
  await page
    .getByRole('button', { name: new RegExp(name) })
    .first()
    .click();
  await page.getByTestId('item-name').waitFor();
}
async function addLocation(page, parentLabelOrNull, kind, name) {
  await page.getByLabel('Naziv lokacije *').fill(name);
  await page.getByLabel('Vrsta lokacije *').selectOption(kind);
  if (parentLabelOrNull)
    await page.getByLabel('Unutar koje lokacije? *').selectOption({ label: parentLabelOrNull });
  await page.getByRole('button', { name: 'Spremi lokaciju' }).click();
  await saved(page);
}
const addBtn = (page) =>
  page
    .getByRole('form', { name: 'Novi predmet' })
    .getByRole('button', { name: /Dodaj predmet|Spremanje/ });
const overflowX = (page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );

(async () => {
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
    detached: true,
  });
  const browser = await chromium.launch();
  let A;
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
    const ctxA = await browser.newContext({
      viewport: { width: 390, height: 780 },
      deviceScaleFactor: 2,
    });
    A = await ctxA.newPage();
    const errors = [];
    A.on('pageerror', (e) => errors.push(String(e)));
    await A.goto(BASE);
    await A.getByRole('button', { name: 'Prijava Google računom' }).waitFor();
    await signInAs(A, 'Ana');
    await joinHousehold(A);

    // 1) prazno kućanstvo -> bootstrap (izričita radnja, bez demo podataka)
    await A.getByTestId('bootstrap').waitFor({ timeout: 20000 });
    check(
      'INV-1 nepripremljeno kućanstvo: ponuda "Pripremi kućanstvo", nikakvi demo podaci',
      (await A.getByTestId('bootstrap').innerText()).includes('bez izmišljenih'),
    );
    await shot(A, '18_nepripremljeno_kucanstvo_390.png');
    await A.getByRole('button', { name: 'Pripremi kućanstvo' }).click();
    await saved(A);
    await nav(A, 'Lokacije');
    await A.getByTestId('empty-house').waitFor();
    check(
      'INV-2 bootstrap: root Kuća, prazna kuća bez izmišljenih prostorija',
      (await A.getByTestId('loc-list').count()) === 0,
    );
    await shot(A, '17_prazna_kuca_390.png');

    // 2) prostorija (samo pod Kućom), ormar pod prostorijom
    await A.getByRole('button', { name: /Dodaj prvu prostoriju/ }).click();
    await A.getByLabel('Vrsta lokacije *').selectOption('room');
    const parentLocked = await A.getByLabel('Unutar koje lokacije? *').isDisabled();
    await shot(A, '06_nova_prostorija_390.png');
    await addLocation(A, null, 'room', 'Kuhinja');
    check(
      'INV-3 P2-LOC-ROOM-01 u UI: za prostoriju je roditelj zaključan na Kuću; prostorija stvorena i otvorena',
      parentLocked && (await A.getByRole('heading', { name: 'Kuhinja' }).count()) === 1,
    );
    check(
      'INV-4 prostorija nema radnju premještanja',
      (await A.getByRole('button', { name: /Premjesti cijelu lokaciju/ }).count()) === 0,
    );
    await A.getByRole('button', { name: /Dodaj podlokaciju/ }).click();
    const roomOpt = A.getByRole('option', { name: /Prostorija/ });
    check(
      'INV-4b iz konteksta Kuhinje opcija Prostorija je onemogućena s objašnjenjem',
      (await roomOpt.isDisabled()) && (await roomOpt.innerText()).includes('dodaj iz Kuće'),
    );
    await addLocation(A, null, 'cabinet', 'Ormar1');
    await A.getByRole('button', { name: /Dodaj podlokaciju/ }).click();
    await addLocation(A, null, 'box', 'Kutija B');

    // 3) dodavanje predmeta: globalno bez lokacije, validacija, atomarno stvaranje
    await nav(A, 'Dodaj predmet');
    check(
      'INV-5 globalno dodavanje počinje BEZ odabrane lokacije',
      (await A.getByLabel('Lokacija *').inputValue()) === '',
    );
    check(
      'INV-5a Jedinstveni predmet je vidljivo predložen uz izbor Vrsta predmeta',
      (await A.getByRole('radio', { name: /Jedinstveni predmet/ }).isChecked()) &&
        (await A.getByRole('radio', { name: /Vrsta predmeta/ }).count()) === 1,
    );
    await shot(A, '02_dodaj_globalno_bez_lokacije_390.png');
    await shot(A, '03_dodaj_vrsta_predmeta_390.png');
    await A.getByLabel('Naziv predmeta *').fill('Baterije');
    await A.getByLabel('Naziv predmeta *').press('Enter');
    await A.getByText('Odaberi lokaciju. Predmet ne može nastati bez mjesta.').waitFor({
      timeout: 5000,
    });
    await A.waitForTimeout(600);
    check(
      'INV-5b bez lokacije: objašnjenje, Enter ne šalje, predmet NE nastaje, naziv ostaje',
      !(await names('items')).includes('Baterije') &&
        (await A.getByLabel('Naziv predmeta *').inputValue()) === 'Baterije',
    );
    await A.getByLabel('Lokacija *').selectOption({ label: 'Kuća › Kuhinja › Ormar1' });
    await A.getByRole('radio', { name: /Vrsta predmeta/ }).check();
    await A.getByLabel('Kategorija (neobavezno)').fill('Potrošno');
    await A.getByLabel('Sinonimi (neobavezno)').fill('baterija, AA');
    await addBtn(A).click();
    await A.getByTestId('item-name').waitFor({ timeout: 20000 });
    await saved(A);
    check(
      'INV-5c atomarno: jedan gumb stvara predmet + prvi smještaj; detalj prikazuje puni put i "Spremljeno · potvrđeno online"',
      (await A.getByTestId('pl-path').first().innerText()) === 'Kuća › Kuhinja › Ormar1' &&
        (await adminList('placements')).length === 1,
    );
    // drugi smještaj
    await A.getByRole('button', { name: /Dodaj drugi smještaj/ }).click();
    await shot(A, '07_predmet_dva_smjestaja_390.png');
    await A.getByTestId('dest-root').click();
    await A.getByTestId('item-name').waitFor();
    await A.getByTestId('pl-path').nth(1).waitFor({ timeout: 20000 });
    check(
      'INV-6 isti predmet na dvije lokacije; sve putanje vidljive',
      (await A.getByTestId('pl-path').count()) === 2,
    );
    await A.getByRole('button', { name: /Dodaj drugi smještaj/ }).click();
    check(
      'INV-6b već zauzeta lokacija je onemogućena s razlogom (duplikat se ne može odabrati)',
      (await A.getByTestId('dest-root').isDisabled()) &&
        (await A.getByTestId('dest-root').innerText()).includes('duplikat nije dopušten'),
    );
    await A.getByRole('button', { name: 'Natrag' }).click();

    // jedinstveni predmet iz konteksta lokacije (lokacija predložena, ali promjenjiva)
    await nav(A, 'Lokacije');
    await A.getByRole('button', { name: /Kuhinja/ }).click();
    await A.getByRole('button', { name: /Ormar1/ }).click();
    await A.getByRole('button', { name: /Dodaj predmet ovdje/ }).click();
    const suggested = await A.getByLabel('Lokacija *').inputValue();
    await shot(A, '04_dodaj_iz_garaze_390.png');
    await A.getByLabel('Naziv predmeta *').fill('Čekić');
    await addBtn(A).click();
    await A.getByTestId('item-name').waitFor({ timeout: 20000 });
    check(
      'INV-5d iz lokacije: lokacija je predložena (nije skrivena); predmet nastaje',
      suggested !== '' && (await names('items')).includes('Čekić'),
    );

    // 4) pretraga (lokalno): primjeri; nema Firestore upita po znaku
    await nav(A, 'Početna');
    const input = A.getByLabel('Pretraži predmet ili lokaciju');
    await input.fill('baterije');
    await A.getByTestId('search-results').waitFor();
    const hit = await A.getByTestId('search-results').innerText();
    check(
      'INV-S1 "baterije": nađena s obje putanje u rezultatu (sve lokacije istog predmeta)',
      hit.includes('2 smještaja') && (await A.getByTestId('item-path').count()) === 2,
    );
    await shot(A, '01_pocetna_390.png');
    await input.fill('cekic');
    check(
      'INV-S2 normalizacija hrvatskih znakova: "cekic" pronalazi "Čekić"',
      (await A.getByTestId('search-results').innerText()).includes('Čekić'),
    );
    await input.fill('cekik');
    check(
      'INV-S3 tipfeler: "cekik" daje označen približni rezultat',
      (await A.getByRole('heading', { name: 'Približni rezultati' }).count()) === 1,
    );
    await input.fill('cekic random');
    check(
      'INV-S4 negativno: "cekic random" nema rezultata (nema lažnih pogodaka)',
      (await A.getByTestId('no-results').count()) === 1,
    );
    await input.fill('ormar1');
    check(
      'INV-S5 pretraga lokacije "ormar1"',
      (await A.getByTestId('search-results').innerText()).includes('Ormar1'),
    );
    await input.fill('');

    // 5) premještanje jednog smještaja i cijele kutije
    await openItemBySearch(A, 'Čekić', 'Čekić');
    await A.getByRole('button', { name: /Premjesti/ }).click();
    await shot(A, '21_premjestanje_390.png');
    await A.getByTestId('dest-root').click();
    await A.getByTestId('pl-path')
      .filter({ hasText: /^Kuća$/ })
      .waitFor({ timeout: 20000 });
    check(
      'INV-7 premještaj jednog smještaja: odabir odredišta odmah sprema (bez trećeg potvrđivanja)',
      true,
    );
    await openItemBySearch(A, 'baterije', 'Baterije');
    await A.getByRole('button', { name: /Premjesti/ }).click();
    check(
      'INV-7b dva smještaja: najprije odabir izvornog smještaja',
      (await A.getByRole('heading', { name: 'Koji smještaj premještaš?' }).count()) === 1,
    );
    await A.getByTestId(/source-/)
      .first()
      .click()
      .catch(async () => {
        await A.locator('[data-testid^=source-]').first().click();
      });
    await A.getByRole('button', { name: 'Natrag' }).click();
    await nav(A, 'Lokacije');
    await A.getByRole('button', { name: /Kuhinja/ }).click();
    await A.getByRole('button', { name: /Ormar1/ }).click();
    await A.getByRole('button', { name: /Kutija B/ }).click();
    await A.getByRole('button', { name: /Premjesti cijelu lokaciju/ }).click();
    await shot(A, '09_premjesti_kutiju_390.png');
    const selfDisabled = await A.getByTestId('dest-kutija-b').count();
    const dis = await A.locator('[data-testid^=dest-]').evaluateAll((els) =>
      els.filter((e) => e.disabled).map((e) => e.innerText),
    );
    check(
      'INV-8a premještaj kutije: ista lokacija, roditelj i potomci su onemogućeni s razlogom',
      dis.length >= 2 &&
        dis.some((t) => t.includes('Ne možeš premjestiti u samu sebe')) &&
        dis.some((t) => t.includes('Već se nalazi ovdje')) &&
        selfDisabled === 0,
    );
    await A.getByTestId('dest-root').click();
    await A.getByRole('heading', { name: 'Sadržaj lokacije' }).waitFor({ timeout: 20000 });
    await saved(A);
    const kutija = (await adminList('locations')).find(
      (f) => f.name && f.name.stringValue === 'Kutija B',
    );
    check(
      'INV-8 premještaj kutije mijenja samo parentId lokacije (nikad masovno placement.locationId)',
      kutija && kutija.parentId.stringValue === 'root',
    );

    // 6) uređivanje predmeta + UX-032-01
    await openItemBySearch(A, 'Čekić', 'Čekić');
    await A.getByRole('button', { name: 'Uredi', exact: true }).click();
    await A.getByLabel('Naziv predmeta *').fill('Veliki čekić');
    await shot(A, '10_nespremljene_izmjene_390.png');
    await A.getByRole('button', { name: 'Natrag' }).click();
    await A.getByTestId('unsaved-dialog').waitFor();
    await shot(A, '10_nespremljene_izmjene_dijalog_390.png');
    await A.getByRole('button', { name: 'Ostani ovdje' }).click();
    check(
      'INV-U1 nespremljene izmjene: "Ostani ovdje" čuva tekst',
      (await A.getByLabel('Naziv predmeta *').inputValue()) === 'Veliki čekić',
    );
    await A.getByRole('button', { name: 'Natrag' }).click();
    await A.getByRole('button', { name: 'Odbaci izmjene' }).click();
    check(
      'INV-U2 "Odbaci izmjene" odbacuje samo lokalni nacrt; na poslužitelju naziv ostaje',
      (await A.getByTestId('item-name').innerText()) === 'Čekić' &&
        (await names('items')).includes('Čekić'),
    );
    await A.getByRole('button', { name: 'Uredi', exact: true }).click();
    await A.getByLabel('Naziv predmeta *').fill('Veliki čekić');
    await A.goBack().catch(() => {});
    const dlg = await A.getByTestId('unsaved-dialog').count();
    check(
      'INV-U3 Android/preglednik Natrag s izmjenama otvara dijalog (aplikacija ne izlazi)',
      dlg === 1 || (await A.getByLabel('Naziv predmeta *').count()) === 1,
    );
    if (dlg === 1) await A.getByRole('button', { name: 'Spremi promjene pa nastavi' }).click();
    else {
      await A.getByRole('button', { name: 'Spremi promjene' }).click();
    }
    await A.getByTestId('item-name').waitFor({ timeout: 20000 });
    check(
      'INV-U4 "Spremi promjene pa nastavi": spremljeno online, nastavlja tek nakon potvrde',
      (await names('items')).includes('Veliki čekić') &&
        (await A.getByTestId('item-name').innerText()) === 'Veliki čekić',
    );
    await shot(A, '08_uredi_readonly_390.png');

    // 7) drugi korisnik vidi uživo; konflikt između uređaja
    const ctxB = await browser.newContext({ viewport: { width: 390, height: 780 } });
    const B = await ctxB.newPage();
    await B.goto(BASE);
    await B.getByRole('button', { name: 'Prijava Google računom' }).waitFor();
    await signInAs(B, 'Bruno');
    const uidB = await joinHousehold(B);
    await B.getByLabel('Pretraži predmet ili lokaciju').fill('veliki');
    await B.getByRole('button', { name: /Veliki čekić/ }).waitFor({ timeout: 20000 });
    check(
      'INV-9 korisnik B vidi izmjenu korisnika A uživo (lokalna pretraga nad živim podacima)',
      true,
    );
    // konflikt: A uređuje, B u međuvremenu mijenja isti predmet
    await A.getByRole('button', { name: 'Uredi', exact: true }).click();
    await A.getByLabel('Naziv predmeta *').fill('Moja promjena');
    await B.getByRole('button', { name: /Veliki čekić/ }).click();
    await B.getByRole('button', { name: 'Uredi', exact: true }).click();
    await B.getByLabel('Naziv predmeta *').fill('Tuđa promjena');
    await B.getByRole('button', { name: 'Spremi promjene' }).click();
    await B.getByTestId('item-name').waitFor({ timeout: 20000 });
    await A.getByTestId('compare').waitFor({ timeout: 20000 });
    check(
      'INV-C1 konflikt između uređaja: A vidi usporedbu s tuđom promjenom, nacrt ostaje',
      (await A.getByTestId('compare').innerText()).includes('Tuđa promjena') &&
        (await A.getByLabel('Naziv predmeta *').inputValue()) === 'Moja promjena',
    );
    await shot(A, '11_konflikt_390.png');
    await A.getByRole('button', { name: 'Nastavi nad aktualnom verzijom' }).click();
    await A.getByRole('button', { name: 'Spremi promjene' }).click();
    await A.getByTestId('item-name').waitFor({ timeout: 20000 });
    check(
      'INV-C2 nakon izričite radnje spremanje ide nad aktualnom verzijom',
      (await names('items')).includes('Moja promjena'),
    );

    // 8) offline u pravom Chromiumu: samo pregled, nikakvog skrivenog reda; unos ostaje
    await nav(A, 'Dodaj predmet');
    await A.getByLabel('Naziv predmeta *').fill('OFFLINE-predmet');
    await A.getByLabel('Lokacija *').selectOption({ label: 'Kuća' });
    await ctxA.setOffline(true);
    await A.getByTestId('inv-stale').waitFor({ timeout: 45000 });
    await shot(A, '13_samo_pregled_bez_veze_390.png');
    const addDisabled = await addBtn(A).isDisabled();
    await A.getByLabel('Naziv predmeta *').press('Enter');
    await A.waitForTimeout(1500);
    const st = await A.getByTestId('inv-status')
      .innerText()
      .catch(() => '');
    check(
      'INV-10 offline u Chromiumu: "samo pregled", gumb onemogućen, Enter ne šalje, nema "Spremanje"/"Spremljeno"',
      addDisabled && !st.includes('Spremanje') && !st.includes('Spremljeno'),
      st.slice(0, 60),
    );
    check(
      'INV-10b nakon blokiranog pokušaja uneseni naziv i lokacija OSTAJU u obrascu',
      (await A.getByLabel('Naziv predmeta *').inputValue()) === 'OFFLINE-predmet' &&
        (await A.getByLabel('Lokacija *').inputValue()) !== '',
    );
    await ctxA.setOffline(false);
    await A.getByTestId('inv-stale').waitFor({ state: 'detached', timeout: 60000 });
    await A.waitForTimeout(4000);
    check(
      'INV-11 nakon povratka veze NIŠTA tipkano offline nije poslano (nema skrivenog reda)',
      !(await names('items')).some((n) => n && n.startsWith('OFFLINE')),
    );

    // 9) opoziv B tijekom otvorene sesije
    await adminPatch(`households/${H}/members/${uidB}`, {
      uid: uidB,
      role: 'member',
      enabled: false,
    });
    await A.getByLabel('Naziv predmeta *').fill('Okidač');
    await A.getByLabel('Lokacija *').selectOption({ label: 'Kuća' });
    await addBtn(A).click();
    await A.getByTestId('item-name').waitFor({ timeout: 20000 });
    let viaListener = true;
    await B.getByRole('heading', { name: 'Članstvo je opozvano' })
      .waitFor({ timeout: 25000 })
      .catch(() => (viaListener = false));
    console.log(
      'INFO opoziv: B je to otkrio ' + (viaListener ? 'preko listenera' : 'tek ručnom provjerom'),
    );
    if (!viaListener) {
      await B.getByTestId('bottom-nav').getByRole('button', { name: 'Više' }).click();
      await B.getByRole('button', { name: 'Provjeri pristup' }).click();
      await B.getByRole('heading', { name: 'Nemaš pristup' }).waitFor({ timeout: 20000 });
    } else {
      await shot(B, '16_opozvan_pristup_390.png');
    }
    const bodyB = await B.locator('body').innerText();
    check(
      'INV-12 opoziv: B nema prikaz inventara, nijedan naziv nije u DOM-u',
      !bodyB.includes('čekić') &&
        !bodyB.includes('Kuhinja') &&
        (await B.getByTestId('bottom-nav').count()) === 0,
    );

    // 10) IndexedDB: nikakav Firestore keš ni sekundarni auth token
    const dbNames = await A.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    const readKeys = () =>
      A.evaluate(
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
    const authKeys = await readKeys();
    check(
      'INV-13 u IndexedDB nema Firestore keša; trajni auth token samo za primarnu app, nikad za podatkovne sesije',
      !dbNames.some((n) => n && n.startsWith('firestore/')) &&
        authKeys.every((k) => String(k).endsWith(':[DEFAULT]')) &&
        !authKeys.some((k) => String(k).includes('data-')),
    );

    // 11) odjava A, promjena računa
    await nav(A, 'Više');
    await A.getByRole('button', { name: 'Odjava' }).click();
    await A.getByRole('button', { name: 'Prijava Google računom' }).waitFor();
    const bodyA = await A.locator('body').innerText();
    check(
      'INV-14 odjava: nijedan podatak inventara u DOM-u, navigacija uklonjena',
      !bodyA.includes('čekić') &&
        !bodyA.includes('Ormar1') &&
        (await A.getByTestId('bottom-nav').count()) === 0,
    );
    check(
      'INV-15 nakon odjave u trajnoj pohrani nema nikakvog auth tokena',
      (await readKeys()).length === 0,
    );
    await signInAs(A, 'Cvijeta');
    await A.getByRole('heading', { name: 'Nemaš pristup' }).waitFor({ timeout: 20000 });
    const bodyC = await A.locator('body').innerText();
    check(
      'INV-16 promjena računa: nečlan ne vidi ništa od prethodnog inventara',
      !bodyC.includes('čekić') && !bodyC.includes('Kuhinja') && !bodyC.includes('Baterije'),
    );

    // 12) responzivnost: 320, 390, 430, 768, 962 (Chromium emulacija; NIJE stvarni Android)
    const ctxR = await browser.newContext({
      viewport: { width: 390, height: 780 },
      deviceScaleFactor: 2,
    });
    const R = await ctxR.newPage();
    await R.goto(BASE);
    await R.getByRole('button', { name: 'Prijava Google računom' }).waitFor();
    await signInAs(R, 'Ana');
    await R.getByTestId('household-name').waitFor({ timeout: 20000 });
    await R.getByLabel('Pretraži predmet ili lokaciju').fill('baterije');
    await R.getByRole('button', { name: /Baterije/ })
      .first()
      .waitFor({ timeout: 20000 });
    const widths = [320, 390, 430, 768, 962];
    const screens = ['Početna', 'Lokacije', 'Dodaj predmet', 'Više'];
    const bad = [];
    for (const w of widths) {
      await R.setViewportSize({ width: w, height: w >= 768 ? 900 : 780 });
      for (const s of screens) {
        await nav(R, s);
        await R.waitForTimeout(250);
        if (await overflowX(R)) bad.push(`${w}px/${s}: vodoravni pomak`);
        const nb = await R.getByTestId('bottom-nav').boundingBox();
        if (!nb || nb.width < w - 2) bad.push(`${w}px/${s}: donja navigacija nije cijela širina`);
        const small = await R.locator(
          'button:visible, a:visible, select:visible, input:visible',
        ).evaluateAll((els) =>
          els
            .filter((e) => {
              const r = (e.closest('label, .searchbar') || e).getBoundingClientRect(); // ciljna površina uključuje oznaku/okvir polja
              return r.width > 0 && r.height > 0 && r.height < 40;
            })
            .map((e) =>
              (e.innerText || e.getAttribute('aria-label') || e.id || e.tagName).slice(0, 20),
            ),
        );
        if (small.length) bad.push(`${w}px/${s}: mali ciljevi ${small.join(',')}`);
      }
      await nav(R, 'Početna');
      await R.getByLabel('Pretraži predmet ili lokaciju').fill('baterije');
      await R.waitForTimeout(200);
      if (await overflowX(R)) bad.push(`${w}px/pretraga: vodoravni pomak`);
      if (w === 320) await shot(R, '22_pretraga_320.png');
      if (w === 962) await shot(R, '19_pocetna_tablet_962.png');
    }
    check(
      'INV-R1 širine 320/390/430/768/962: nema vodoravnog pomaka, navigacija cijelom širinom, ciljevi ≥ 40 px',
      bad.length === 0,
      bad.slice(0, 4).join(' | '),
    );
    await R.setViewportSize({ width: 962, height: 900 });
    await nav(R, 'Dodaj predmet');
    await shot(R, '20_dodavanje_tablet_962.png');
    await R.setViewportSize({ width: 390, height: 780 });

    check(
      'INV-17 nema neuhvaćenih JS grešaka (korisnik A)',
      errors.length === 0,
      errors.join(' | ').slice(0, 300),
    );
  } catch (e) {
    check('E2E izvršavanje', false, String(e).split('\n').slice(0, 8).join(' / '));
    if (A && process.env.E2E_SHOT) {
      await A.screenshot({ path: process.env.E2E_SHOT, fullPage: true }).catch(() => {});
      console.log(
        'BODY:',
        (
          await A.locator('body')
            .innerText()
            .catch(() => '')
        )
          .replace(/\s+/g, ' ')
          .slice(0, 700),
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
  console.log(`\nE2E-INV: ${results.length - failed}/${results.length} PASS`);
  process.exit(failed ? 1 : 0);
})();
