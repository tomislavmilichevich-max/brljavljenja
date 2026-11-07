// P2-C: pouzdana provjera ishoda ('outcome-unknown') i idempotentni ponovni pokušaj — PRAVI SDK + PRAVA pravila.
// Pokušaj stvaranja ima ID-eve sačuvane PRIJE poziva; provjera ide server-potvrđenim čitanjem po IDENTITETU (ne po nazivu);
// ponavljanje istog pokušaja ne može stvoriti duplikat. Ništa se ne ponavlja automatski.
import { collection, getDocsFromServer } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newCreateAttempt } from '../src/inventory/repository';
import {
  EMU,
  H,
  adminRead,
  barrier,
  closeAdmin,
  createProxy,
  openLive,
  outcome,
  seedFor,
  signInPrimary,
  type Live,
  type Primary,
} from './helpers';

let pa: Primary, pb: Primary;
let A: Live, B: Live;
const proxy = createProxy(8080);
let L: Live; // sesija preko proxyja (za stvarni prekid mreže)

const count = (col: string) =>
  adminRead(
    async (db) => (await getDocsFromServer(collection(db as never, `households/${H}/${col}`))).size,
  );
const names = (col: string) =>
  adminRead(async (db) =>
    (await getDocsFromServer(collection(db as never, `households/${H}/${col}`))).docs.map((d) =>
      String(d.data().name),
    ),
  );

beforeAll(async () => {
  pa = await signInPrimary('verA');
  pb = await signInPrimary('verB');
  await seedFor([
    [pa.uid, true],
    [pb.uid, true],
  ]);
  A = await openLive(pa);
  B = await openLive(pb);
  const port = await proxy.listen();
  L = await openLive(pa, { emulator: { ...EMU, firestorePort: port } });
});
afterEach(() => proxy.up());
afterAll(async () => {
  await proxy.close();
  await A.session.dispose();
  await B.session.dispose();
  await L.session.dispose();
  await closeAdmin();
});
beforeEach(async () => {
  A.hooks.afterReads = undefined;
  B.hooks.afterReads = undefined;
  L.hooks.afterReads = undefined;
  await seedFor([
    [pa.uid, true],
    [pb.uid, true],
  ]);
});

describe('createItemWithPlacement: idempotentni pokušaj sa sačuvanim ID-evima', () => {
  it('isti pokušaj dvaput => točno jedan Item, jedan Placement, jedan ključ; drugi poziv ne piše ništa', async () => {
    const attempt = newCreateAttempt();
    const input = { name: 'IDEMPOTENT', kind: 'type' as const, locationId: 'garage-tool', attempt };
    const [items0, pl0, keys0] = await Promise.all([
      count('items'),
      count('placements'),
      count('placementKeys'),
    ]);
    const r1 = await A.repo.createItemWithPlacement(input);
    expect(r1).toEqual({ itemId: attempt.itemId, placementId: attempt.placementId });
    const r2 = await A.repo.createItemWithPlacement(input);
    expect(r2.alreadyExisted).toBe(true);
    expect(r2.itemId).toBe(attempt.itemId);
    expect(await count('items')).toBe(items0 + 1);
    expect(await count('placements')).toBe(pl0 + 1);
    expect(await count('placementKeys')).toBe(keys0 + 1);
    // verzija prvog zapisa nije povećana drugim pozivom
    const it = (await A.repo.verify({
      op: 'createItem',
      ...attempt,
      locationId: 'garage-tool',
    })) as string;
    expect(it).toBe('applied');
  });

  it('bez attempt-a svaki poziv dobiva nove ID-eve (ponašanje P2-B se ne mijenja)', async () => {
    const a = await A.repo.createItemWithPlacement({
      name: 'BEZ-ATTEMPT',
      kind: 'unique',
      locationId: 'garage-tool',
    });
    const b = await A.repo.createItemWithPlacement({
      name: 'BEZ-ATTEMPT',
      kind: 'unique',
      locationId: 'garage-tool',
    });
    expect(a.itemId).not.toBe(b.itemId);
  });

  it('ID pokušaja zauzet DRUGIM zapisom (Item postoji, Placement ne pripada njemu) => odbijeno, ništa se ne prepisuje', async () => {
    const first = newCreateAttempt();
    await A.repo.createItemWithPlacement({
      name: 'PRVI',
      kind: 'type',
      locationId: 'garage-tool',
      attempt: first,
    });
    const clash = { itemId: first.itemId, placementId: newCreateAttempt().placementId };
    expect(
      await outcome(
        A.repo.createItemWithPlacement({
          name: 'DRUGI',
          kind: 'type',
          locationId: 'garage-tool',
          attempt: clash,
        }),
      ),
    ).toBe('ERR:unknown');
    expect(await names('items')).not.toContain('DRUGI');
  });
});

