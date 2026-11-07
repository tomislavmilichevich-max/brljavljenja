// Produkcijski repozitorij (src/inventory/repository.ts) nad PRAVIM SDK-om i PRAVIM pravilima u emulatoru.
// Svaki korisnik ima vlastitu izoliranu podatkovnu sesiju (kao u aplikaciji). Demo kuća, sintetski računi.
import { collection, doc, getDocFromServer, getDocsFromServer } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DomainError } from '../src/inventory/errors';
import { findTreeProblems } from '../src/inventory/tree';
import {
  H,
  admin,
  adminRead,
  barrier,
  closeAdmin,
  openLive,
  outcome,
  seedChains,
  seedEmptyHousehold,
  seedFor,
  setEnabled,
  signInPrimary,
  type Live,
  type Primary,
} from './helpers';

let pa: Primary, pb: Primary;
let A: Live, B: Live;
const MEMBERS = () =>
  [
    [pa.uid, true],
    [pb.uid, true],
  ] as const;

beforeAll(async () => {
  pa = await signInPrimary('repoA');
  pb = await signInPrimary('repoB');
  await seedFor(MEMBERS());
  A = await openLive(pa);
  B = await openLive(pb);
});
afterAll(async () => {
  await A.session.dispose();
  await B.session.dispose();
  await closeAdmin();
});
beforeEach(async () => {
  A.hooks.afterReads = undefined;
  B.hooks.afterReads = undefined;
  await seedFor(MEMBERS());
});

const rejects = (p: Promise<unknown>) => expect(p).rejects;
const docData = (path: string) =>
  adminRead(async (db) =>
    (await getDocFromServer(doc(db as never, `households/${H}/${path}`))).data(),
  );
const treeRev = async () => (await docData('meta/tree'))!.rev as number;
const allLocs = () =>
  adminRead(async (db) =>
    (await getDocsFromServer(collection(db as never, `households/${H}/locations`))).docs.map(
      (d) => ({ id: d.id, parentId: d.data().parentId as string | null }),
    ),
  );
const keyIds = async () =>
  (
    await adminRead(async (db) =>
      (await getDocsFromServer(collection(db as never, `households/${H}/placementKeys`))).docs.map(
        (d) => d.id,
      ),
    )
  ).sort();

describe('bootstrap kućanstva (izričita radnja, bez demo podataka)', () => {
  it('prazno kućanstvo: stvara meta/tree i root; ponovljeno ne stvara ništa; zatim se mogu dodavati lokacije', async () => {
    await seedEmptyHousehold(MEMBERS());
    expect(await A.repo.bootstrap()).toEqual({ created: ['meta/tree', 'locations/root'] });
    expect(await A.repo.bootstrap()).toEqual({ created: [] });
    expect(await docData('locations/root')).toMatchObject({
      kind: 'house',
      parentId: null,
      version: 1,
      archived: false,
    });
    expect(
      (await A.repo.createLocation({ name: 'Kuhinja', parentId: 'root', kind: 'room' })).id,
    ).toBeTruthy();
  });
  it('istodobni bootstrap dvaju korisnika: nema dupliciranja ni greške', async () => {
    await seedEmptyHousehold(MEMBERS());
    const [ra, rb] = await Promise.all([outcome(A.repo.bootstrap()), outcome(B.repo.bootstrap())]);
    expect([ra, rb].filter((r) => r === 'OK').length).toBeGreaterThanOrEqual(1);
    expect((await docData('locations/root'))!.name).toBe('Kuća');
    expect(await treeRev()).toBe(0);
  });
  it('premještaj prije bootstrapa javlja not-bootstrapped (ne ruši se)', async () => {
    await seedEmptyHousehold(MEMBERS());
    await rejects(A.repo.moveLocation('x', 'root')).toMatchObject({ code: 'not-bootstrapped' });
  });
});

