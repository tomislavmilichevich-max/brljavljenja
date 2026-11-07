import { describe, expect, it } from 'vitest';
import fixture from '../../docs/fixtures/P2_DEMO_HOUSE.json';
import type { InventoryData, Item, Location, Placement } from '../inventory/types';
import { editDistance, normalize } from './normalize';
import { buildSearchIndex, search, type SearchResult } from './search';

// Isključivo sintetski demo podaci iz docs/fixtures (nikad u produkcijskom bundleu: samo testovi uvoze).
const audit = { version: 1, archived: false };
const data = (): InventoryData => ({
  locations: fixture.locations.map((l) => ({ ...l, ...audit, kind: l.kind })) as Location[],
  items: fixture.items.map((i) => ({
    id: i.id,
    name: i.name,
    kind: i.kind,
    aliases: i.aliases ?? [],
    category: i.category ?? null,
    note: i.note ?? null,
    ...audit,
  })) as Item[],
  placements: fixture.placements.map((p) => ({
    id: p.id,
    itemId: p.itemId,
    locationId: p.locationId,
    ...audit,
  })) as Placement[],
});

const names = (d: InventoryData, hits: { itemId: string }[]) =>
  hits.map((h) => d.items.find((i) => i.id === h.itemId)!.name);
const all = (r: SearchResult) => [...r.exact, ...r.approx];

describe('normalizacija', () => {
  it('hrvatski znakovi i đ/dj', () => {
    expect(normalize('Špajza')).toBe('spajza');
    expect(normalize('ČĆŽŠ čćžš')).toBe('cczs ccz' + 's');
    expect(normalize('Đurđevak')).toBe('durdevak');
    expect(normalize('durdjevak')).toBe('durdevak');
    expect(normalize('  AA   baterije! ')).toBe('aa baterije');
    expect(normalize(null)).toBe('');
  });
  it('Damerau–Levenshtein: zamjena susjednih slova je 1; rani prekid', () => {
    expect(editDistance('busilca', 'busilica', 2)).toBe(1);
    expect(editDistance('baterjie', 'baterije', 2)).toBe(1);
    expect(editDistance('abc', 'xyzxyz', 1)).toBe(2);
  });
});