describe('verify(): server-potvrđena provjera po identitetu/verziji', () => {
  it('createItem: not-applied prije, applied poslije; predmet ISTOG NAZIVA s drugim ID-evima NE računa se kao uspjeh', async () => {
    const attempt = newCreateAttempt();
    expect(await A.repo.verify({ op: 'createItem', ...attempt, locationId: 'garage-tool' })).toBe(
      'not-applied',
    );
    await B.repo.createItemWithPlacement({
      name: 'ISTI-NAZIV',
      kind: 'type',
      locationId: 'garage-tool',
    });
    // postoji predmet istog naziva, ali to nije NAŠ pokušaj
    expect(await A.repo.verify({ op: 'createItem', ...attempt, locationId: 'garage-tool' })).toBe(
      'not-applied',
    );
    await B.repo.createItemWithPlacement({
      name: 'ISTI-NAZIV',
      kind: 'type',
      locationId: 'garage-tool',
      attempt,
    });
    expect(await A.repo.verify({ op: 'createItem', ...attempt, locationId: 'garage-tool' })).toBe(
      'applied',
    );
  });

  it('createLocation / addPlacement: applied tek kad postoje; createLocation je idempotentan sa sačuvanim ID-em', async () => {
    const id = crypto.randomUUID();
    expect(await A.repo.verify({ op: 'createLocation', id })).toBe('not-applied');
    await A.repo.createLocation({
      name: 'Nova polica',
      parentId: 'garage-tool',
      kind: 'shelf',
      id,
    });
    expect(await A.repo.verify({ op: 'createLocation', id })).toBe('applied');
    const again = await A.repo.createLocation({
      name: 'Nova polica',
      parentId: 'garage-tool',
      kind: 'shelf',
      id,
    });
    expect(again.alreadyExisted).toBe(true);
    expect((await names('locations')).filter((n) => n === 'Nova polica')).toHaveLength(1);

    const pid = crypto.randomUUID();
    const spec = {
      op: 'addPlacement',
      itemId: 'battery',
      locationId: 'hall-cabinet',
      placementId: pid,
    } as const;
    expect(await A.repo.verify(spec)).toBe('not-applied');
    await A.repo.addPlacement('battery', 'hall-cabinet', pid);
    expect(await A.repo.verify(spec)).toBe('applied');
  });

  it('updateItem / renameLocation / moveLocation / movePlacement: verzija+vrijednost odlučuju (applied / not-applied / changed-elsewhere)', async () => {
    const upd = {
      op: 'updateItem',
      id: 'hammer',
      expectedVersion: 1,
      patch: { name: 'Novi čekić' },
    } as const;
    expect(await A.repo.verify(upd)).toBe('not-applied');
    await B.repo.updateItem('hammer', { name: 'Novi čekić' }, 1);
    expect(await A.repo.verify(upd)).toBe('applied');
    // netko drugi promijeni dalje => ne smije se tvrditi da je primijenjeno naše
    await B.repo.updateItem('hammer', { name: 'Treći naziv' }, 2);
    expect(await A.repo.verify(upd)).toBe('changed-elsewhere');
    // druga vrijednost na istoj verziji (netko drugi) nije NAŠA promjena
    expect(
      await A.repo.verify({
        op: 'updateItem',
        id: 'hammer',
        expectedVersion: 2,
        patch: { name: 'Drugo' },
      }),
    ).toBe('changed-elsewhere');

    const ren = {
      op: 'renameLocation',
      id: 'garage-box',
      expectedVersion: 1,
      name: 'Kutija X',
    } as const;
    expect(await A.repo.verify(ren)).toBe('not-applied');
    await B.repo.renameLocation('garage-box', 'Kutija X', 1);
    expect(await A.repo.verify(ren)).toBe('applied');

    const mv = {
      op: 'moveLocation',
      id: 'garage-box',
      expectedVersion: 2,
      newParentId: 'living-tv',
    } as const;
    expect(await A.repo.verify(mv)).toBe('not-applied');
    await B.repo.moveLocation('garage-box', 'living-tv', 2);
    expect(await A.repo.verify(mv)).toBe('applied');

    const mp = {
      op: 'movePlacement',
      id: 'pl-battery-2',
      expectedVersion: 1,
      newLocationId: 'hall-cabinet',
    } as const;
    expect(await A.repo.verify(mp)).toBe('not-applied');
    await B.repo.movePlacement('pl-battery-2', 'hall-cabinet', 1);
    expect(await A.repo.verify(mp)).toBe('applied');
  });
});