describe('lokacije: kreiranje, preimenovanje, validacija, P2-LOC-ROOM-01', () => {
  it('stvara sve dopuštene vrste pod odgovarajućim roditeljima; prostorija samo pod root', async () => {
    const room = await A.repo.createLocation({
      name: '  Radna soba ',
      parentId: 'root',
      kind: 'room',
    });
    expect((await docData(`locations/${room.id}`))!.name).toBe('Radna soba'); // trim
    const cab = await B.repo.createLocation({ name: 'Ormar', parentId: room.id, kind: 'cabinet' });
    const shelf = await A.repo.createLocation({ name: 'Polica', parentId: cab.id, kind: 'shelf' });
    const box = await A.repo.createLocation({ name: 'Kutija', parentId: shelf.id, kind: 'box' });
    await A.repo.createLocation({ name: 'Ladica', parentId: cab.id, kind: 'drawer' });
    await A.repo.createLocation({ name: 'Razno', parentId: box.id, kind: 'other' });
    await A.repo.createLocation({ name: 'Ormar uz zid', parentId: 'root', kind: 'cabinet' }); // ne-prostorija smije pod root
    expect(findTreeProblems(await allLocs())).toEqual([]);
  });
  it('P2-LOC-ROOM-01: prostorija pod ormarom/prostorijom/kutijom je odbijena već u klijentu i NIŠTA se ne zapisuje', async () => {
    const before = (await allLocs()).length;
    for (const parent of ['garage-tool', 'kitchen', 'garage-box', 'pantry-shelf']) {
      await rejects(
        A.repo.createLocation({ name: 'Soba', parentId: parent, kind: 'room' }),
      ).toMatchObject({ code: 'room-parent' });
    }
    expect((await allLocs()).length).toBe(before);
  });
  it('validacija: prazan/predug naziv, house, nepoznata vrsta, nepostojeći roditelj', async () => {
    await rejects(
      A.repo.createLocation({ name: '   ', parentId: 'root', kind: 'shelf' }),
    ).toMatchObject({ code: 'invalid-input' });
    await rejects(
      A.repo.createLocation({ name: 'x'.repeat(121), parentId: 'root', kind: 'shelf' }),
    ).toMatchObject({ code: 'invalid-input' });
    await rejects(
      A.repo.createLocation({ name: 'Druga kuća', parentId: 'root', kind: 'house' }),
    ).toMatchObject({ code: 'invalid-input' });
    await rejects(
      A.repo.createLocation({ name: 'X', parentId: 'root', kind: 'svemirski' as never }),
    ).toMatchObject({ code: 'invalid-input' });
    await rejects(
      A.repo.createLocation({ name: 'X', parentId: 'ne-postoji', kind: 'shelf' }),
    ).toMatchObject({ code: 'bad-parent' });
  });
  it('arhivirani roditelj (admin) -> bad-parent', async () => {
    await (
      await admin()
    ).withSecurityRulesDisabled(async (c) => {
      const { updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(c.firestore(), `households/${H}/locations/pantry-shelf`), {
        archived: true,
      });
    });
    await rejects(
      A.repo.createLocation({ name: 'X', parentId: 'pantry-shelf', kind: 'box' }),
    ).toMatchObject({ code: 'bad-parent' });
  });
  it('preimenovanje s kontrolom verzije; zastarjela verzija -> changed-elsewhere; kind se ne mijenja', async () => {
    await A.repo.renameLocation('garage-box', 'Kutija novo', 1);
    expect(await docData('locations/garage-box')).toMatchObject({
      name: 'Kutija novo',
      version: 2,
      kind: 'box',
    });
    await rejects(B.repo.renameLocation('garage-box', 'Kasno', 1)).toMatchObject({
      code: 'changed-elsewhere',
    });
    await rejects(A.repo.renameLocation('nema-ga', 'x', 1)).toMatchObject({ code: 'not-found' });
  });
});

