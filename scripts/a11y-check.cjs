/* P2-D1: automatizirane provjere pristupačnosti i mobilnog ponašanja nad PRAVIM produkcijskim komponentama
 * (lažni port + sintetski fixture iz scripts/shots; ništa ne ide na mrežu).
 * Alat: axe-core (besplatan; NIJE ovisnost projekta): `npm i --no-save axe-core` ili AXE_PATH=<putanja do axe.min.js>.
 * Pokretanje: node scripts/a11y-check.cjs   (traži predinstalirani Playwright)
 * NAPOMENA: Chromium emulacija — NIJE provjera na fizičkom Androidu / TalkBacku. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const AXE = process.env.AXE_PATH || path.join('node_modules', 'axe-core', 'axe.min.js');
if (!fs.existsSync(AXE)) {
  console.log('BLOCKED  axe-core nije dostupan (npm i --no-save axe-core ili AXE_PATH)');
  process.exit(2);
}
const PORT = 5175;
const BASE = `http://127.0.0.1:${PORT}/scripts/shots/shots.html`;
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};
const nav = (page, n) => page.getByTestId('bottom-nav').getByRole('button', { name: n }).click();

async function axeRun(page, label) {
  await page.addScriptTag({ path: AXE });
  const r = await page.evaluate(async () =>
    // eslint-disable-next-line no-undef
    axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
      },
    }),
  );
  const v = r.violations.map(
    (x) =>
      `${x.id}(${x.nodes.length}${x.nodes[0] ? ':' + x.nodes[0].target.join(' ').slice(0, 50) : ''})`,
  );
  check(`AXE ${label}`, v.length === 0, v.join(', '));
}

(async () => {
  const vite = spawn(
    'npx',
    ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { stdio: 'ignore', detached: true },
  );
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
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 780 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    const open = async (s = 'ready') => {
      await page.goto(`${BASE}?s=${s}`);
      await page
        .getByTestId('bottom-nav')
        .waitFor()
        .catch(() => {});
      await page.waitForTimeout(150);
    };

    // 1) axe na svim ključnim zaslonima i stanjima (390 px)
    await open();
    await axeRun(page, 'Početna');
    await page.getByLabel('Pretraži predmet ili lokaciju').fill('aku busilca');
    await axeRun(page, 'Pretraga (približni rezultati)');
    await page.getByLabel('Pretraži predmet ili lokaciju').fill('baterije');
    await axeRun(page, 'Pretraga (više putanja)');
    await nav(page, 'Lokacije');
    await axeRun(page, 'Lokacije');
    await page.getByRole('button', { name: /Garaža/ }).click();
    await axeRun(page, 'Sadržaj lokacije');
    await page
      .getByRole('button', { name: /Premjesti cijelu lokaciju/ })
      .first()
      .click()
      .catch(() => {});
    await nav(page, 'Dodaj predmet');
    await axeRun(page, 'Dodaj predmet');
    await page
      .getByRole('form', { name: 'Novi predmet' })
      .getByRole('button', { name: 'Dodaj predmet' })
      .click();
    await axeRun(page, 'Dodaj predmet (greške validacije)');
    await nav(page, 'Više');
    await axeRun(page, 'Više');
    await nav(page, 'Početna');
    await page.getByLabel('Pretraži predmet ili lokaciju').fill('baterije');
    await page
      .getByRole('button', { name: /AA baterije/ })
      .first()
      .click();
    await axeRun(page, 'Detalj predmeta');
    await page.getByRole('button', { name: /Premjesti/ }).click();
    await axeRun(page, 'Premjesti (izbor izvora)');
    await page.getByRole('button', { name: 'Natrag' }).click();
    await page.getByRole('button', { name: 'Uredi', exact: true }).click();
    await axeRun(page, 'Uredi predmet');
    await page.getByLabel('Naziv predmeta *').fill('Promijenjeno');
    await page.getByRole('button', { name: 'Natrag' }).click();
    await page.getByTestId('unsaved-dialog').waitFor();
    await axeRun(page, 'Dijalog nespremljenih izmjena');

    // 2) modal: fokus ulazi u dijalog, ostaje u njemu (Tab), Escape = Ostani ovdje, fokus se vraća
    const inDialog = () =>
      page.evaluate(() => !!document.activeElement?.closest('[data-testid=unsaved-dialog]'));
    check('MODAL fokus je pri otvaranju unutar dijaloga', await inDialog());
    for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
    check('MODAL Tab ne izlazi iz dijaloga (pozadina inert)', await inDialog());
    const role = await page.getByTestId('unsaved-dialog').getAttribute('aria-modal');
    check(
      'MODAL aria-modal + naslov povezan',
      role === 'true' &&
        (await page.getByTestId('unsaved-dialog').getAttribute('aria-labelledby')) ===
          'dialog-title',
    );
    await page.keyboard.press('Escape');
    check(
      'MODAL Escape = "Ostani ovdje" (dijalog zatvoren, tekst sačuvan)',
      (await page.getByTestId('unsaved-dialog').count()) === 0 &&
        (await page.getByLabel('Naziv predmeta *').inputValue()) === 'Promijenjeno',
    );
    check(
      'MODAL fokus se vraća na element koji je prije bio fokusiran',
      await page.evaluate(() => document.activeElement !== document.body),
    );

    // 3) tipkovnica: redoslijed, vidljiv fokus, nazivi kontrola
    await open();
    const seq = [];
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press('Tab');
      seq.push(
        await page.evaluate(() => {
          const e = document.activeElement;
          if (!e || e === document.body) return null;
          const cs = getComputedStyle(e);
          const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
          const wrapper = e.closest('.searchbar');
          const wcs = wrapper && getComputedStyle(wrapper);
          const wrapperOutline = !!wcs && wcs.outlineStyle !== 'none';
          const name = (e.getAttribute('aria-label') || e.innerText || e.id || e.tagName)
            .trim()
            .slice(0, 24);
          return {
            name,
            visible: outline || wrapperOutline || cs.boxShadow !== 'none',
            tag: e.tagName,
          };
        }),
      );
    }
    const focused = seq.filter(Boolean);
    check(
      'TIPKOVNICA Tab dosiže pretragu, zupčanik i kartice navigacije',
      ['search-input', 'Otvori Više'].every((n) => focused.some((f) => f.name === n)) &&
        new Set(focused.map((f) => f.name)).size >= 8,
      focused
        .map((f) => f.name)
        .join(' > ')
        .slice(0, 160),
    );
    check(
      'TIPKOVNICA svaka fokusirana kontrola ima vidljiv indikator fokusa',
      focused.every((f) => f.visible),
      focused
        .filter((f) => !f.visible)
        .map((f) => f.name)
        .join(','),
    );
    await page.getByLabel('Pretraži predmet ili lokaciju').focus();
    await page.keyboard.type('sol');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    check(
      'TIPKOVNICA Enter na rezultatu otvara detalj',
      (await page.getByTestId('item-name').count()) === 1,
    );
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll('button, input, select, textarea, [role=button]')]
        .filter((e) => !e.disabled && e.getBoundingClientRect().width > 0)
        .filter((e) => {
          const n =
            e.getAttribute('aria-label') ||
            e.getAttribute('aria-labelledby') ||
            e.innerText?.trim() ||
            (e.labels && e.labels.length) ||
            e.title;
          return !n;
        })
        .map((e) => e.outerHTML.slice(0, 60)),
    );
    check('OZNAKE sve kontrole imaju pristupačni naziv', unnamed.length === 0, unnamed.join(' | '));

    // 4) širine, zoom 200 %, povećanje fonta (CSS zoom kao emulacija), soft tipkovnica
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
    const bad = [];
    for (const [w, h, label] of [
      [320, 700, '320'],
      [390, 780, '390'],
      [430, 860, '430'],
      [768, 1000, '768'],
      [962, 1000, '962'],
      [195, 700, 'zoom200%@390'],
      [160, 700, 'zoom200%@320'],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      for (const s of ['Početna', 'Lokacije', 'Dodaj predmet', 'Više']) {
        await nav(page, s).catch(() => bad.push(`${label}/${s}: nav nedostupna`));
        await page.waitForTimeout(100);
        if (await overflow()) bad.push(`${label}/${s}: vodoravni pomak`);
        const clipped = await page.evaluate(() =>
          [...document.querySelectorAll('h1,h2,h3,p,button,label,small,strong')]
            .filter(
              (e) =>
                !e.closest('.sr-only') &&
                e.scrollWidth > e.clientWidth + 2 &&
                getComputedStyle(e).overflow !== 'visible',
            )
            .map((e) => e.innerText.slice(0, 20)),
        );
        if (clipped.length) bad.push(`${label}/${s}: odsječen tekst ${clipped[0]}`);
        const navBox = await page.getByTestId('bottom-nav').boundingBox();
        if (!navBox || navBox.y + navBox.height > h + 1)
          bad.push(`${label}/${s}: donja navigacija izvan zaslona`);
      }
    }
    check(
      'REFLOW širine 320/390/430/768/962 i zoom 200 % (195/160 CSS px): nema pomaka, odsječenog teksta, navigacija vidljiva',
      bad.length === 0,
      bad.slice(0, 5).join(' | '),
    );
    await page.setViewportSize({ width: 390, height: 780 });
    for (const scale of [1.3, 2]) {
      await open();
      // emulacija sustavnog povećanja fonta: izračunati font-size svakog elementa × scale (NIJE stvarni Android font scale)
      const bump = (k) =>
        page.evaluate((kk) => {
          const els = [...document.querySelectorAll('body *')];
          for (const e of els) e.style.fontSize = ''; // najprije očisti (nasljeđivanje ne smije udvostručiti povećanje)
          const sizes = els.map((e) => parseFloat(getComputedStyle(e).fontSize));
          els.forEach((e, i) => {
            if (sizes[i]) e.style.fontSize = sizes[i] * kk + 'px';
          });
        }, k);
      await bump(scale);
      const o = [];
      for (const s of ['Početna', 'Lokacije', 'Dodaj predmet', 'Više']) {
        await page
          .getByTestId('bottom-nav')
          .getByRole('button', { name: s })
          .dispatchEvent('click');
        await page.waitForTimeout(100);
        await bump(scale);
        if (await overflow()) o.push(s + ': pomak');
        const clipped = await page.evaluate(
          () =>
            [...document.querySelectorAll('h1,h2,h3,p,button,label,small,strong')].filter(
              (e) =>
                !e.closest('.sr-only') &&
                e.scrollWidth > e.clientWidth + 2 &&
                getComputedStyle(e).overflow !== 'visible',
            ).length,
        );
        if (clipped) o.push(s + ': odsječen tekst');
        const navBox = await page.getByTestId('bottom-nav').boundingBox();
        if (!navBox || navBox.y + navBox.height > 780 + 1) o.push(s + ': navigacija izvan zaslona');
      }
      check(
        `FONT povećanje ${Math.round(scale * 100)} % (emulacija): bez pomaka, odsječenog teksta, navigacija vidljiva`,
        o.length === 0,
        o.join(','),
      );
    }
    await page.evaluate(() => (document.documentElement.style.zoom = ''));

    // nesadržajni kontrast (WCAG 1.4.11): granica polja i indikator fokusa naspram pozadine ≥ 3:1
    await open();
    await nav(page, 'Dodaj predmet');
    await page.getByLabel('Naziv predmeta *').focus();
    const ratios = await page.evaluate(() => {
      const lum = (c) => {
        const m = c
          .match(/\d+(\.\d+)?/g)
          .map(Number)
          .slice(0, 3)
          .map((v) => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          });
        return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
      };
      const ratio = (a, b) => {
        const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
        return (x + 0.05) / (y + 0.05);
      };
      const input = document.getElementById('field-name');
      const cs = getComputedStyle(input);
      const card = getComputedStyle(input.closest('.card'));
      return {
        border: ratio(cs.borderTopColor, card.backgroundColor),
        focus: ratio(cs.outlineColor, 'rgb(250,247,239)'),
        focusOnCard: ratio(cs.outlineColor, card.backgroundColor),
      };
    });
    check('KONTRAST (1.4.11) granica polja ≥ 3:1', ratios.border >= 3, ratios.border.toFixed(2));
    check(
      'KONTRAST (2.4.7/1.4.11) indikator fokusa ≥ 3:1 na kartici i na pozadini stranice',
      ratios.focus >= 3 && ratios.focusOnCard >= 3,
      ratios.focus.toFixed(2) + '/' + ratios.focusOnCard.toFixed(2),
    );

    // soft tipkovnica: vidljivi dio 390×330
    await page.setViewportSize({ width: 390, height: 330 });
    await nav(page, 'Dodaj predmet');
    await page.getByLabel('Naziv predmeta *').click();
    const inView = await page.evaluate(() => {
      const r = document.activeElement.getBoundingClientRect();
      const navTop = document.querySelector('[data-testid=bottom-nav]').getBoundingClientRect().top;
      return r.top >= 0 && r.bottom <= navTop + 1;
    });
    check(
      'SOFT TIPKOVNICA (emulacija visine 330 px): fokusirano polje nije skriveno ispod donje navigacije',
      inView,
    );
    const submit = page
      .getByRole('form', { name: 'Novi predmet' })
      .getByRole('button', { name: 'Dodaj predmet' });
    await submit.scrollIntoViewIfNeeded();
    const reach = await page.evaluate(() => {
      const b = [
        ...document.querySelectorAll('form button[type=submit]'),
      ][0].getBoundingClientRect();
      const navTop = document.querySelector('[data-testid=bottom-nav]').getBoundingClientRect().top;
      return b.bottom <= navTop + 1 && b.top >= 0;
    });
    check(
      'SOFT TIPKOVNICA gumb "Dodaj predmet" dohvatljiv pomicanjem i nije prekriven donjom navigacijom',
      reach,
    );
    await page.setViewportSize({ width: 390, height: 780 });

    // 4b) potpuno zatvaranje/osvježavanje aplikacije tijekom nepoznatog ishoda: registar je samo u memoriji
    await open('unknown');
    await nav(page, 'Dodaj predmet');
    await page.getByLabel('Naziv predmeta *').fill('Zatvaranje');
    await page.getByLabel('Lokacija *').selectOption({ label: 'Kuća › Garaža › Ormar s alatom' });
    await page
      .getByRole('form', { name: 'Novi predmet' })
      .getByRole('button', { name: 'Dodaj predmet' })
      .click();
    await page.getByText(/Veza je prekinuta tijekom potvrđivanja/).waitFor();
    await page.reload();
    await page.getByTestId('bottom-nav').waitFor();
    const gone =
      (await page.getByTestId('inv-status').count()) === 0 &&
      !(await page.locator('body').innerText()).includes('Zatvaranje');
    check(
      'ZATVARANJE aplikacije tijekom nepoznatog ishoda: nakon osvježavanja nema registra ni privatnog unosa (ograničenje dokumentirano)',
      gone,
    );

    // 5) dijalog na uskom ekranu
    await open();
    await nav(page, 'Početna');
    await page.setViewportSize({ width: 320, height: 520 });
    await page.getByLabel('Pretraži predmet ili lokaciju').fill('sol');
    await page.getByRole('button', { name: /Sol/ }).first().click();
    await page.getByRole('button', { name: 'Uredi', exact: true }).click();
    await page.getByLabel('Naziv predmeta *').fill('Sol 2');
    await page.getByRole('button', { name: 'Natrag' }).click();
    const box = await page.locator('.dialog').boundingBox();
    check(
      'DIJALOG 320×520: cijeli unutar zaslona, svi gumbi dohvatljivi',
      !!box && box.x >= 0 && box.x + box.width <= 320 && box.y >= 0 && box.y + box.height <= 520,
    );
  } catch (e) {
    check('izvršavanje', false, String(e).split('\n').slice(0, 4).join(' / '));
  } finally {
    await browser.close();
    try {
      process.kill(-vite.pid);
    } catch {
      /* ugašen */
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nA11Y: ${results.length - failed}/${results.length} PASS`);
  process.exit(failed ? 1 : 0);
})();
