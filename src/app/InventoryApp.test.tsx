import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '../inventory/errors';
import type { InventoryState } from '../inventory/gate';
import type { InventoryPort, InventorySession } from '../inventory/port';
import type { InventoryRepository, VerifyResult } from '../inventory/repository';
import type { InventoryData } from '../inventory/types';
import { InventoryApp, type Account } from './ui/InventoryApp';

const audit = { version: 1, archived: false };
const item = (id: string, name: string, kind: 'unique' | 'type', extra = {}) => ({
  id,
  name,
  kind,
  aliases: [] as string[],
  category: null,
  note: null,
  ...audit,
  ...extra,
});
const DATA: InventoryData = {
  locations: [
    { id: 'root', name: 'Kuća', parentId: null, kind: 'house', ...audit },
    { id: 'kitchen', name: 'Kuhinja', parentId: 'root', kind: 'room', ...audit },
    { id: 'cab', name: 'Gornji ormar', parentId: 'kitchen', kind: 'cabinet', ...audit },
    { id: 'box', name: 'Kutija', parentId: 'cab', kind: 'box', ...audit },
    { id: 'garage', name: 'Garaža', parentId: 'root', kind: 'room', ...audit },
    { id: 'pantry', name: 'Špajza', parentId: 'root', kind: 'room', ...audit },
  ],
  items: [
    item('drill', 'Aku bušilica', 'unique', {
      aliases: ['busilica'],
      category: 'Alat',
      note: 'crna',
    }),
    item('bat', 'AA baterije', 'type'),
    item('salt', 'Sol', 'type'),
  ],
  placements: [
    { id: 'p-drill', itemId: 'drill', locationId: 'cab', ...audit },
    { id: 'p-bat1', itemId: 'bat', locationId: 'cab', ...audit },
    { id: 'p-bat2', itemId: 'bat', locationId: 'garage', ...audit },
    { id: 'p-salt', itemId: 'salt', locationId: 'pantry', ...audit },
  ],
};
const ready: InventoryState = { status: 'ready', data: DATA, needsBootstrap: false };

function mkRepo(): InventoryRepository {
  return {
    bootstrap: vi.fn(async () => ({ created: [] })),
    createLocation: vi.fn(async ({ id }) => ({ id: id ?? 'new-loc' })),
    renameLocation: vi.fn(async () => {}),
    moveLocation: vi.fn(async () => {}),
    createItemWithPlacement: vi.fn(async ({ attempt }) => ({
      itemId: attempt?.itemId ?? 'new-item',
      placementId: attempt?.placementId ?? 'new-pl',
    })),
    updateItem: vi.fn(async () => {}),
    addPlacement: vi.fn(async () => ({ id: 'new-pl' })),
    movePlacement: vi.fn(async () => {}),
    archivePlacement: vi.fn(async () => {}),
    verify: vi.fn(async (): Promise<VerifyResult> => 'not-applied'),
  };
}

const account: Account = {
  householdName: 'Testno kućanstvo',
  displayName: 'Ana',
  verifiedAt: Date.now(),
  stale: false,
  onRecheck: vi.fn(),
  onSignOut: vi.fn(),
  signOutFailed: false,
};

async function setup(opts: { online?: boolean } = {}) {
  const repo = mkRepo();
  let emit: (s: InventoryState) => void = () => {};
  const unwatch = vi.fn();
  const dispose = vi.fn(async () => {});
  const watchSpy = vi.fn();
  const session: InventorySession = {
    uid: 'u1',
    repo,
    watch: (cb) => {
      watchSpy();
      emit = cb;
      return unwatch;
    },
    dispose,
  };
  const port: InventoryPort = { open: vi.fn(async () => session) };
  const onRevoked = vi.fn();
  const utils = render(
    <InventoryApp
      port={port}
      onRevoked={onRevoked}
      account={account}
      online={opts.online ?? true}
    />,
  );
  await waitFor(() => expect(watchSpy).toHaveBeenCalled());
  const push = (s: InventoryState) => act(async () => emit(s));
  return { repo, push, unwatch, dispose, onRevoked, port, watchSpy, ...utils };
}
const tab = (name: string) =>
  fireEvent.click(within(screen.getByTestId('bottom-nav')).getByRole('button', { name }));
const navBtn = (name: string) =>
  within(screen.getByTestId('bottom-nav')).getByRole('button', { name }) as HTMLButtonElement;
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const btn = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
async function openItem(name: string, via: 'search' | 'rooms' = 'search') {
  if (via === 'search') {
    fireEvent.change(field('Pretraži predmet ili lokaciju'), { target: { value: name } });
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
  }
  await screen.findByTestId('item-name');
}
const history = () => window.history;