describe('predmeti: kreiranje, uređivanje, verzije', () => {
  it('stvara type i unique predmet s opcionalnim poljima; naziv + vrsta su jedino obavezni', async () => {
    const a = await A.repo.createItem({ name: 'Ljestve', kind: 'unique' });
    expect(await docData(`items/${a.id}`)).toMatchObject({
      name: 'Ljestve',
      kind: 'unique',
      aliases: [],
      category: null,
      note: null,
      version: 1,
      archived: false,
    });
    const b = await B.repo.createItem({
      name: 'Vijci',
      kind: 'type',
      aliases: [' vijak ', 'vijak', 'šraf', ''],
      category: ' Alat ',
      note: '   ',
    });
    expect(await docData(`items/${b.id}`)).toMatchObject({
      aliases: ['vijak', 'šraf'],
      category: 'Alat',
      note: null,
      createdBy: pb.uid,
    });
  });
  it('validacija ulaza', async () => {
    await rejects(A.repo.createItem({ name: '', kind: 'type' })).toMatchObject({
      code: 'invalid-input',
    });
    await rejects(A.repo.createItem({ name: 'X', kind: 'nešto' as never })).toMatchObject({
      code: 'invalid-input',
    });
    await rejects(
      A.repo.createItem({
        name: 'X',
        kind: 'type',
        aliases: Array.from({ length: 21 }, (_, i) => `a${i}`),
      }),
    ).toMatchObject({ code: 'invalid-input' });
    await rejects(
      A.repo.createItem({ name: 'X', kind: 'type', note: 'n'.repeat(1001) }),
    ).toMatchObject({ code: 'invalid-input' });
    await rejects(
      A.repo.createItem({ name: 'X', kind: 'type', category: 'c'.repeat(61) }),
    ).toMatchObject({ code: 'invalid-input' });
    await rejects(A.repo.updateItem('hammer', {}, 1)).toMatchObject({ code: 'invalid-input' });
  });
  it('uređivanje samo navedenih polja; ne dira smještaje; zastarjela verzija -> changed-elsewhere', async () => {
    const before = JSON.stringify(await docData('placements/pl-hammer-1'));
    await A.repo.updateItem('hammer', { name: 'Čekić 500 g', note: 'u garaži' }, 1);
    expect(await docData('items/hammer')).toMatchObject({
      name: 'Čekić 500 g',
      note: 'u garaži',
      version: 2,
      kind: 'unique',
    });
    expect(JSON.stringify(await docData('placements/pl-hammer-1'))).toBe(before);
    await rejects(B.repo.updateItem('hammer', { name: 'B' }, 1)).toMatchObject({
      code: 'changed-elsewhere',
    });
    await B.repo.updateItem('hammer', { name: 'B' }, 2);
    await rejects(A.repo.updateItem('nema', { name: 'B' }, 1)).toMatchObject({ code: 'not-found' });
  });
  it('arhiviranje predmeta nije dio P2 (D2): repozitorij nema takvu operaciju', () => {
    expect('archiveItem' in A.repo).toBe(false);
  });
});

describe('smještaji: više Placemenata istog Itema, duplikati, premještaj samo odabranog, arhiviranje', () => {
  it('type predmet na više lokacija; svaki je zaseban Placement s vlastitim ključem', async () => {
    const it1 = await A.repo.createItem({ name: 'Žarulje', kind: 'type' });
    const p1 = await A.repo.addPlacement(it1.id, 'hall-cabinet');
    const p2 = await B.repo.addPlacement(it1.id, 'bathroom-cabinet');
    const p3 = await A.repo.addPlacement(it1.id, 'garage-tool');
    expect(new Set([p1.id, p2.id, p3.id]).size).toBe(3);
    expect((await keyIds()).filter((k) => k.startsWith(`${it1.id}__`)).length).toBe(3);
  });
  it('duplikat (isti item, ista lokacija) -> duplicate-placement; unique na drugu lokaciju -> duplicate-placement', async () => {
    await rejects(A.repo.addPlacement('battery', 'living-drawer')).toMatchObject({
      code: 'duplicate-placement',
    });
    await rejects(A.repo.addPlacement('aku-drill', 'garage-box')).toMatchObject({
      code: 'duplicate-placement',
    });
  });
  it('nepostojeći/arhivirani predmet ili lokacija -> bad-item / bad-location', async () => {
    await rejects(A.repo.addPlacement('nema', 'garage-box')).toMatchObject({ code: 'bad-item' });
    await rejects(A.repo.addPlacement('battery', 'nema')).toMatchObject({ code: 'bad-location' });
  });
  it('scenarij 4: premještaj SAMO pl-battery-2; pl-battery-1 ostaje netaknut; ključevi se sele', async () => {
    const other = JSON.stringify(await docData('placements/pl-battery-1'));
    await A.repo.movePlacement('pl-battery-2', 'kitchen-drawer', 1);
    expect(await docData('placements/pl-battery-2')).toMatchObject({
      locationId: 'kitchen-drawer',
      version: 2,
    });
    expect(JSON.stringify(await docData('placements/pl-battery-1'))).toBe(other);
    const keys = await keyIds();
    expect(keys).toContain('battery__at__kitchen-drawer');
    expect(keys).not.toContain('battery__at__garage-box');
  });
  it('premještaj: ista lokacija -> same-location; odredište s istim predmetom -> duplicate-placement; zastarjela verzija -> changed-elsewhere', async () => {
    await rejects(A.repo.movePlacement('pl-battery-2', 'garage-box', 1)).toMatchObject({
      code: 'same-location',
    });
    await rejects(A.repo.movePlacement('pl-battery-2', 'living-drawer', 1)).toMatchObject({
      code: 'duplicate-placement',
    });
    await rejects(A.repo.movePlacement('pl-battery-2', 'hall-cabinet', 9)).toMatchObject({
      code: 'changed-elsewhere',
    });
    await rejects(A.repo.movePlacement('pl-battery-2', 'nema', 1)).toMatchObject({
      code: 'bad-location',
    });
  });
  it('unique predmet: premještaj ostaje jedan smještaj, ključ se ne mijenja', async () => {
    await A.repo.movePlacement('pl-aku-drill-1', 'bedroom-top', 1);
    expect((await keyIds()).filter((k) => k.startsWith('aku-drill'))).toEqual([
      'aku-drill__unique',
    ]);
  });
  it('arhiviranje smještaja oslobađa ključ pa se isti predmet može ponovno smjestiti; arhivirani se ne može premjestiti', async () => {
    await A.repo.archivePlacement('pl-aku-drill-1', 1);
    expect(await keyIds()).not.toContain('aku-drill__unique');
    await rejects(A.repo.movePlacement('pl-aku-drill-1', 'hall-cabinet', 2)).toMatchObject({
      code: 'not-found',
    });
    expect((await A.repo.addPlacement('aku-drill', 'hall-cabinet')).id).toBeTruthy();
  });
});

