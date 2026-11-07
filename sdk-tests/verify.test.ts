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
    const it = (await A.repo.verify({ op: 'createItem', ...attempt })) as string;
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
    expect(await A.repo.verify({ op: 'createItem', ...attempt })).toBe('not-applied');
    await B.repo.createItemWithPlacement({
      name: 'ISTI-NAZIV',
      kind: 'type',
      locationId: 'garage-tool',
    });
    // postoji predmet istog naziva, ali to nije NAŠ pokušaj
    expect(await A.repo.verify({ op: 'createItem', ...attempt })).toBe('not-applied');
    await B.repo.createItemWithPlacement({
      name: 'ISTI-NAZIV',
      kind: 'type',
      locationId: 'garage-tool',
      attempt,
    });
    expect(await A.repo.verify({ op: 'createItem', ...attempt })).toBe('applied');
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

    expect(
      await A.repo.verify({ op: 'addPlacement', itemId: 'battery', locationId: 'hall-cabinet' }),
    ).toBe('not-applied');
    await A.repo.addPlacement('battery', 'hall-cabinet');
    expect(
      await A.repo.verify({ op: 'addPlacement', itemId: 'battery', locationId: 'hall-cabinet' }),
    ).toBe('applied');
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
    expect(await L.repo.verify({ op: 'createItem', ...attempt })).toBe('unknown');
    proxy.up();
    expect(await L.repo.verify({ op: 'createItem', ...attempt })).toBe('not-applied');
    expect(await count('items')).toBe(before);
    // korisnik izričito ponavlja ISTI pokušaj
    expect(await outcome(L.repo.createItemWithPlacement(input))).toBe('OK');
    expect(await L.repo.verify({ op: 'createItem', ...attempt })).toBe('applied');
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
    expect(await L.repo.verify({ op: 'createItem', ...attempt })).toBe('unknown');
    proxy.up();
    expect(await L.repo.verify({ op: 'createItem', ...attempt })).toBe('applied');
    const before = await count('items');
    const r = await L.repo.createItemWithPlacement(input);
    expect(r.alreadyExisted).toBe(true);
    expect(await count('items')).toBe(before);
  }, 120000);
});
