import { describe, expect, it } from 'vitest';
import { createInventoryGate, isServerConfirmed, type InventoryState } from './gate';
import type { Item, Location, Placement } from './types';

const loc = (id: string, parentId: string | null, name = id): Location => ({
  id,
  name,
  parentId,
  kind: id === 'root' ? 'house' : 'box',
  version: 1,
  archived: false,
});
const item = (id: string): Item => ({
  id,
  name: id,
  kind: 'type',
  aliases: [],
  category: null,
  note: null,
  version: 1,
  archived: false,
});
const pl = (id: string, itemId: string, locationId: string): Placement => ({
  id,
  itemId,
  locationId,
  version: 1,
  archived: false,
});
const TREE = [loc('root', null), loc('a', 'root'), loc('b', 'a')];

type Gate = ReturnType<typeof createInventoryGate>;
/** Primijeni sva tri snapshota s istom potvrđenošću; vraća ZADNJE stvarno emitirano stanje (null ako nije bilo promjene). */
function feed(
  g: Gate,
  l: Location[],
  i: Item[],
  p: Placement[],
  confirmed = true,
): InventoryState | null {
  let last: InventoryState | null = null;
  for (const s of [
    g.apply('locations', l, confirmed),
    g.apply('items', i, confirmed),
    g.apply('placements', p, confirmed),
  ]) {
    if (s) last = s;
  }
  return last;
}

describe('gate: vrata za server-potvrđeni cjeloviti skup', () => {
  it('dok sve tri kolekcije nisu stigle, stanje je loading i nikad ne otkriva podatke', () => {
    const g = createInventoryGate();
    expect(g.apply('locations', TREE, true)).toEqual({ status: 'loading' });
    expect(g.apply('items', [item('x')], true)).toBeNull(); // i dalje loading (isti potpis)
  });
  it('snapshot iz keša (fromCache/hasPendingWrites) NIKAD ne otvara vrata, ni kad je kompletan', () => {
    const g = createInventoryGate();
    expect(feed(g, TREE, [item('x')], [pl('p', 'x', 'a')], false)).toEqual({ status: 'loading' });
    expect(isServerConfirmed({ fromCache: true, hasPendingWrites: false })).toBe(false);
    expect(isServerConfirmed({ fromCache: false, hasPendingWrites: true })).toBe(false);
    expect(isServerConfirmed({ fromCache: false, hasPendingWrites: false })).toBe(true);
  });
  it('zdrav cjelovit skup => ready s podacima, needsBootstrap=false', () => {
    const g = createInventoryGate();
    const s = feed(g, TREE, [item('x')], [pl('p', 'x', 'a')]);
    expect(s).toMatchObject({ status: 'ready', needsBootstrap: false });
  });
  it('djelomični keš (manjkaju roditelji) prije potvrde => loading, a ne tree-corrupt; nakon potvrde => ready', () => {
    const g = createInventoryGate();
    expect(feed(g, [loc('b', 'a')], [], [], false)).toEqual({ status: 'loading' });
    const s = feed(g, TREE, [], []);
    expect(s?.status).toBe('ready');
  });
  it('cjelovit skup s ciklusom => tree-corrupt BEZ podataka', () => {
    const g = createInventoryGate();
    const s = feed(g, [loc('root', null), loc('a', 'b'), loc('b', 'a')], [item('x')], []);
    expect(s?.status).toBe('tree-corrupt');
    expect(s && 'data' in s).toBe(false);
  });
  it('gubitak potvrde nakon ready => stale sa ZADNJIM POTVRĐENIM podacima (novi podaci iz keša se ne otkrivaju)', () => {
    const g = createInventoryGate();
    feed(g, TREE, [item('x')], []);
    const s = g.apply('items', [item('x'), item('NOVI-IZ-KESA')], false);
    expect(s).toMatchObject({ status: 'stale' });
    expect(JSON.stringify(s)).not.toContain('NOVI-IZ-KESA');
  });
});

describe('P2B-REV-03: prazne lokacije — prazno kućanstvo vs nedosljedni podaci', () => {
  it('SVE tri kolekcije prazne i potvrđene => zaista prazno kućanstvo (needsBootstrap)', () => {
    const g = createInventoryGate();
    expect(feed(g, [], [], [])).toMatchObject({ status: 'ready', needsBootstrap: true });
  });
  it('0 lokacija, ali postoje predmeti => inconsistent (NE needsBootstrap)', () => {
    const g = createInventoryGate();
    const s = feed(g, [], [item('x'), item('y')], []);
    expect(s).toEqual({ status: 'inconsistent', items: 2, placements: 0 });
  });
  it('0 lokacija, ali postoje smještaji => inconsistent', () => {
    const g = createInventoryGate();
    expect(feed(g, [], [], [pl('p', 'x', 'a')])).toEqual({
      status: 'inconsistent',
      items: 0,
      placements: 1,
    });
  });
  it('0 lokacija uz predmete I smještaje => inconsistent s oba broja; stanje ne nosi nikakve podatke', () => {
    const g = createInventoryGate();
    const s = feed(g, [], [item('tajni-predmet')], [pl('p', 'tajni-predmet', 'a')]);
    expect(s).toEqual({ status: 'inconsistent', items: 1, placements: 1 });
    expect(JSON.stringify(s)).not.toContain('tajni-predmet');
  });
  it('NEPOTVRĐENO (keš) prazne lokacije uz predmete NIJE inconsistent ni needsBootstrap: loading', () => {
    const g = createInventoryGate();
    expect(feed(g, [], [item('x')], [], false)).toEqual({ status: 'loading' }); // ostaje loading, ne inconsistent/needsBootstrap
  });
  it('djelomično potvrđeno: lokacije prazne, ali items još iz keša => i dalje loading', () => {
    const g = createInventoryGate();
    g.apply('locations', [], true);
    g.apply('items', [item('x')], false);
    expect(g.apply('placements', [], true)).toBeNull();
  });
  it('inconsistent se razrješava čim stignu lokacije (ready) i ne ostavlja lastGood iz nedosljednog stanja', () => {
    const g = createInventoryGate();
    expect(feed(g, [], [item('x')], [])?.status).toBe('inconsistent');
    expect(feed(g, TREE, [item('x')], [])?.status).toBe('ready');
  });
  it('nakon inconsistent gubitak potvrde NE vraća u stale s podacima (lastGood je obrisan)', () => {
    const g = createInventoryGate();
    feed(g, [], [item('x')], []);
    expect(g.apply('items', [item('x')], false)).toEqual({ status: 'loading' });
  });
});
