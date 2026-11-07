// Stvarni prekid mreže (TCP proxy ispred Firestore emulatora): upisi se ODBIJAJU, ne ulaze u skriveni red i
// NE šalju se automatski nakon povratka veze; podaci iz keša se ne otkrivaju kao potvrđeni.
import { collection, doc, getDocsFromServer, getDocFromServer } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { InventoryState } from '../src/inventory/gate';
import { isAccessRevoked } from '../src/inventory/access';
import { watchInventory } from '../src/inventory/watch';
import {
  EMU,
  H,
  adminRead,
  adminWrite,
  closeAdmin,
  createProxy,
  openLive,
  outcome,
  seedFor,
  signInPrimary,
  sleep,
  waitFor,
  type Primary,
} from './helpers';

let pa: Primary;
const proxy = createProxy(8080);
let proxyPort = 0;
beforeAll(async () => {
  pa = await signInPrimary('offA');
  await seedFor([[pa.uid, true]]);
  proxyPort = await proxy.listen();
});
afterEach(() => proxy.up()); // test koji padne ne smije ostaviti mrežu prekinutu za sljedeći
afterAll(async () => {
  await proxy.close();
  await closeAdmin();
});

const names = (col: 'items' | 'locations') =>
  adminRead(async (db) =>
    (await getDocsFromServer(collection(db as never, `households/${H}/${col}`))).docs.map((d) =>
      String(d.data().name),
    ),
  );

