// Stvarno ponašanje Firestore SDK-a: metadata signali (fromCache / hasPendingWrites), "vrata" za otkrivanje podataka
// i provjera integriteta stabla SAMO nad cjelovitim, server-potvrđenim skupom lokacija.
import { collection, doc, getDocFromServer, onSnapshot, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDataSession } from '../src/firebase/dataSession';
import type { InventoryState } from '../src/inventory/gate';
import { findTreeProblems } from '../src/inventory/tree';
import { watchInventory } from '../src/inventory/watch';
import {
  CONFIG,
  EMU,
  H,
  adminWrite,
  closeAdmin,
  openLive,
  seedEmptyHousehold,
  seedFor,
  signInPrimary,
  sleep,
  waitFor,
  type Primary,
} from './helpers';

let pa: Primary;
beforeAll(async () => {
  pa = await signInPrimary('watchA');
});
beforeEach(async () => seedFor([[pa.uid, true]]));
afterAll(closeAdmin);

interface Raw {
  fromCache: boolean;
  hasPendingWrites: boolean;
  size: number;
}
const rawLog = (db: Parameters<typeof collection>[0], name = 'locations') => {
  const log: Raw[] = [];
  const un = onSnapshot(
    collection(db, `households/${H}/${name}`),
    { includeMetadataChanges: true },
    (s) =>
      log.push({
        fromCache: s.metadata.fromCache,
        hasPendingWrites: s.metadata.hasPendingWrites,
        size: s.size,
      }),
  );
  return { log, un };
};
const collect = (db: Parameters<typeof watchInventory>[0]) => {
  const states: InventoryState[] = [];
  const un = watchInventory(db, H, (s) => states.push(s));
  return { states, un };
};

describe('metadata signali pravog SDK-a i vrata', () => {
  it('svježa sesija: nijedno stanje "ready" nije otkriveno prije server-potvrđenog cjelovitog skupa; svi ready imaju svih 22 lokacije', async () => {
    const L = await openLive(pa);
    const raw = rawLog(L.session.db);
    const { states, un } = collect(L.session.db);
    await waitFor(() => states.find((s) => s.status === 'ready'));
    console.log('SDK signali (svježa sesija, locations):', JSON.stringify(raw.log));
    const firstConfirmed = raw.log.findIndex((r) => !r.fromCache && !r.hasPendingWrites);
    expect(firstConfirmed).toBeGreaterThanOrEqual(0);
    expect(raw.log[firstConfirmed]!.size).toBe(22);
    for (const s of states) if (s.status === 'ready') expect(s.data.locations).toHaveLength(22);
    expect(states.some((s) => s.status === 'tree-corrupt')).toBe(false);
    raw.un();
    un();
    await L.session.dispose();
  });

  it('DJELOMIČAN keš (stigla samo 1 lokacija): SDK prvo isporuči snapshot iz keša; vrata ga NE puštaju — nikad tree-corrupt, nikad djelomični ready', async () => {
    const L = await openLive(pa);
    await getDocFromServer(doc(L.session.db, `households/${H}/locations/garage-box`)); // keš sada ima SAMO 1 lokaciju
    const raw = rawLog(L.session.db);
    const { states, un } = collect(L.session.db);
    await waitFor(() => states.find((s) => s.status === 'ready'));
    console.log('SDK signali (djelomičan keš, locations):', JSON.stringify(raw.log));
    // dokaz da je opasnost stvarna: SDK doista emitira snapshot iz keša s manjkom lokacija
    const partial = raw.log.find((r) => r.fromCache);
    expect(partial, 'SDK je morao emitirati snapshot iz keša').toBeTruthy();
    expect(partial!.size).toBeLessThan(22);
    // a naivna provjera nad takvim skupom bi dala LAŽNU uzbunu
    expect(
      findTreeProblems([{ id: 'garage-box', parentId: 'garage-shelf' }]).some(
        (p) => p.type === 'missing-parent',
      ),
    ).toBe(true);
    // vrata: ništa od toga nije izašlo
    expect(states.some((s) => s.status === 'tree-corrupt')).toBe(false);
    for (const s of states) if (s.status === 'ready') expect(s.data.locations).toHaveLength(22);
    expect(states.at(-1)!.status).toBe('ready');
    raw.un();
    un();
    await L.session.dispose();
  });

  it('transakcije repozitorija NE stvaraju lokalne nepotvrđene upise (hasPendingWrites ostaje false)', async () => {
    const L = await openLive(pa);
    const raw = rawLog(L.session.db, 'items');
    const { states, un } = collect(L.session.db);
    await waitFor(() => states.find((s) => s.status === 'ready'));
    await L.repo.createItemWithPlacement({
      name: 'Bez pending',
      kind: 'type',
      locationId: 'garage-tool',
    });
    await L.repo.updateItem('hammer', { name: 'Bez pending 2' }, 1);
    await waitFor(() => raw.log.some((r) => r.size === 30));
    await sleep(300);
    expect(raw.log.some((r) => r.hasPendingWrites)).toBe(false);
    raw.un();
    un();
    await L.session.dispose();
  });
});