describe('stvarni prekid mreže: Provjeri stanje -> ponovni pokušaj s ISTIM ID-evima', () => {
  it('veza pada prije commita => outcome-unknown; verify bez veze = unknown; s vezom = not-applied; ponovni pokušaj stvara TOČNO jedan predmet', async () => {
    const attempt = newCreateAttempt();
    const input = {
      name: 'NEPOZNAT-ISHOD',
      kind: 'type' as const,
      locationId: 'garage-tool',
      attempt,
    };
    const before = await count('items');
    L.hooks.afterReads = async () => proxy.down();
    expect(await outcome(L.repo.createItemWithPlacement(input))).toBe('ERR:outcome-unknown');
    L.hooks.afterReads = undefined;
    // dok je veza prekinuta: provjera NE smije pogađati ni uspjeh ni neuspjeh
    expect(await L.repo.verify({ op: 'createItem', ...attempt, locationId: 'garage-tool' })).toBe(
      'unknown',
    );
    proxy.up();
    expect(await L.repo.verify({ op: 'createItem', ...attempt, locationId: 'garage-tool' })).toBe(
      'not-applied',
    );
    expect(await count('items')).toBe(before);
    // korisnik izričito ponavlja ISTI pokušaj
    expect(await outcome(L.repo.createItemWithPlacement(input))).toBe('OK');
    expect(await L.repo.verify({ op: 'createItem', ...attempt, locationId: 'garage-tool' })).toBe(
      'applied',
    );
    // i još jedno ponavljanje (npr. dvostruki klik nakon spore veze) ne stvara duplikat
    const r = await L.repo.createItemWithPlacement(input);
    expect(r.alreadyExisted).toBe(true);
    expect(await count('items')).toBe(before + 1);
  }, 120000);

  it('"odgovor izgubljen": commit je STIGAO do poslužitelja, klijent vidi outcome-unknown => verify = applied, ponavljanje je no-op', async () => {
    const attempt = newCreateAttempt();
    const input = {
      name: 'IZGUBLJEN-ODGOVOR',
      kind: 'unique' as const,
      locationId: 'garage-tool',
      attempt,
    };
    // simulacija: isti zapis nastaje na poslužitelju (kao da je commit stigao), a klijent ne zna
    await B.repo.createItemWithPlacement(input);
    proxy.down();
    expect(await L.repo.verify({ op: 'createItem', ...attempt, locationId: 'garage-tool' })).toBe(
      'unknown',
    );
    proxy.up();
    expect(await L.repo.verify({ op: 'createItem', ...attempt, locationId: 'garage-tool' })).toBe(
      'applied',
    );
    const before = await count('items');
    const r = await L.repo.createItemWithPlacement(input);
    expect(r.alreadyExisted).toBe(true);
    expect(await count('items')).toBe(before);
  }, 120000);
});