describe('pretraga nad demo kućom', () => {
  const d = data();
  const idx = buildSearchIndex(d);

  it('"aku busilca" (tipfeler) pronalazi Aku bušilicu kao PRIBLIŽNI rezultat', () => {
    const r = search(idx, 'aku busilca');
    expect(names(d, r.approx)).toContain('Aku bušilica');
    expect(names(d, r.exact)).not.toContain('Aku bušilica');
  });
  it('"aku busilica" (bez tipfelera) je glavni rezultat, prvi', () => {
    const r = search(idx, 'aku busilica');
    expect(names(d, r.exact)[0]).toBe('Aku bušilica');
    expect(r.approx).toHaveLength(0);
  });
  it('NEGATIVNO: "aku busilca random" ne daje nijedan predmet (nema lažnih pogodaka)', () => {
    const r = search(idx, 'aku busilca random');
    expect(all(r)).toHaveLength(0);
  });
  it('"durdjevak" i "đurđevak" i "DURDEVAK" pronalaze isti predmet preko normalizacije/sinonima', () => {
    for (const q of ['durdjevak', 'đurđevak', 'DURDEVAK']) {
      expect(names(d, search(idx, q).exact)[0]).toBe('Đurđevak ukras');
    }
  });
  it('"spajza": lokacija Špajza je prva među mjestima, a predmeti u njoj pronalaze se po izvedenoj putanji', () => {
    const r = search(idx, 'spajza');
    expect(d.locations.find((l) => l.id === r.places[0]!.locationId)!.name).toBe('Špajza');
    expect(names(d, r.exact)).toEqual(expect.arrayContaining(['Mljevena paprika', 'Sol', 'Riža']));
  });
  it('"AA baterije": točan naziv prvi; sve lokacije jednog predmeta su dostupne iz podataka', () => {
    const r = search(idx, 'AA baterije');
    expect(names(d, r.exact)[0]).toBe('AA baterije');
    expect(r.exact[0]!.type).toBe('name');
    const id = r.exact[0]!.itemId;
    expect(d.placements.filter((p) => p.itemId === id).length).toBeGreaterThan(1);
  });
  it('sinonim iz podataka (alias) i ugrađeni sinonim: "busilica", "odvijac" -> Križni odvijač', () => {
    expect(names(d, search(idx, 'busilica').exact)).toContain('Aku bušilica');
    expect(names(d, search(idx, 'odvijac').exact)).toContain('Križni odvijač');
    expect(names(d, search(idx, 'sarafciger').exact)).toContain('Križni odvijač');
  });
  it('prefiksi i djelomične riječi: "aku bus", "baterij", "kriz"', () => {
    expect(names(d, search(idx, 'aku bus').exact)[0]).toBe('Aku bušilica');
    expect(names(d, search(idx, 'baterij').exact)).toContain('AA baterije');
    expect(names(d, search(idx, 'kriz').exact)).toContain('Križni odvijač');
  });
  it('rangiranje: točan naziv < alias < prefiks < djelomično < metapodaci', () => {
    const items: Item[] = [
      { id: 'a', name: 'Sol', kind: 'type', aliases: [], category: null, note: null, ...audit },
      {
        id: 'b',
        name: 'Sol za perilicu',
        kind: 'type',
        aliases: [],
        category: null,
        note: null,
        ...audit,
      },
      {
        id: 'c',
        name: 'Morska sol',
        kind: 'type',
        aliases: [],
        category: null,
        note: null,
        ...audit,
      },
      {
        id: 'd',
        name: 'Začin',
        kind: 'type',
        aliases: ['sol'],
        category: null,
        note: null,
        ...audit,
      },
      { id: 'e', name: 'Papar', kind: 'type', aliases: [], category: 'sol', note: null, ...audit },
    ];
    const loc: Location[] = [{ id: 'root', name: 'Kuća', parentId: null, kind: 'house', ...audit }];
    const r = search(buildSearchIndex({ locations: loc, items, placements: [] }), 'sol');
    expect(r.exact.map((h) => h.itemId + ':' + h.type)).toEqual([
      'a:name',
      'd:alias',
      'b:prefix',
      'c:partial',
      'e:metadata',
    ]);
  });
  it('višerječni upit: sve riječi moraju pripadati predmetu, redoslijed nije bitan', () => {
    expect(names(d, search(idx, 'busilica aku').exact)).toContain('Aku bušilica');
    expect(all(search(idx, 'aku baterije'))).toHaveLength(0);
    expect(all(search(idx, 'sol sol sol'))).toHaveLength(0);
  });
  it('predmet izvan izvedene putanje arhiviranog smještaja i arhivirani predmeti se ne pronalaze', () => {
    const dd = data();
    dd.items.find((i) => i.name === 'Čekić')!.archived = true;
    expect(all(search(buildSearchIndex(dd), 'cekic'))).toHaveLength(0);
    const e = data();
    for (const p of e.placements.filter((p) => p.itemId === 'hammer')) p.archived = true;
    const r = search(buildSearchIndex(e), 'garaza');
    expect(names(e, r.exact)).not.toContain('Čekić');
  });
  it('prazan i prazninski upit => nema rezultata', () => {
    expect(all(search(idx, ''))).toHaveLength(0);
    expect(all(search(idx, '   '))).toHaveLength(0);
    expect(search(idx, '!!!').places).toHaveLength(0);
  });
  it('root "Kuća" nije odredište pretrage', () => {
    expect(search(idx, 'kuca').places).toHaveLength(0);
  });
  it('dvije različite "Ladica 1" na različitim mjestima obje su rezultat', () => {
    const r = search(idx, 'ladica 1');
    expect(r.places.map((p) => p.locationId).sort()).toEqual(
      expect.arrayContaining(['kitchen-drawer', 'living-drawer']),
    );
  });
  it('performanse: 5000 predmeta, pretraga u razumnom vremenu (lokalno, bez mreže)', () => {
    const big = data();
    for (let i = 0; i < 5000; i++)
      big.items.push({
        id: `x${i}`,
        name: `Predmet ${i} vijak`,
        kind: 'type',
        aliases: [],
        category: null,
        note: null,
        ...audit,
      });
    const bigIdx = buildSearchIndex(big);
    const t0 = performance.now();
    search(bigIdx, 'vijek 4');
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
