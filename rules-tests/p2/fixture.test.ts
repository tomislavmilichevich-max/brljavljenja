// Integritet fixturea i zaštita da se demo podaci nikad ne dotaknu produkcije.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixture } from './helpers';

describe('P2_DEMO_HOUSE.json', () => {
  it('označen kao isključivo testni; demo-house; demo projekt', () => {
    expect(fixture.fixtureOnly).toBe(true);
    expect(fixture.householdId).toBe('demo-house');
    expect(fixture.firebaseProjectId).toMatch(/^demo-/);
  });
  it('broj zapisa odgovara specifikaciji (22 lokacije, 29 predmeta, 32 smještaja)', () => {
    expect([fixture.locations.length, fixture.items.length, fixture.placements.length]).toEqual([
      22, 29, 32,
    ]);
  });
  it('referencijalno konzistentan; nema duplikata (itemId, locationId); unique ima najviše 1 aktivan smještaj', () => {
    const locs = new Set(fixture.locations.map((l) => l.id));
    const items = new Map(fixture.items.map((i) => [i.id, i]));
    const seen = new Set<string>();
    const perItem = new Map<string, number>();
    for (const p of fixture.placements) {
      expect(locs.has(p.locationId), p.id).toBe(true);
      expect(items.has(p.itemId), p.id).toBe(true);
      const k = `${p.itemId}|${p.locationId}`;
      expect(seen.has(k), `duplikat ${k}`).toBe(false);
      seen.add(k);
      if (!p.archived) perItem.set(p.itemId, (perItem.get(p.itemId) ?? 0) + 1);
    }
    for (const [id, c] of perItem) if (items.get(id)!.kind === 'unique') expect(c, id).toBe(1);
  });
  it('svi ID-ovi zadovoljavaju format koji traže pravila (mala slova, brojke, crtice; bez "_")', () => {
    const all = [...fixture.locations, ...fixture.items, ...fixture.placements].map((x) => x.id);
    for (const id of all) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe('izolacija od produkcije', () => {
  it('nijedna P2 testna datoteka ne spominje produkcijsko kućanstvo ni projekt', () => {
    for (const f of readdirSync('rules-tests/p2')) {
      if (f === 'fixture.test.ts') continue; // ovaj test sadrži zabranjene nizove kao podatke
      const text = readFileSync(`rules-tests/p2/${f}`, 'utf8');
      expect(text, f).not.toMatch(/kuca1|218be|home-inventory-pwa-/);
    }
  });
  it('okruženje testova uvijek koristi demo- projekt', () => {
    const src = readFileSync('rules-tests/p2/helpers.ts', 'utf8');
    expect(src).toMatch(/prefix = 'demo-/);
  });
});