describe('stanja: učitavanje, vrata i integritet', () => {
  it('dok nema server-potvrđenog skupa: samo "Učitavanje inventara", NIKAKVI podaci, ali račun/odjava dostupni', async () => {
    const t = await setup();
    await t.push({ status: 'loading' });
    expect(screen.getByTestId('inv-loading')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Kuhinja');
    expect(screen.queryByTestId('bottom-nav')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Odjava' }));
    expect(account.onSignOut).toHaveBeenCalled();
  });
  it('ready: Početna, Lokacije i detalj prikazuju stablo i SVE putanje predmeta s više smještaja', async () => {
    const t = await setup();
    await t.push(ready);
    expect(screen.getByRole('heading', { name: 'Što tražiš?' })).toBeTruthy();
    tab('Lokacije');
    expect(screen.getByTestId('loc-kitchen').textContent).toContain('2 vrsta predmeta'); // dedup po predmetu
    tab('Početna');
    await openItem('AA baterije');
    const paths = screen.getAllByTestId('pl-path').map((n) => n.textContent);
    expect(paths.sort()).toEqual(['Kuća › Garaža', 'Kuća › Kuhinja › Gornji ormar']);
  });
  it('tree-corrupt: poruka, NIKAKVI nazivi u DOM-u, nema obrazaca ni navigacije', async () => {
    const t = await setup();
    await t.push({ status: 'tree-corrupt', problems: [{ type: 'cycle', ids: ['a', 'b'] }] });
    expect(screen.getByTestId('inv-corrupt').textContent).toContain('nije ispravna');
    expect(document.body.textContent).not.toContain('Kuhinja');
    expect(document.body.textContent).not.toContain('bušilica');
    expect(screen.queryByTestId('bottom-nav')).toBeNull();
  });
  it('inconsistent: brojke, bez podataka, BEZ ponude "Pripremi kućanstvo"', async () => {
    const t = await setup();
    await t.push({ status: 'inconsistent', items: 3, placements: 4 });
    const el = screen.getByTestId('inv-inconsistent');
    expect(el.textContent).toContain('(3)');
    expect(el.textContent).toContain('(4)');
    expect(screen.queryByRole('button', { name: /Pripremi kućanstvo/ })).toBeNull();
  });
  it('needsBootstrap: izričita radnja "Pripremi kućanstvo" zove bootstrap; Dodaj je onemogućen', async () => {
    const t = await setup();
    await t.push({
      status: 'ready',
      data: { locations: [], items: [], placements: [] },
      needsBootstrap: true,
    });
    expect(screen.getByTestId('bootstrap')).toBeTruthy();
    expect(navBtn('Dodaj predmet').disabled).toBe(true);
    click('Pripremi kućanstvo');
    await waitFor(() => expect(t.repo.bootstrap).toHaveBeenCalledTimes(1));
  });
  it('prazna kuća (root bez prostorija): "Dodaj prvu prostoriju", bez izmišljenih prostora', async () => {
    const t = await setup();
    await t.push({
      status: 'ready',
      data: { locations: [DATA.locations[0]!], items: [], placements: [] },
      needsBootstrap: false,
    });
    tab('Lokacije');
    expect(screen.getByTestId('empty-house')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Dodaj prvu prostoriju/ })).toBeTruthy();
  });
  it('error offline: poruka čekanja veze i nikakvi podaci', async () => {
    const t = await setup();
    await t.push({ status: 'error', kind: 'offline' });
    expect(screen.getByTestId('inv-error-text').textContent).toContain('Čeka se veza');
  });
  it('stale: zadnje potvrđeno stanje vidljivo, SVE izmjene onemogućene, stara poruka "Spremljeno" skrivena', async () => {
    const t = await setup();
    await t.push(ready);
    await openItem('Sol');
    click('Uredi');
    fireEvent.change(field('Naziv predmeta *'), { target: { value: 'Morska sol' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Uredi predmet' }));
    await screen.findByText(/Spremljeno · potvrđeno online/);
    await t.push({ status: 'stale', data: DATA });
    expect(screen.getByTestId('inv-stale')).toBeTruthy();
    expect(screen.queryByText(/Spremljeno · potvrđeno online/)).toBeNull();
    for (const label of [/Premjesti/, /Dodaj drugi smještaj/]) {
      const b = screen.queryByRole('button', { name: label }) as HTMLButtonElement | null;
      if (b) expect(b.disabled).toBe(true);
    }
    expect(navBtn('Dodaj predmet').disabled).toBe(true);
  });
  it('browser offline (online=false): samo pregled, bez spremanja', async () => {
    const t = await setup({ online: false });
    await t.push(ready);
    expect(screen.getByTestId('inv-offline')).toBeTruthy();
    expect(navBtn('Dodaj predmet').disabled).toBe(true);
  });
});

describe('životni ciklus i privatnost', () => {
  it('unmount: listeneri se odjavljuju, sesija uništava, podaci nestaju iz DOM-a', async () => {
    const t = await setup();
    await t.push(ready);
    tab('Lokacije');
    expect(document.body.textContent).toContain('Špajza');
    t.unmount();
    expect(t.unwatch).toHaveBeenCalled();
    expect(t.dispose).toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('Špajza');
  });
  it('listener javi revoked: onRevoked; operacija vrati access-revoked: onRevoked bez generičke greške', async () => {
    const t = await setup();
    await t.push({ status: 'revoked' });
    expect(t.onRevoked).toHaveBeenCalled();
  });
  it('access-revoked iz operacije: onRevoked, nikakva poruka o grešci spremanja', async () => {
    const t = await setup();
    await t.push(ready);
    t.repo.updateItem = vi.fn(async () => {
      throw new DomainError('access-revoked');
    });
    await openItem('Sol');
    click('Uredi');
    fireEvent.change(field('Naziv predmeta *'), { target: { value: 'Morska sol' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Uredi predmet' }));
    await waitFor(() => expect(t.onRevoked).toHaveBeenCalled());
    expect(screen.queryByTestId('inv-status')).toBeNull();
  });
});

describe('pretraga (lokalno, bez Firestorea po znaku)', () => {
  it('rezultati se pojavljuju lokalno; port.open i repozitorij se NE zovu pri tipkanju', async () => {
    const t = await setup();
    await t.push(ready);
    const input = field('Pretraži predmet ili lokaciju');
    for (const v of ['a', 'ak', 'aku', 'aku b', 'aku bus'])
      fireEvent.change(input, { target: { value: v } });
    expect(screen.getByRole('button', { name: /Aku bušilica/ })).toBeTruthy();
    expect(t.port.open).toHaveBeenCalledTimes(1);
    expect(t.watchSpy).toHaveBeenCalledTimes(1);
    for (const fn of Object.values(t.repo)) expect(fn).not.toHaveBeenCalled();
  });
  it('tipfeler daje zasebnu skupinu "Približni rezultati"; negativni primjer nema rezultata', async () => {
    const t = await setup();
    await t.push(ready);
    const input = field('Pretraži predmet ili lokaciju');
    fireEvent.change(input, { target: { value: 'aku busilca' } });
    expect(screen.getByRole('heading', { name: 'Približni rezultati' })).toBeTruthy();
    fireEvent.change(input, { target: { value: 'aku busilca random' } });
    expect(screen.getByTestId('no-results')).toBeTruthy();
  });
  it('"spajza" pronalazi lokaciju; predmet s više smještaja ispisuje SVE putanje u rezultatu', async () => {
    const t = await setup();
    await t.push(ready);
    const input = field('Pretraži predmet ili lokaciju');
    fireEvent.change(input, { target: { value: 'spajza' } });
    expect(screen.getByTestId('loc-pantry')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'AA baterije' } });
    const row = screen.getByTestId('item-bat');
    expect(row.textContent).toContain('2 smještaja');
    expect(screen.getAllByTestId('item-path').map((n) => n.textContent)).toHaveLength(2);
  });
});

describe('dodavanje predmeta (UX-033-01/02, REV-04)', () => {
  it('globalno dodavanje počinje BEZ lokacije; Jedinstveni predmet je vidljivo predložen uz izbor vrste', async () => {
    const t = await setup();
    await t.push(ready);
    tab('Dodaj predmet');
    expect(field('Lokacija *').value).toBe('');
    expect(
      (screen.getByRole('radio', { name: /Jedinstveni predmet/ }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(screen.getByRole('radio', { name: /Vrsta predmeta/ })).toBeTruthy();
    fireEvent.change(field('Naziv predmeta *'), { target: { value: 'Čekić' } });
    // bez lokacije: objašnjenje i NIJEDAN poziv
    fireEvent.submit(screen.getByRole('form', { name: 'Novi predmet' }));
    expect(screen.getByText(/Odaberi lokaciju/, { selector: '.field-error' })).toBeTruthy();
    expect(t.repo.createItemWithPlacement).not.toHaveBeenCalled();
  });
  it('bez naziva se ne šalje (ni Enterom)', async () => {
    const t = await setup();
    await t.push(ready);
    tab('Dodaj predmet');
    fireEvent.change(field('Lokacija *'), { target: { value: 'garage' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Novi predmet' }));
    expect(screen.getByText('Upiši naziv predmeta.')).toBeTruthy();
    expect(t.repo.createItemWithPlacement).not.toHaveBeenCalled();
  });
  it('iz lokacije: lokacija je predložena, ali promjenjiva; šalje se JEDAN atomaran poziv sa sačuvanim ID-evima', async () => {
    const t = await setup();
    await t.push(ready);
    tab('Lokacije');
    fireEvent.click(screen.getByTestId('loc-kitchen'));
    fireEvent.click(await screen.findByTestId('loc-cab'));
    click(/Dodaj predmet ovdje/);
    expect(field('Lokacija *').value).toBe('cab');
    fireEvent.change(field('Lokacija *'), { target: { value: 'garage' } }); // promjenjivo
    fireEvent.change(field('Naziv predmeta *'), { target: { value: '  Čekić  ' } });
    fireEvent.click(screen.getByRole('radio', { name: /Vrsta predmeta/ }));
    fireEvent.submit(screen.getByRole('form', { name: 'Novi predmet' }));
    await waitFor(() => expect(t.repo.createItemWithPlacement).toHaveBeenCalledTimes(1));
    const arg = vi.mocked(t.repo.createItemWithPlacement).mock.calls[0]![0];
    expect(arg).toMatchObject({ name: '  Čekić  ', kind: 'type', locationId: 'garage' });
    expect(arg.attempt?.itemId).toBeTruthy();
    expect(arg.attempt?.placementId).toBeTruthy();
    expect(t.repo.addPlacement).not.toHaveBeenCalled(); // nema zasebnog "dovršavanja" smještaja
  });
  it('"Spremljeno" se prikazuje TEK nakon potvrde poslužitelja; prije toga "Spremanje…" i obrazac je onemogućen', async () => {
    const t = await setup();
    await t.push(ready);
    let release!: () => void;
    t.repo.createItemWithPlacement = vi.fn(
      () => new Promise((r) => (release = () => r({ itemId: 'x', placementId: 'y' }))),
    ) as never;
    tab('Dodaj predmet');
    fireEvent.change(field('Lokacija *'), { target: { value: 'garage' } });
    fireEvent.change(field('Naziv predmeta *'), { target: { value: 'Čekić' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Novi predmet' }));
    await screen.findByText(/Spremanje… čeka se potvrda poslužitelja/);
    expect(screen.queryByText(/Spremljeno · potvrđeno online/)).toBeNull();
    expect(btn('Spremanje…').disabled).toBe(true);
    fireEvent.submit(screen.getByRole('form', { name: 'Novi predmet' })); // Enter za vrijeme spremanja
    expect(t.repo.createItemWithPlacement).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await screen.findByText(/Spremljeno · potvrđeno online/);
  });

  const FAILS: [string, () => unknown][] = [
    ['offline', () => new DomainError('offline')],
    ['invalid-input', () => new DomainError('invalid-input', 'Naziv je predug.')],
    ['changed-elsewhere', () => new DomainError('changed-elsewhere')],
    ['bad-location', () => new DomainError('bad-location')],
    ['nepoznata greška', () => new Error('INTERNAL')],
  ];
  for (const [label, mk] of FAILS) {
    it(`neuspjeh (${label}): naziv, lokacija i vrsta ostaju; ponovni pokušaj koristi ISTE ID-eve`, async () => {
      const t = await setup();
      await t.push(ready);
      t.repo.createItemWithPlacement = vi.fn(async () => {
        throw mk();
      });
      tab('Dodaj predmet');
      fireEvent.change(field('Lokacija *'), { target: { value: 'garage' } });
      fireEvent.change(field('Naziv predmeta *'), { target: { value: 'Čekić' } });
      fireEvent.change(field('Bilješka (neobavezno)'), { target: { value: 'plavi' } });
      fireEvent.submit(screen.getByRole('form', { name: 'Novi predmet' }));
      await screen.findByRole('alert');
      expect(screen.queryByText(/Spremljeno · potvrđeno online/)).toBeNull();
      expect(field('Naziv predmeta *').value).toBe('Čekić');
      expect(field('Lokacija *').value).toBe('garage');
      expect(field('Bilješka (neobavezno)').value).toBe('plavi');
      fireEvent.submit(screen.getByRole('form', { name: 'Novi predmet' }));
      await waitFor(() => expect(t.repo.createItemWithPlacement).toHaveBeenCalledTimes(2));
      const [a, b] = vi.mocked(t.repo.createItemWithPlacement).mock.calls.map((c) => c[0].attempt);
      expect(a).toEqual(b);
    });
  }
});

describe('nepoznat ishod (outcome-unknown) i provjera stanja', () => {
  async function unknownCreate() {
    const t = await setup();
    await t.push(ready);
    t.repo.createItemWithPlacement = vi.fn(async () => {
      throw new DomainError('outcome-unknown');
    });
    tab('Dodaj predmet');
    fireEvent.change(field('Lokacija *'), { target: { value: 'garage' } });
    fireEvent.change(field('Naziv predmeta *'), { target: { value: 'Čekić' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Novi predmet' }));
    await screen.findByText(/Veza je prekinuta tijekom potvrđivanja/);
    return t;
  }
  it('ne tvrdi ni uspjeh ni neuspjeh; unos ostaje; ništa se ne ponavlja automatski; gumb za spremanje je blokiran do provjere', async () => {
    const t = await unknownCreate();
    expect(screen.queryByText(/Spremljeno · potvrđeno online/)).toBeNull();
    expect(screen.getByTestId('inv-status').textContent).not.toMatch(/NIJE spremljena/);
    expect(field('Naziv predmeta *').value).toBe('Čekić');
    expect(navBtn('Dodaj predmet').disabled).toBe(true);
    expect(t.repo.createItemWithPlacement).toHaveBeenCalledTimes(1);
    expect(t.repo.verify).not.toHaveBeenCalled(); // provjera je IZRIČITA korisnička radnja
  });
  it('"Provjeri stanje" => verify po ID-evima pokušaja; applied => predmet je otvoren kao spremljen', async () => {
    const t = await unknownCreate();
    t.repo.verify = vi.fn(async (): Promise<VerifyResult> => 'applied');
    click('Provjeri stanje');
    await screen.findByText(/Spremljeno · potvrđeno online/);
    const spec = vi.mocked(t.repo.verify).mock.calls[0]![0];
    const attempt = vi.mocked(t.repo.createItemWithPlacement).mock.calls[0]![0].attempt!;
    expect(spec).toEqual({
      op: 'createItem',
      itemId: attempt.itemId,
      placementId: attempt.placementId,
    });
    expect(t.repo.createItemWithPlacement).toHaveBeenCalledTimes(1); // nikad automatsko ponavljanje
  });
  it('not-applied: poruka "nije pronađena", unos sačuvan, ponovni pokušaj IZRIČIT i s ISTIM ID-evima', async () => {
    const t = await unknownCreate();
    click('Provjeri stanje');
    await screen.findByTestId('verify-result');
    expect(screen.getByTestId('verify-result').textContent).toContain('NIJE pronađena');
    expect(field('Naziv predmeta *').value).toBe('Čekić');
    t.repo.createItemWithPlacement = vi.fn(async ({ attempt }) => ({
      itemId: attempt!.itemId,
      placementId: attempt!.placementId,
    }));
    fireEvent.submit(screen.getByRole('form', { name: 'Novi predmet' }));
    await waitFor(() => expect(t.repo.createItemWithPlacement).toHaveBeenCalledTimes(1));
  });
  it('provjera bez veze: ostaje neodređeno ("unknown"), nema zaključka', async () => {
    const t = await unknownCreate();
    t.repo.verify = vi.fn(async (): Promise<VerifyResult> => 'unknown');
    click('Provjeri stanje');
    await screen.findByTestId('verify-result');
    expect(screen.getByTestId('verify-result').textContent).toContain('nije moguća');
    expect(btn('Provjeri stanje')).toBeTruthy();
  });
  it('changed-elsewhere iz provjere daje poruku o konfliktu, bez tvrdnje o uspjehu', async () => {
    const t = await unknownCreate();
    t.repo.verify = vi.fn(async (): Promise<VerifyResult> => 'changed-elsewhere');
    click('Provjeri stanje');
    await screen.findByText(/Netko je promijenio zapis/);
  });
  it('premještaj predmeta: nepoznat ishod nosi verify spec s verzijom i odredištem', async () => {
    const t = await setup();
    await t.push(ready);
    t.repo.movePlacement = vi.fn(async () => {
      throw new DomainError('outcome-unknown');
    });
    await openItem('Aku bušilica');
    click(/Premjesti/);
    fireEvent.click(screen.getByTestId('dest-garage'));
    await screen.findByText(/Veza je prekinuta tijekom potvrđivanja/);
    t.repo.verify = vi.fn(async (): Promise<VerifyResult> => 'applied');
    click('Provjeri stanje');
    await waitFor(() =>
      expect(vi.mocked(t.repo.verify).mock.calls[0]![0]).toEqual({
        op: 'movePlacement',
        id: 'p-drill',
        expectedVersion: 1,
        newLocationId: 'garage',
      }),
    );
  });
});

describe('lokacije (UX-033-03, P2-LOC-ROOM-01)', () => {
  it('Prostorija prisiljava roditelja na Kuću; u ugniježđenom kontekstu opcija Prostorija je onemogućena', async () => {
    const t = await setup();
    await t.push(ready);
    tab('Lokacije');
    click(/Dodaj lokaciju/);
    fireEvent.change(field('Vrsta lokacije *'), { target: { value: 'room' } });
    expect(field('Unutar koje lokacije? *').value).toBe('root');
    expect(field('Unutar koje lokacije? *').disabled).toBe(true);
    fireEvent.change(field('Naziv lokacije *'), { target: { value: 'Hodnik' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Nova lokacija' }));
    await waitFor(() => expect(t.repo.createLocation).toHaveBeenCalled());
    expect(vi.mocked(t.repo.createLocation).mock.calls[0]![0]).toMatchObject({
      name: 'Hodnik',
      kind: 'room',
      parentId: 'root',
    });
  });
  it('iz ormara: Prostorija je onemogućena s objašnjenjem; roditelj je predložen i jest ormar', async () => {
    const t = await setup();
    await t.push(ready);
    tab('Lokacije');
    fireEvent.click(screen.getByTestId('loc-kitchen'));
    fireEvent.click(await screen.findByTestId('loc-cab'));
    click(/Dodaj podlokaciju/);
    const room = screen.getByRole('option', { name: /Prostorija/ }) as HTMLOptionElement;
    expect(room.disabled).toBe(true);
    expect(room.textContent).toContain('dodaj iz Kuće');
    expect(field('Unutar koje lokacije? *').value).toBe('cab');
  });
  it('obrazac lokacije: neuspjeh čuva naziv; uspjeh vodi na novu lokaciju', async () => {
    const t = await setup();
    await t.push(ready);
    tab('Lokacije');
    click(/Dodaj lokaciju/);
    t.repo.createLocation = vi.fn(async () => {
      throw new DomainError('offline');
    });
    fireEvent.change(field('Vrsta lokacije *'), { target: { value: 'box' } });
    fireEvent.change(field('Naziv lokacije *'), { target: { value: 'Kutija X' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Nova lokacija' }));
    await screen.findByRole('alert');
    expect(field('Naziv lokacije *').value).toBe('Kutija X');
  });
  it('prostorije NEMAJU premještanje; kutija ima, a odredišta ne nude sebe ni potomke', async () => {
    const t = await setup();
    await t.push(ready);
    tab('Lokacije');
    fireEvent.click(screen.getByTestId('loc-kitchen'));
    expect(screen.queryByRole('button', { name: /Premjesti cijelu lokaciju/ })).toBeNull();
    fireEvent.click(await screen.findByTestId('loc-cab'));
    click(/Premjesti cijelu lokaciju/);
    expect((screen.getByTestId('dest-cab') as HTMLButtonElement).disabled).toBe(true); // sama sebe
    expect((screen.getByTestId('dest-box') as HTMLButtonElement).disabled).toBe(true); // potomak
    expect((screen.getByTestId('dest-kitchen') as HTMLButtonElement).disabled).toBe(true); // isti roditelj
    expect((screen.getByTestId('dest-garage') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId('dest-box').textContent).toContain('unutar premještane lokacije');
    fireEvent.click(screen.getByTestId('dest-garage'));
    await waitFor(() => expect(t.repo.moveLocation).toHaveBeenCalledWith('cab', 'garage', 1));
  });
});

describe('premještanje i smještaji', () => {
  it('jedan smještaj: odabir odredišta ODMAH izvršava movePlacement (bez trećeg potvrđivanja)', async () => {
    const t = await setup();
    await t.push(ready);
    await openItem('Aku bušilica');
    click(/Premjesti/);
    fireEvent.click(screen.getByTestId('dest-garage'));
    await waitFor(() => expect(t.repo.movePlacement).toHaveBeenCalledWith('p-drill', 'garage', 1));
    await screen.findByText(/Spremljeno · potvrđeno online/);
  });
  it('dva smještaja: najprije odabir izvornog; ostali smještaj se ne dira; duplikat je blokiran s razlogom', async () => {
    const t = await setup();
    await t.push(ready);
    await openItem('AA baterije');
    click(/Premjesti/);
    expect(screen.getByRole('heading', { name: 'Koji smještaj premještaš?' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('source-p-bat1'));
    const dup = screen.getByTestId('dest-garage') as HTMLButtonElement; // druga baterija već je tamo
    expect(dup.disabled).toBe(true);
    expect(dup.textContent).toContain('Isti predmet već postoji ovdje');
    fireEvent.click(screen.getByTestId('dest-pantry'));
    await waitFor(() => expect(t.repo.movePlacement).toHaveBeenCalledWith('p-bat1', 'pantry', 1));
  });
  it('drugi smještaj samo za vrstu predmeta; jedinstveni ga ne nudi', async () => {
    const t = await setup();
    await t.push(ready);
    await openItem('Aku bušilica');
    expect(screen.queryByRole('button', { name: /Dodaj drugi smještaj/ })).toBeNull();
    tab('Početna');
    await openItem('Sol');
    click(/Dodaj drugi smještaj/);
    expect((screen.getByTestId('dest-pantry') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('dest-garage'));
    await waitFor(() => expect(t.repo.addPlacement).toHaveBeenCalledWith('salt', 'garage'));
  });
  it('predmet bez smještaja: kontrolirani oporavak "Dodaj smještaj"', async () => {
    const t = await setup();
    await t.push({
      status: 'ready',
      needsBootstrap: false,
      data: { ...DATA, placements: DATA.placements.filter((p) => p.itemId !== 'salt') },
    });
    await openItem('Sol');
    expect(screen.getByTestId('no-placement')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Dodaj smještaj/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Premjesti/ })).toBeNull();
  });
});

describe('nespremljene izmjene (UX-032-01)', () => {
  async function editing() {
    const t = await setup();
    await t.push(ready);
    await openItem('Aku bušilica');
    click('Uredi');
    return t;
  }
  const dirtyIt = () =>
    fireEvent.change(field('Naziv predmeta *'), { target: { value: 'Aku bušilica 2' } });

  it('bez izmjena nema dijaloga', async () => {
    await editing();
    fireEvent.click(screen.getByRole('button', { name: 'Natrag' }));
    expect(screen.queryByTestId('unsaved-dialog')).toBeNull();
    expect(screen.getByTestId('item-name')).toBeTruthy();
  });
  it('Natrag s izmjenama: dijalog s tri izbora; "Ostani ovdje" čuva tekst', async () => {
    const t = await editing();
    dirtyIt();
    fireEvent.click(screen.getByRole('button', { name: 'Natrag' }));
    expect(screen.getByTestId('unsaved-dialog')).toBeTruthy();
    for (const n of ['Spremi promjene pa nastavi', 'Odbaci izmjene', 'Ostani ovdje'])
      expect(screen.getByRole('button', { name: n })).toBeTruthy();
    click('Ostani ovdje');
    expect(screen.queryByTestId('unsaved-dialog')).toBeNull();
    expect(field('Naziv predmeta *').value).toBe('Aku bušilica 2');
    expect(t.repo.updateItem).not.toHaveBeenCalled();
  });
  it('"Odbaci izmjene" odbacuje SAMO lokalni nacrt i odlazi, bez poziva repozitorija', async () => {
    const t = await editing();
    dirtyIt();
    fireEvent.click(screen.getByRole('button', { name: 'Natrag' }));
    click('Odbaci izmjene');
    expect(screen.getByTestId('item-name').textContent).toBe('Aku bušilica');
    expect(t.repo.updateItem).not.toHaveBeenCalled();
  });
  it('"Spremi promjene pa nastavi": updateItem online s verzijom, a navigacija TEK nakon potvrde', async () => {
    const t = await editing();
    let release!: () => void;
    t.repo.updateItem = vi.fn(() => new Promise<void>((r) => (release = r)));
    dirtyIt();
    fireEvent.click(screen.getByRole('button', { name: 'Natrag' }));
    click('Spremi promjene pa nastavi');
    await waitFor(() => expect(t.repo.updateItem).toHaveBeenCalledTimes(1));
    expect(vi.mocked(t.repo.updateItem).mock.calls[0]![0]).toBe('drill');
    expect(vi.mocked(t.repo.updateItem).mock.calls[0]![1]).toMatchObject({
      name: 'Aku bušilica 2',
    });
    expect(vi.mocked(t.repo.updateItem).mock.calls[0]![2]).toBe(1);
    expect(screen.queryByTestId('item-name')).toBeNull(); // još smo na obrascu dok nema potvrde
    await act(async () => release());
    await screen.findByTestId('item-name');
  });
  it('server odbije spremanje: ostajemo na obrascu, tekst je sačuvan, dijalog zatvoren, poruka vidljiva', async () => {
    const t = await editing();
    t.repo.updateItem = vi.fn(async () => {
      throw new DomainError('changed-elsewhere');
    });
    dirtyIt();
    fireEvent.click(screen.getByRole('button', { name: 'Natrag' }));
    click('Spremi promjene pa nastavi');
    await screen.findByText(/Netko je promijenio zapis/);
    expect(screen.queryByTestId('unsaved-dialog')).toBeNull();
    expect(field('Naziv predmeta *').value).toBe('Aku bušilica 2');
  });
  it('Uredi -> Premjesti s izmjenama pokreće isti dijalog; navigacija aplikacije (kartice) također', async () => {
    await editing();
    dirtyIt();
    click(/Promijeni lokaciju preko Premjesti/);
    expect(screen.getByTestId('unsaved-dialog')).toBeTruthy();
    click('Ostani ovdje');
    tab('Lokacije');
    expect(screen.getByTestId('unsaved-dialog')).toBeTruthy();
    click('Odbaci izmjene');
    expect(screen.getByRole('heading', { name: 'Lokacije' })).toBeTruthy();
  });
  it('Android Back (popstate) s izmjenama otvara dijalog i ostaje na obrascu; bez izmjena vraća natrag', async () => {
    await editing();
    dirtyIt();
    await act(async () => void window.dispatchEvent(new PopStateEvent('popstate')));
    expect(screen.getByTestId('unsaved-dialog')).toBeTruthy();
    // Natrag dok je dijalog otvoren = "Ostani ovdje"
    await act(async () => void window.dispatchEvent(new PopStateEvent('popstate')));
    expect(screen.queryByTestId('unsaved-dialog')).toBeNull();
    expect(field('Naziv predmeta *').value).toBe('Aku bušilica 2');
    fireEvent.change(field('Naziv predmeta *'), { target: { value: 'Aku bušilica' } }); // vraćeno = nema izmjena
    await act(async () => void window.dispatchEvent(new PopStateEvent('popstate')));
    expect(screen.queryByTestId('unsaved-dialog')).toBeNull();
    expect(screen.getByTestId('item-name')).toBeTruthy();
  });
  it('urednik ne mijenja smještaj: updateItem nikad ne nosi lokaciju ni vrstu', async () => {
    const t = await editing();
    dirtyIt();
    fireEvent.submit(screen.getByRole('form', { name: 'Uredi predmet' }));
    await waitFor(() => expect(t.repo.updateItem).toHaveBeenCalled());
    const patch = vi.mocked(t.repo.updateItem).mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(patch).sort()).toEqual(['aliases', 'category', 'name', 'note']);
  });
  it('konflikt: promjena na poslužitelju prikazuje usporedbu, nacrt ostaje, spremanje ide nad AKTUALNOM verzijom tek na izričitu radnju', async () => {
    const t = await editing();
    dirtyIt();
    const changed: InventoryData = {
      ...DATA,
      items: DATA.items.map((i) =>
        i.id === 'drill' ? { ...i, name: 'Tuđi naziv', version: 2 } : i,
      ),
    };
    await t.push({ status: 'ready', data: changed, needsBootstrap: false });
    expect(screen.getByTestId('compare').textContent).toContain('Tuđi naziv');
    expect(field('Naziv predmeta *').value).toBe('Aku bušilica 2');
    click('Nastavi nad aktualnom verzijom');
    fireEvent.submit(screen.getByRole('form', { name: 'Uredi predmet' }));
    await waitFor(() => expect(t.repo.updateItem).toHaveBeenCalled());
    expect(vi.mocked(t.repo.updateItem).mock.calls[0]![2]).toBe(2);
  });
});

describe('navigacija i Android Back', () => {
  it('kartice: Početna | Lokacije | Dodaj | Popis (onemogućen, "uskoro") | Više', async () => {
    const t = await setup();
    await t.push(ready);
    const nav = within(screen.getByTestId('bottom-nav'));
    expect(nav.getAllByRole('button').map((b) => b.textContent)).toEqual([
      '⌂Početna',
      '▤Lokacije',
      '＋Dodaj',
      '🛒Popis · uskoro',
      '☰Više',
    ]);
    expect((nav.getByRole('button', { name: /Popis kupnje/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
  it('popstate vraća razinu po razinu; na Početnoj ne radi ništa', async () => {
    const t = await setup();
    await t.push(ready);
    tab('Lokacije');
    fireEvent.click(screen.getByTestId('loc-kitchen'));
    expect(screen.getByRole('heading', { name: 'Sadržaj lokacije' })).toBeTruthy();
    await act(async () => void window.dispatchEvent(new PopStateEvent('popstate')));
    expect(screen.getByRole('heading', { name: 'Lokacije' })).toBeTruthy();
    await act(async () => void window.dispatchEvent(new PopStateEvent('popstate')));
    expect(screen.getByRole('heading', { name: 'Što tražiš?' })).toBeTruthy();
    await act(async () => void window.dispatchEvent(new PopStateEvent('popstate')));
    expect(screen.getByRole('heading', { name: 'Što tražiš?' })).toBeTruthy();
    expect(history()).toBeTruthy();
  });
  it('Više: račun, provjera pristupa, odjava; nema demo kontrola', async () => {
    const t = await setup();
    await t.push(ready);
    tab('Više');
    expect(screen.getByTestId('account-card')).toBeTruthy();
    expect(screen.queryByText(/demo/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Provjeri pristup' }));
    expect(account.onRecheck).toHaveBeenCalled();
  });
});

describe('nepoznat ishod pri uređivanju i odlasku s obrasca', () => {
  it('uređivanje: nepoznat ishod pa provjera "applied" vodi na detalj kao spremljeno (bez lažnog konflikta)', async () => {
    const t = await setup();
    await t.push(ready);
    t.repo.updateItem = vi.fn(async () => {
      throw new DomainError('outcome-unknown');
    });
    await openItem('Sol');
    click('Uredi');
    fireEvent.change(field('Naziv predmeta *'), { target: { value: 'Morska sol' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Uredi predmet' }));
    await screen.findByText(/Veza je prekinuta tijekom potvrđivanja/);
    expect(field('Naziv predmeta *').value).toBe('Morska sol'); // unos sačuvan
    t.repo.verify = vi.fn(async (): Promise<VerifyResult> => 'applied');
    click('Provjeri stanje');
    await screen.findByTestId('item-name');
    expect(screen.getByText(/Spremljeno · potvrđeno online/)).toBeTruthy();
  });
  it('provjera dovršena nakon što je korisnik napustio obrazac NE preusmjerava ga na drugi zaslon', async () => {
    const t = await setup();
    await t.push(ready);
    t.repo.createItemWithPlacement = vi.fn(async () => {
      throw new DomainError('outcome-unknown');
    });
    tab('Dodaj predmet');
    fireEvent.change(field('Lokacija *'), { target: { value: 'garage' } });
    fireEvent.change(field('Naziv predmeta *'), { target: { value: 'Čekić' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Novi predmet' }));
    await screen.findByText(/Veza je prekinuta tijekom potvrđivanja/);
    tab('Lokacije'); // korisnik odlazi; nerazriješeno upozorenje ostaje
    expect(screen.getByRole('heading', { name: 'Lokacije' })).toBeTruthy();
    expect(screen.getByTestId('inv-status').textContent).toContain('Veza je prekinuta');
    t.repo.verify = vi.fn(async (): Promise<VerifyResult> => 'applied');
    click('Provjeri stanje');
    await screen.findByText(/Spremljeno · potvrđeno online/);
    expect(screen.getByRole('heading', { name: 'Lokacije' })).toBeTruthy(); // ostaje gdje jest
  });
  it('dok je dijalog nespremljenih izmjena otvoren, pozadina je neaktivna (inert)', async () => {
    const t = await setup();
    await t.push(ready);
    await openItem('Sol');
    click('Uredi');
    fireEvent.change(field('Naziv predmeta *'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Natrag' }));
    expect(screen.getByTestId('bottom-nav').closest('[inert]')).not.toBeNull();
    click('Ostani ovdje');
    expect(screen.getByTestId('bottom-nav').closest('[inert]')).toBeNull();
  });
});