describe('P2C-REV-01: createItemWithPlacement — i očekivana lokacija, ne samo itemId/kind', () => {
  it('isti ID-evi, ALI druga lokacija: ponavljanje je odbijeno (ne "alreadyExisted"), verify = changed-elsewhere', async () => {
    const attempt = newCreateAttempt();
    await B.repo.createItemWithPlacement({
      name: 'LOK',
      kind: 'type',
      locationId: 'garage-tool',
      attempt,
    });
    expect(
      await outcome(
        A.repo.createItemWithPlacement({
          name: 'LOK',
          kind: 'type',
          locationId: 'hall-cabinet',
          attempt,
        }),
      ),
    ).toBe('ERR:unknown');
    expect(await A.repo.verify({ op: 'createItem', ...attempt, locationId: 'hall-cabinet' })).toBe(
      'changed-elsewhere',
    );
    expect(await A.repo.verify({ op: 'createItem', ...attempt, locationId: 'garage-tool' })).toBe(
      'applied',
    );
  });
  it('zakašnjeli commit nakon provjere "not-applied": ponavljanje istim ID-evima i parametrima je no-op, ostaje JEDAN predmet (dva predmeta istog naziva ne miješaju se)', async () => {
    const attempt = newCreateAttempt();
    const input = { name: 'ISTI', kind: 'type' as const, locationId: 'garage-tool', attempt };
    await B.repo.createItemWithPlacement({ name: 'ISTI', kind: 'type', locationId: 'garage-tool' }); // tuđi, isti naziv
    expect(await A.repo.verify({ op: 'createItem', ...attempt, locationId: 'garage-tool' })).toBe(
      'not-applied',
    );
    await B.repo.createItemWithPlacement(input); // zakašnjeli upis našeg pokušaja
    const before = await count('items');
    const r = await A.repo.createItemWithPlacement(input);
    expect(r.alreadyExisted).toBe(true);
    expect(await count('items')).toBe(before);
    expect((await names('items')).filter((n) => n === 'ISTI')).toHaveLength(2);
  });
});