describe('integritet stabla samo nad cjelovitim skupom', () => {
  it('oštećeno stablo (ciklus) u cjelovitom server-potvrđenom skupu => tree-corrupt, BEZ ikakvih podataka u stanju; popravak => ready', async () => {
    await adminWrite(async (db) => {
      await updateDoc(doc(db, `households/${H}/locations/garage-rack`), { parentId: 'garage-box' });
    });
    const L = await openLive(pa);
    const { states, un } = collect(L.session.db);
    const bad = await waitFor(() => states.find((s) => s.status === 'tree-corrupt'));
    expect(bad.status === 'tree-corrupt' && bad.problems.some((p) => p.type === 'cycle')).toBe(
      true,
    );
    expect('data' in bad).toBe(false);
    expect(states.some((s) => s.status === 'ready')).toBe(false);
    await adminWrite(async (db) => {
      await updateDoc(doc(db, `households/${H}/locations/garage-rack`), { parentId: 'garage' });
    });
    await waitFor(() => states.at(-1)?.status === 'ready');
    un();
    await L.session.dispose();
  });
  it('kućanstvo bez lokacija: ready s needsBootstrap (ne "oštećeno"); nakon bootstrapa needsBootstrap nestaje', async () => {
    await seedEmptyHousehold([[pa.uid, true]]);
    const L = await openLive(pa);
    const { states, un } = collect(L.session.db);
    const first = await waitFor(() => states.find((s) => s.status === 'ready'));
    expect(
      first.status === 'ready' && first.needsBootstrap && first.data.locations.length === 0,
    ).toBe(true);
    expect(states.some((s) => s.status === 'tree-corrupt')).toBe(false);
    await L.repo.bootstrap();
    await waitFor(() => {
      const s = states.at(-1);
      return s?.status === 'ready' && !s.needsBootstrap && s.data.locations.length === 1;
    });
    un();
    await L.session.dispose();
  });
});