describe('premještanje cijele kutije (samo parentId) i prostorije', () => {
  it('scenarij 1: garage-box pod living-tv i natrag; Item/Placement reference netaknute; rev raste', async () => {
    const pl = JSON.stringify(await docData('placements/pl-battery-2'));
    await A.repo.moveLocation('garage-box', 'living-tv');
    expect(await docData('locations/garage-box')).toMatchObject({
      parentId: 'living-tv',
      version: 2,
    });
    await B.repo.moveLocation('garage-box', 'garage-shelf');
    expect(JSON.stringify(await docData('placements/pl-battery-2'))).toBe(pl);
    expect(await treeRev()).toBe(2);
  });
  it('scenarij 2: garage-rack pod garage-box (potomak) -> cycle; sam u sebe -> cycle; ništa se ne zapisuje', async () => {
    await rejects(A.repo.moveLocation('garage-rack', 'garage-box')).toMatchObject({
      code: 'cycle',
    });
    await rejects(A.repo.moveLocation('garage-rack', 'garage-rack')).toMatchObject({
      code: 'cycle',
    });
    expect(await treeRev()).toBe(0);
  });
  it('P2-LOC-ROOM-01: prostorija se ne premješta; root se ne premješta; isti roditelj -> same-parent', async () => {
    await rejects(A.repo.moveLocation('kitchen', 'living')).toMatchObject({
      code: 'room-immovable',
    });
    await rejects(A.repo.moveLocation('root', 'kitchen')).toMatchObject({ code: 'room-immovable' });
    await rejects(A.repo.moveLocation('garage-box', 'garage-shelf')).toMatchObject({
      code: 'same-parent',
    });
    expect(await treeRev()).toBe(0);
  });
  it('kontrola verzije pri premještaju lokacije', async () => {
    await B.repo.renameLocation('garage-box', 'Preimenovano', 1);
    await rejects(A.repo.moveLocation('garage-box', 'living-tv', 1)).toMatchObject({
      code: 'changed-elsewhere',
    });
    await A.repo.moveLocation('garage-box', 'living-tv', 2);
  });
  it('nepostojeće odredište -> bad-parent', async () => {
    await rejects(A.repo.moveLocation('garage-box', 'nema')).toMatchObject({ code: 'bad-parent' });
  });
});