describe('P2C-REV-02: addPlacement — stabilan Placement ID, provjera konkretnog Placementa i njegova ključa', () => {
  const spec = (placementId: string, locationId = 'hall-cabinet') =>
    ({ op: 'addPlacement', itemId: 'battery', locationId, placementId }) as const;

  it('ponovljeni pokušaj istim ID-em je idempotentan: jedan Placement, jedan ključ, drugi poziv ne piše', async () => {
    const pid = crypto.randomUUID();
    const [p0, k0] = await Promise.all([count('placements'), count('placementKeys')]);
    const r1 = await A.repo.addPlacement('battery', 'hall-cabinet', pid);
    expect(r1).toEqual({ id: pid });
    const r2 = await A.repo.addPlacement('battery', 'hall-cabinet', pid);
    expect(r2).toEqual({ id: pid, alreadyExisted: true });
    expect(await count('placements')).toBe(p0 + 1);
    expect(await count('placementKeys')).toBe(k0 + 1);
    expect(await A.repo.verify(spec(pid))).toBe('applied');
  });
  it('drugi korisnik PRVI stvori smještaj na istoj lokaciji: za NAŠ pokušaj nije "applied" (changed-elsewhere), a naš upis daje duplicate-placement', async () => {
    const mine = crypto.randomUUID();
    await B.repo.addPlacement('battery', 'hall-cabinet', crypto.randomUUID());
    expect(await A.repo.verify(spec(mine))).toBe('changed-elsewhere');
    expect(await outcome(A.repo.addPlacement('battery', 'hall-cabinet', mine))).toBe(
      'ERR:duplicate-placement',
    );
    expect(await A.repo.verify(spec(mine))).toBe('changed-elsewhere');
  });
  it('unique: drugi korisnik smjesti predmet prvi (bilo gdje) — naš pokušaj nikad nije "applied"', async () => {
    const item = await B.repo.createItemWithPlacement({
      name: 'JEDINSTVEN',
      kind: 'unique',
      locationId: 'garage-tool',
    });
    const mine = crypto.randomUUID();
    const s = {
      op: 'addPlacement',
      itemId: item.itemId,
      locationId: 'hall-cabinet',
      placementId: mine,
    } as const;
    expect(await outcome(A.repo.addPlacement(item.itemId, 'hall-cabinet', mine))).toBe(
      'ERR:duplicate-placement',
    );
    expect(await A.repo.verify(s)).toBe('changed-elsewhere');
  });
  it('prisilno preklapanje A i B (isti predmet + lokacija, različiti Placement ID-evi): TOČNO jedan uspije; za gubitnika verify NIJE applied', async () => {
    const pa_ = crypto.randomUUID();
    const pb_ = crypto.randomUUID();
    const wait = barrier(2);
    A.hooks.afterReads = wait;
    B.hooks.afterReads = wait;
    const [ra, rb] = await Promise.all([
      outcome(A.repo.addPlacement('battery', 'hall-cabinet', pa_)),
      outcome(B.repo.addPlacement('battery', 'hall-cabinet', pb_)),
    ]);
    expect([ra, rb].filter((r) => r === 'OK')).toHaveLength(1);
    const [va, vb] = await Promise.all([A.repo.verify(spec(pa_)), B.repo.verify(spec(pb_))]);
    expect([va, vb].filter((v) => v === 'applied')).toHaveLength(1);
    expect(ra === 'OK' ? va : vb).toBe('applied');
    expect(ra === 'OK' ? vb : va).toBe('changed-elsewhere');
    const keys = await adminRead(
      async (db) =>
        (
          await getDocsFromServer(collection(db as never, `households/${H}/placementKeys`))
        ).docs.filter((d) => d.id === 'battery__at__hall-cabinet').length,
    );
    expect(keys).toBe(1);
  });
  it('prekid veze TIJEKOM potvrđivanja: outcome-unknown; verify bez veze = unknown, s vezom = not-applied; ponavljanje ISTIM ID-em stvara točno jedan, drugo je no-op', async () => {
    const pid = crypto.randomUUID();
    const p0 = await count('placements');
    L.hooks.afterReads = async () => proxy.down();
    expect(await outcome(L.repo.addPlacement('battery', 'hall-cabinet', pid))).toBe(
      'ERR:outcome-unknown',
    );
    L.hooks.afterReads = undefined;
    expect(await L.repo.verify(spec(pid))).toBe('unknown');
    proxy.up();
    expect(await L.repo.verify(spec(pid))).toBe('not-applied');
    expect(await count('placements')).toBe(p0);
    expect(await outcome(L.repo.addPlacement('battery', 'hall-cabinet', pid))).toBe('OK');
    expect((await L.repo.addPlacement('battery', 'hall-cabinet', pid)).alreadyExisted).toBe(true);
    expect(await count('placements')).toBe(p0 + 1);
    expect(await L.repo.verify(spec(pid))).toBe('applied');
  }, 120000);
  it('zakašnjeli commit (isti Placement ID stigne od drugog sudionika nakon "not-applied"): ponavljanje je no-op, i dalje JEDAN smještaj', async () => {
    const pid = crypto.randomUUID();
    expect(await A.repo.verify(spec(pid))).toBe('not-applied');
    await B.repo.addPlacement('battery', 'hall-cabinet', pid); // zakašnjeli upis našeg pokušaja
    expect((await A.repo.addPlacement('battery', 'hall-cabinet', pid)).alreadyExisted).toBe(true);
    expect(await A.repo.verify(spec(pid))).toBe('applied');
  });
  it('Placement ID zauzet drugim zapisom (druga lokacija): odbijeno, ništa se ne prepisuje; verify = changed-elsewhere', async () => {
    const pid = crypto.randomUUID();
    await B.repo.addPlacement('battery', 'hall-cabinet', pid);
    expect(await outcome(A.repo.addPlacement('battery', 'garage-tool', pid))).toBe('ERR:unknown');
    expect(await A.repo.verify(spec(pid, 'garage-tool'))).toBe('changed-elsewhere');
  });
  it('pravila jedinstvenosti ostaju: type — isti predmet na istoj lokaciji dvaput (različiti ID-evi) odbijeno; unique — drugi smještaj odbijen', async () => {
    await A.repo.addPlacement('battery', 'hall-cabinet', crypto.randomUUID());
    expect(await outcome(A.repo.addPlacement('battery', 'hall-cabinet', crypto.randomUUID()))).toBe(
      'ERR:duplicate-placement',
    );
    expect(await outcome(A.repo.addPlacement('hammer', 'hall-cabinet', crypto.randomUUID()))).toBe(
      'ERR:duplicate-placement',
    );
  });
});