describe('P2B-REV-03: prazne lokacije s postojećim podacima (pravi SDK)', () => {
  const seedOnly = async (docs: Record<string, object>) => {
    await seedEmptyHousehold([[pa.uid, true]]);
    await adminWrite(async (db) => {
      const { setDoc, doc: d, Timestamp } = await import('firebase/firestore');
      const now = Timestamp.now();
      for (const [path, data] of Object.entries(docs))
        await setDoc(d(db, `households/${H}/${path}`), {
          ...data,
          createdAt: now,
          updatedAt: now,
          createdBy: 's',
          updatedBy: 's',
        });
    });
  };
  const item = {
    name: 'Siroče',
    kind: 'type',
    aliases: [],
    category: null,
    note: null,
    version: 1,
    archived: false,
  };
  const placement = { itemId: 'siroce', locationId: 'nema-lokacije', version: 1, archived: false };

  it('0 lokacija + postoji predmet => inconsistent (NE needsBootstrap, NE ready); stanje bez podataka', async () => {
    await seedOnly({ 'items/siroce': item });
    const L = await openLive(pa);
    const { states, un } = collect(L.session.db);
    const s = await waitFor(() =>
      states.find((x) => x.status === 'inconsistent' || x.status === 'ready'),
    );
    expect(s).toEqual({ status: 'inconsistent', items: 1, placements: 0 });
    expect(states.some((x) => x.status === 'ready')).toBe(false);
    expect(JSON.stringify(states)).not.toContain('Siroče');
    un();
    await L.session.dispose();
  });
  it('0 lokacija + postoji smještaj => inconsistent; predmet i smještaj zajedno => oba broja', async () => {
    await seedOnly({ 'placements/p1': placement });
    let L = await openLive(pa);
    let c = collect(L.session.db);
    expect(
      await waitFor(() =>
        c.states.find((x) => x.status === 'inconsistent' || x.status === 'ready'),
      ),
    ).toEqual({ status: 'inconsistent', items: 0, placements: 1 });
    c.un();
    await L.session.dispose();
    await seedOnly({ 'items/siroce': item, 'placements/p1': placement });
    L = await openLive(pa);
    c = collect(L.session.db);
    expect(
      await waitFor(() =>
        c.states.find((x) => x.status === 'inconsistent' || x.status === 'ready'),
      ),
    ).toEqual({ status: 'inconsistent', items: 1, placements: 1 });
    c.un();
    await L.session.dispose();
  });
  it('zaista prazno kućanstvo (sve tri kolekcije prazne) => ready s needsBootstrap (kontrola)', async () => {
    await seedEmptyHousehold([[pa.uid, true]]);
    const L = await openLive(pa);
    const { states, un } = collect(L.session.db);
    const s = await waitFor(() =>
      states.find((x) => x.status === 'ready' || x.status === 'inconsistent'),
    );
    expect(s.status === 'ready' && s.needsBootstrap).toBe(true);
    un();
    await L.session.dispose();
  });
  it('LAŽNI ALARM isključen: keš sadrži samo 1 predmet, lokacije u kešu prazne, a na poslužitelju postoje — nikad inconsistent ni needsBootstrap', async () => {
    const L = await openLive(pa);
    await getDocFromServer(doc(L.session.db, `households/${H}/items/hammer`)); // keš: 1 predmet, 0 lokacija
    const raw = rawLog(L.session.db, 'locations');
    const { states, un } = collect(L.session.db);
    await waitFor(() => states.find((x) => x.status === 'ready'));
    console.log('SDK signali (prazne lokacije u kešu):', JSON.stringify(raw.log));
    expect(states.some((x) => x.status === 'inconsistent')).toBe(false);
    expect(states.some((x) => x.status === 'ready' && x.needsBootstrap)).toBe(false);
    for (const x of states) if (x.status === 'ready') expect(x.data.locations).toHaveLength(22);
    raw.un();
    un();
    await L.session.dispose();
  });
});

describe('živo ažuriranje dvaju korisnika', () => {
  it('promjene jednog korisnika stižu drugom putem listenera (nove verzije), bez ponovnog učitavanja', async () => {
    const pb = await signInPrimary('watchB');
    await seedFor([
      [pa.uid, true],
      [pb.uid, true],
    ]);
    const A = await openLive(pa);
    const B = await openLive(pb);
    const { states, un } = collect(A.session.db);
    await waitFor(() => states.find((s) => s.status === 'ready'));
    const { itemId: id, placementId } = await B.repo.createItemWithPlacement({
      name: 'Od korisnika B',
      kind: 'type',
      locationId: 'hall-cabinet',
    });
    const pl = { id: placementId };
    await waitFor(() => {
      const s = states.at(-1);
      return (
        s?.status === 'ready' &&
        s.data.items.some((i) => i.id === id) &&
        s.data.placements.some((p) => p.id === pl.id)
      );
    });
    await B.repo.movePlacement(pl.id, 'kitchen-drawer', 1);
    await waitFor(() => {
      const s = states.at(-1);
      return (
        s?.status === 'ready' &&
        s.data.placements.find((p) => p.id === pl.id)?.locationId === 'kitchen-drawer'
      );
    });
    un();
    await A.session.dispose();
    await B.session.dispose();
  });
  it('sesija se otvara i za drugu instancu iste konfiguracije (dataSession) bez dijeljenja keša', async () => {
    const s1 = await openDataSession(pa.auth, CONFIG, EMU);
    const s2 = await openDataSession(pa.auth, CONFIG, EMU);
    const r1 = rawLog(s1.db);
    await waitFor(() => r1.log.some((r) => !r.fromCache));
    const r2 = rawLog(s2.db);
    // s2 nikad nije ništa čitao => njegov PRVI snapshot ne smije biti iz keša s podacima iz s1
    await waitFor(() => r2.log.length > 0);
    expect(r2.log[0]!.fromCache && r2.log[0]!.size > 0).toBe(false);
    r1.un();
    r2.un();
    await s1.dispose();
    await s2.dispose();
  });
});