describe('D1: duboke hijerarhije 7 / 10 / 20 (puni lanac predaka u transakciji)', () => {
  beforeEach(async () => seedChains(24));
  for (const d of [7, 10, 20]) {
    it(`dubina ${d}: ciklus odbijen prije pisanja; legitimno premještaj ispod čvora te dubine uspijeva; stablo zdravo`, async () => {
      await rejects(A.repo.moveLocation('c0', `c${d}`)).toMatchObject({ code: 'cycle' });
      expect(await treeRev()).toBe(0);
      await A.repo.moveLocation('garage-box', `c${d}`);
      expect(await treeRev()).toBe(1);
      expect(findTreeProblems(await allLocs())).toEqual([]);
    });
  }
  it('istodobno c10 pod e23 (A) i e10 pod c23 (B): zajedno bi bio ciklus — točno jedno uspije, stablo zdravo, rev == 1', async () => {
    const wait = barrier(2);
    A.hooks.afterReads = wait;
    B.hooks.afterReads = wait;
    const [ra, rb] = await Promise.all([
      outcome(A.repo.moveLocation('c10', 'e23')),
      outcome(B.repo.moveLocation('e10', 'c23')),
    ]);
    expect([ra, rb].filter((r) => r === 'OK')).toHaveLength(1);
    expect([ra, rb].filter((r) => r === 'ERR:cycle')).toHaveLength(1);
    expect(findTreeProblems(await allLocs())).toEqual([]);
    expect(await treeRev()).toBe(1);
  });
  it('nepovezana istodobna duboka premještanja: oba uspiju (CAS + ponavljanje protokola), rev == 2', async () => {
    const wait = barrier(2);
    A.hooks.afterReads = wait;
    B.hooks.afterReads = wait;
    const [ra, rb] = await Promise.all([
      outcome(A.repo.moveLocation('garage-box', 'c20')),
      outcome(B.repo.moveLocation('pantry-box', 'e20')),
    ]);
    expect([ra, rb]).toEqual(['OK', 'OK']);
    expect(await treeRev()).toBe(2);
    expect(findTreeProblems(await allLocs())).toEqual([]);
  });
});

describe('istodobne izmjene dvaju korisnika (prave transakcije, prisilno preklapanje)', () => {
  it('MD-16 isti predmet iz iste verzije: jedan uspije, drugi changed-elsewhere, pobjednik ostaje', async () => {
    const wait = barrier(2);
    A.hooks.afterReads = wait;
    B.hooks.afterReads = wait;
    const [ra, rb] = await Promise.all([
      outcome(A.repo.updateItem('hammer', { name: 'A' }, 1)),
      outcome(B.repo.updateItem('hammer', { name: 'B' }, 1)),
    ]);
    expect([ra, rb].filter((r) => r === 'OK')).toHaveLength(1);
    expect([ra, rb]).toContain('ERR:changed-elsewhere');
    const it = (await docData('items/hammer'))!;
    expect(it.version).toBe(2);
    expect(it.updatedBy).toBe(it.name === 'A' ? pa.uid : pb.uid);
  });
  it('MD-17 različiti predmeti istodobno: oba uspiju', async () => {
    const wait = barrier(2);
    A.hooks.afterReads = wait;
    B.hooks.afterReads = wait;
    const [ra, rb] = await Promise.all([
      outcome(A.repo.updateItem('hammer', { name: 'X' }, 1)),
      outcome(B.repo.updateItem('hex-keys', { name: 'Y' }, 1)),
    ]);
    expect([ra, rb]).toEqual(['OK', 'OK']);
  });
  it('MD-11 isti item na istu lokaciju istodobno: točno jedan aktivan smještaj', async () => {
    const it1 = await A.repo.createItem({ name: 'Traka', kind: 'type' });
    const wait = barrier(2);
    A.hooks.afterReads = wait;
    B.hooks.afterReads = wait;
    const [ra, rb] = await Promise.all([
      outcome(A.repo.addPlacement(it1.id, 'hall-cabinet')),
      outcome(B.repo.addPlacement(it1.id, 'hall-cabinet')),
    ]);
    expect([ra, rb].filter((r) => r === 'OK')).toHaveLength(1);
    expect([ra, rb]).toContain('ERR:duplicate-placement');
    expect((await keyIds()).filter((k) => k === `${it1.id}__at__hall-cabinet`)).toHaveLength(1);
  });
  it('MD-10 novi unique predmet istodobno na dvije lokacije: točno jedan', async () => {
    const it1 = await A.repo.createItem({ name: 'Ljestve 2', kind: 'unique' });
    const wait = barrier(2);
    A.hooks.afterReads = wait;
    B.hooks.afterReads = wait;
    const [ra, rb] = await Promise.all([
      outcome(A.repo.addPlacement(it1.id, 'garage-tool')),
      outcome(B.repo.addPlacement(it1.id, 'hall-cabinet')),
    ]);
    expect([ra, rb].filter((r) => r === 'OK')).toHaveLength(1);
  });
  it('isti smještaj premješten istodobno na dvije lokacije: jedan uspije, drugi changed-elsewhere', async () => {
    const wait = barrier(2);
    A.hooks.afterReads = wait;
    B.hooks.afterReads = wait;
    const [ra, rb] = await Promise.all([
      outcome(A.repo.movePlacement('pl-battery-2', 'kitchen-drawer', 1)),
      outcome(B.repo.movePlacement('pl-battery-2', 'hall-cabinet', 1)),
    ]);
    expect([ra, rb].filter((r) => r === 'OK')).toHaveLength(1);
    expect([ra, rb]).toContain('ERR:changed-elsewhere');
  });
});