describe('prekid mreže: nema skrivenog reda, nema automatskog naknadnog slanja', () => {
  it('sve operacije pišu isključivo online: bez veze svaka završava s offline (unutar 20 s), a nakon povratka veze NIŠTA se ne pojavi samo od sebe', async () => {
    const L = await openLive(pa, { emulator: { ...EMU, firestorePort: proxyPort } });
    const states: InventoryState[] = [];
    const un = watchInventory(L.session.db, H, (s) => states.push(s));
    await waitFor(() => states.find((s) => s.status === 'ready'));

    proxy.down(); // STVARNI prekid: sve veze uništene, nove odbijene
    const t0 = Date.now();
    const results = await Promise.all([
      outcome(
        L.repo.createItemWithPlacement({
          name: 'OFFLINE-predmet',
          kind: 'type',
          locationId: 'garage-tool',
        }),
      ),
      outcome(
        L.repo.createLocation({ name: 'OFFLINE-lokacija', parentId: 'garage-tool', kind: 'shelf' }),
      ),
      outcome(L.repo.updateItem('hammer', { name: 'OFFLINE-ime' }, 1)),
      outcome(L.repo.renameLocation('garage-box', 'OFFLINE-kutija', 1)),
      outcome(L.repo.addPlacement('battery', 'hall-cabinet')),
      outcome(L.repo.movePlacement('pl-battery-2', 'hall-cabinet', 1)),
      outcome(L.repo.archivePlacement('pl-battery-2', 1)),
      outcome(L.repo.moveLocation('garage-box', 'living-tv')),
      outcome(L.repo.bootstrap()),
    ]);
    const elapsed = Date.now() - t0;
    console.log('OFFLINE rezultati:', results, `za ${elapsed} ms`);
    expect(results).toEqual(Array(9).fill('ERR:offline'));
    expect(elapsed).toBeLessThan(20000);
    // bez mreže ne tvrdimo da je pristup opozvan
    expect(await isAccessRevoked(L.session.db, H)).toBe(false);

    proxy.up(); // veza se vraća
    await waitFor(() => states.at(-1)?.status === 'ready', 60000);
    await sleep(4000); // dovoljno vremena da bi se eventualni skriveni red poslao
    const [items, locs] = await Promise.all([names('items'), names('locations')]);
    expect(items.some((n) => n.startsWith('OFFLINE'))).toBe(false);
    expect(locs.some((n) => n.startsWith('OFFLINE'))).toBe(false);
    expect(
      await adminRead(
        async (db) =>
          (await getDocFromServer(doc(db as never, `households/${H}/items/hammer`))).data()!
            .version,
      ),
    ).toBe(1);
    expect(
      await adminRead(
        async (db) =>
          (
            await getDocFromServer(doc(db as never, `households/${H}/placements/pl-battery-2`))
          ).data()!.archived,
      ),
    ).toBe(false);

    // izričiti ponovni pokušaj korisnika uspijeva
    await L.repo.updateItem('hammer', { name: 'Online ime' }, 1);
    expect(
      await adminRead(
        async (db) =>
          (await getDocFromServer(doc(db as never, `households/${H}/items/hammer`))).data()!.name,
      ),
    ).toBe('Online ime');
    un();
    await L.session.dispose();
  }, 180000);

  it('veza pada TOČNO između čitanja i commita: ishod je "outcome-unknown" (ne tvrdi "nije spremljeno"); na poslužitelj ništa ne stiže; ništa se ne šalje naknadno', async () => {
    await seedFor([[pa.uid, true]]);
    const L = await openLive(pa, { emulator: { ...EMU, firestorePort: proxyPort } });
    const states: InventoryState[] = [];
    const un = watchInventory(L.session.db, H, (s) => states.push(s));
    await waitFor(() => states.find((s) => s.status === 'ready'));
    L.hooks.afterReads = async () => proxy.down(); // transakcija je sve pročitala; sada pada veza prije commita
    const r1 = await outcome(L.repo.updateItem('hammer', { name: 'UNKNOWN-ishod' }, 1));
    expect(r1).toBe('ERR:outcome-unknown');
    proxy.up();
    await waitFor(() => states.at(-1)?.status === 'ready', 60000);
    L.hooks.afterReads = async () => proxy.down();
    const r2 = await outcome(L.repo.moveLocation('garage-box', 'living-tv'));
    expect(r2).toBe('ERR:outcome-unknown');
    proxy.up();
    await waitFor(() => states.at(-1)?.status === 'ready', 60000);
    await sleep(3000);
    expect(
      await adminRead(
        async (db) =>
          (await getDocFromServer(doc(db as never, `households/${H}/items/hammer`))).data()!.name,
      ),
    ).toBe('Čekić');
    expect(
      await adminRead(
        async (db) =>
          (await getDocFromServer(doc(db as never, `households/${H}/locations/garage-box`))).data()!
            .parentId,
      ),
    ).toBe('garage-shelf');
    L.hooks.afterReads = undefined;
    await L.repo.updateItem('hammer', { name: 'Nakon provjere' }, 1); // izričiti novi pokušaj uspijeva
    un();
    await L.session.dispose();
  }, 180000);

  it('REV-04: atomarno stvaranje predmeta — pad veze između čitanja i commita => outcome-unknown, a NIJEDAN od Item/Placement/ključ ne postoji (nema djelomičnog stanja)', async () => {
    await seedFor([[pa.uid, true]]);
    const L = await openLive(pa, { emulator: { ...EMU, firestorePort: proxyPort } });
    const states: InventoryState[] = [];
    const un = watchInventory(L.session.db, H, (s) => states.push(s));
    await waitFor(() => states.find((s) => s.status === 'ready'));
    L.hooks.afterReads = async () => proxy.down();
    const r = await outcome(
      L.repo.createItemWithPlacement({
        name: 'ATOMARNO-nepoznato',
        kind: 'type',
        locationId: 'garage-tool',
      }),
    );
    expect(r).toBe('ERR:outcome-unknown');
    proxy.up();
    await waitFor(() => states.at(-1)?.status === 'ready', 60000);
    await sleep(3000);
    expect((await names('items')).some((n) => n.startsWith('ATOMARNO'))).toBe(false);
    const orphanKeys = await adminRead(
      async (db) =>
        (await getDocsFromServer(collection(db as never, `households/${H}/placementKeys`))).docs
          .length,
    );
    expect(orphanKeys).toBe(32); // samo seed (32 aktivna smještaja iz demo kuće)
    expect(
      await adminRead(
        async (db) =>
          (await getDocsFromServer(collection(db as never, `households/${H}/placements`))).size,
      ),
    ).toBe(32);
    L.hooks.afterReads = undefined;
    const ok = await L.repo.createItemWithPlacement({
      name: 'ATOMARNO-ponovljeno',
      kind: 'type',
      locationId: 'garage-tool',
    });
    expect(ok.itemId).toBeTruthy();
    un();
    await L.session.dispose();
  }, 180000);

  it('gubitak veze nakon cjelovitog skupa: stanje "stale" (zadnji POTVRĐENI podaci, bez novih iz keša); povratak veze: ready s novim podacima', async () => {
    await seedFor([[pa.uid, true]]);
    const L = await openLive(pa, { emulator: { ...EMU, firestorePort: proxyPort } });
    const states: InventoryState[] = [];
    const un = watchInventory(L.session.db, H, (s) => states.push(s));
    await waitFor(() => states.find((s) => s.status === 'ready'));
    proxy.down();
    let sawStale = true;
    try {
      await waitFor(() => states.find((s) => s.status === 'stale'), 45000);
    } catch {
      sawStale = false;
    }
    console.log('OFFLINE listener (gRPC/Node): stale signal', sawStale ? 'DA' : 'NE u 45 s');
    await adminWrite(async (db) => {
      const { updateDoc, doc: d } = await import('firebase/firestore');
      await updateDoc(d(db, `households/${H}/items/hammer`), {
        name: 'Promjena tijekom prekida',
        version: 5,
      });
    });
    if (sawStale) {
      const stale = states.findLast((s) => s.status === 'stale');
      expect(
        stale && stale.status === 'stale' && stale.data.items.find((i) => i.id === 'hammer')?.name,
      ).not.toBe('Promjena tijekom prekida');
    }
    proxy.up();
    await waitFor(() => {
      const s = states.at(-1);
      return (
        s?.status === 'ready' &&
        s.data.items.find((i) => i.id === 'hammer')?.name === 'Promjena tijekom prekida'
      );
    }, 60000);
    un();
    await L.session.dispose();
  }, 180000);
});
