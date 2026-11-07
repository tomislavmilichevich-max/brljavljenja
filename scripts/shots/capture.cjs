/* Screenshotovi stanja PRODUKCIJSKOG React sučelja (lažni port + sintetski fixture; ništa ne ide na mrežu).
 * Pokretanje: E2E_SHOTS=<direktorij> node scripts/shots/capture.cjs */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const OUT = process.env.E2E_SHOTS || 'shots-out';
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5174;
const BASE = `http://127.0.0.1:${PORT}/scripts/shots/shots.html`;

(async () => {
  const vite = spawn(
    'npx',
    ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    {
      stdio: 'ignore',
      detached: true,
    },
  );
  const browser = await chromium.launch();
  const log = [];
  const snap = async (page, name) => {
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, name) });
    log.push(name);
  };
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(BASE)).ok) break;
      } catch {
        /* čekaj */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 780 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    const open = async (s) => {
      await page.goto(`${BASE}?s=${s}`);
    };
    const fillAdd = async () => {
      await page.getByTestId('bottom-nav').getByRole('button', { name: 'Dodaj predmet' }).click();
      await page.getByLabel('Naziv predmeta *').fill('Aku svrdla');
      await page.getByLabel('Lokacija *').selectOption({ label: 'Kuća › Garaža › Ormar s alatom' });
      await page
        .getByRole('form', { name: 'Novi predmet' })
        .getByRole('button', { name: 'Dodaj predmet' })
        .click();
    };
    await open('loading');
    await page.getByTestId('inv-loading').waitFor();
    await snap(page, '14_ucitavanje_390.png');
    await open('corrupt');
    await page.getByTestId('inv-corrupt').waitFor();
    await snap(page, '15_osteceno_stablo_390.png');
    await open('inconsistent');
    await page.getByTestId('inv-inconsistent').waitFor();
    await snap(page, '23_nedosljedno_kucanstvo_390.png');
    await open('saving');
    await page.getByTestId('bottom-nav').waitFor();
    await fillAdd();
    await page.getByTestId('inv-status').waitFor();
    await snap(page, '12_atomsko_dodavanje_spremanje_390.png');
    await open('unknown');
    await page.getByTestId('bottom-nav').waitFor();
    await fillAdd();
    await page.getByText(/Veza je prekinuta tijekom potvrđivanja/).waitFor();
    await snap(page, '11_nepoznat_ishod_390.png');
    await page.getByRole('button', { name: 'Provjeri stanje' }).click();
    await page.getByTestId('verify-result').waitFor();
    await snap(page, '11b_nepoznat_ishod_provjera_bez_veze_390.png');
    await open('notapplied');
    await page.getByTestId('bottom-nav').waitFor();
    await fillAdd();
    await page.getByText(/Veza je prekinuta tijekom potvrđivanja/).waitFor();
    await page.getByRole('button', { name: 'Provjeri stanje' }).click();
    await page.getByTestId('verify-result').waitFor();
    await snap(page, '11d_nije_pronadeno_ponovi_ili_odustani_390.png');
    await page.getByRole('button', { name: 'Odustani od pokušaja' }).click();
    await page.getByTestId('abandon-confirm').waitFor();
    await snap(page, '11e_odustani_upozorenje_390.png');
    await open('conflict');
    await page.getByTestId('bottom-nav').waitFor();
    await page.getByLabel('Pretraži predmet ili lokaciju').fill('aku busilca');
    await snap(page, '22b_pretraga_priblizno_390.png');
    await page
      .getByRole('button', { name: /Aku bušilica/ })
      .first()
      .click();
    await page.getByRole('button', { name: 'Uredi', exact: true }).click();
    await page.getByLabel('Naziv predmeta *').fill('Aku bušilica 18 V');
    await page.getByRole('button', { name: 'Spremi promjene' }).click();
    await page.getByText(/Netko je promijenio zapis/).waitFor();
    await snap(page, '11c_konflikt_greska_390.png');
    await open('stale');
    await page.getByTestId('inv-stale').waitFor();
    await snap(page, '13b_stale_samo_pregled_390.png');
    await open('ready');
    await page.getByTestId('bottom-nav').getByRole('button', { name: 'Lokacije' }).click();
    await page.getByRole('button', { name: /Garaža/ }).click();
    await page.getByRole('button', { name: /Dodaj podlokaciju/ }).click();
    await page.getByLabel('Vrsta lokacije *').selectOption('shelf');
    await snap(page, '05_nova_lokacija_odabir_vrste_390.png');
    console.log('Snimljeno:', log.join(', '));
  } catch (e) {
    console.log('FAIL', String(e).split('\n').slice(0, 6).join(' / '));
    process.exitCode = 1;
  } finally {
    await browser.close();
    try {
      process.kill(-vite.pid);
    } catch {
      /* već ugašen */
    }
  }
})();