describe('D5: opoziv članstva usred operacije ≠ konflikt', () => {
  const ops: [string, (l: Live) => Promise<unknown>][] = [
    [
      'createLocation',
      (l) => l.repo.createLocation({ name: 'x', parentId: 'garage-tool', kind: 'shelf' }),
    ],
    ['renameLocation', (l) => l.repo.renameLocation('garage-box', 'x', 1)],
    ['moveLocation', (l) => l.repo.moveLocation('garage-box', 'living-tv')],
    ['createItem', (l) => l.repo.createItem({ name: 'x', kind: 'type' })],
    ['updateItem', (l) => l.repo.updateItem('hammer', { name: 'x' }, 1)],
    ['addPlacement', (l) => l.repo.addPlacement('battery', 'hall-cabinet')],
    ['movePlacement', (l) => l.repo.movePlacement('pl-battery-2', 'hall-cabinet', 1)],
    ['archivePlacement', (l) => l.repo.archivePlacement('pl-battery-2', 1)],
  ];
  for (const [name, run] of ops) {
    it(`${name}: opozvan prije operacije => access-revoked`, async () => {
      await setEnabled(pa.uid, false);
      await rejects(run(A)).toMatchObject({ code: 'access-revoked' });
    });
  }
  it('opoziv usred transakcije (nakon čitanja, prije commita) => access-revoked, ništa se ne zapisuje', async () => {
    A.hooks.afterReads = async () => setEnabled(pa.uid, false);
    await rejects(A.repo.updateItem('hammer', { name: 'Kasno' }, 1)).toMatchObject({
      code: 'access-revoked',
    });
    expect((await docData('items/hammer'))!.name).toBe('Čekić');
    A.hooks.afterReads = async () => setEnabled(pa.uid, false);
    await rejects(A.repo.moveLocation('garage-box', 'living-tv')).toMatchObject({
      code: 'access-revoked',
    });
    expect((await docData('locations/garage-box'))!.parentId).toBe('garage-shelf');
  });
  it('opoziv ima prednost pred zastarjelom verzijom', async () => {
    await B.repo.updateItem('hammer', { name: 'B prvi' }, 1);
    await setEnabled(pa.uid, false);
    await rejects(A.repo.updateItem('hammer', { name: 'A kasni' }, 1)).toMatchObject({
      code: 'access-revoked',
    });
  });
  it('aktivni član i dalje dobiva sukob kao sukob (ne kao opoziv)', async () => {
    await B.repo.updateItem('hammer', { name: 'B prvi' }, 1);
    await rejects(A.repo.updateItem('hammer', { name: 'A kasni' }, 1)).toMatchObject({
      code: 'changed-elsewhere',
    });
  });
  it('DomainError je pravi razred', async () => {
    await setEnabled(pa.uid, false);
    await expect(A.repo.createItem({ name: 'x', kind: 'type' })).rejects.toBeInstanceOf(
      DomainError,
    );
  });
});
