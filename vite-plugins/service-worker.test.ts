import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeBuildId, listPrecacheUrls, renderServiceWorker } from './service-worker';

describe('renderServiceWorker', () => {
  const tpl = 'const U = __PRECACHE_URLS__; const B = __BUILD_ID__;';
  it('umeće popis URL-ova i ID builda kao JSON literale', () => {
    expect(renderServiceWorker(tpl, ['/a', '/b'], 'abc')).toBe(
      'const U = ["/a","/b"]; const B = "abc";',
    );
  });
  it('baca grešku ako predložak nema oznake', () => {
    expect(() => renderServiceWorker('nema', [], 'x')).toThrow();
  });
  it('baca grešku ako se oznaka pojavljuje više puta (npr. i u komentaru)', () => {
    expect(() =>
      renderServiceWorker(
        '// __PRECACHE_URLS__\nconst U = __PRECACHE_URLS__; const B = __BUILD_ID__;',
        [],
        'x',
      ),
    ).toThrow(/točno jednom/);
  });
  it('stvarni predložak iz repozitorija daje sintaksno valjan JS bez preostalih oznaka', async () => {
    const { readFileSync } = await import('node:fs');
    const out = renderServiceWorker(
      readFileSync('src/pwa/sw.template.js', 'utf8'),
      ['/index.html'],
      'id1',
    );
    expect(out).not.toMatch(/__PRECACHE_URLS__|__BUILD_ID__/);
    expect(() => new Function(out)).not.toThrow();
  });
});

describe('listPrecacheUrls / computeBuildId', () => {
  it('popisuje datoteke rekurzivno, izostavlja sw.js, ID ovisi o sadržaju', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dist-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<html>');
    writeFileSync(join(dir, 'sw.js'), 'stari');
    writeFileSync(join(dir, 'assets', 'app.js'), 'x');
    const urls = listPrecacheUrls(dir);
    expect(urls).toEqual(['/assets/app.js', '/index.html']);
    const id1 = computeBuildId(dir, urls);
    writeFileSync(join(dir, 'assets', 'app.js'), 'y');
    expect(computeBuildId(dir, urls)).not.toBe(id1);
  });
});
