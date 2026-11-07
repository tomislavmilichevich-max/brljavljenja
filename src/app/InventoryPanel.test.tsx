import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '../inventory/errors';
import type { InventoryState } from '../inventory/gate';
import type { InventoryPort, InventorySession } from '../inventory/port';
import type { InventoryRepository } from '../inventory/repository';
import type { InventoryData } from '../inventory/types';
import { InventoryPanel } from './InventoryPanel';

const audit = { version: 1, archived: false };
const DATA: InventoryData = {
  locations: [
    { id: 'root', name: 'Kuća', parentId: null, kind: 'house', ...audit },
    { id: 'kitchen', name: 'Kuhinja', parentId: 'root', kind: 'room', ...audit },
    { id: 'cab', name: 'Gornji ormar', parentId: 'kitchen', kind: 'cabinet', ...audit },
    { id: 'box', name: 'Kutija', parentId: 'cab', kind: 'box', ...audit },
    { id: 'garage', name: 'Garaža', parentId: 'root', kind: 'room', ...audit },
  ],
  items: [
    {
      id: 'drill',
      name: 'Bušilica',
      kind: 'unique',
      aliases: [],
      category: null,
      note: null,
      ...audit,
    },
    {
      id: 'bat',
      name: 'Baterije',
      kind: 'type',
      aliases: [],
      category: null,
      note: null,
      ...audit,
    },
  ],
  placements: [
    { id: 'p-drill', itemId: 'drill', locationId: 'cab', ...audit },
    { id: 'p-bat1', itemId: 'bat', locationId: 'cab', ...audit },
    { id: 'p-bat2', itemId: 'bat', locationId: 'garage', ...audit },
  ],
};

function mkRepo(): InventoryRepository {
  return {
    bootstrap: vi.fn(async () => ({ created: [] })),
    createLocation: vi.fn(async () => ({ id: 'new-loc' })),
    renameLocation: vi.fn(async () => {}),
    moveLocation: vi.fn(async () => {}),
    createItem: vi.fn(async () => ({ id: 'new-item' })),
    updateItem: vi.fn(async () => {}),
    addPlacement: vi.fn(async () => ({ id: 'new-pl' })),
    movePlacement: vi.fn(async () => {}),
    archivePlacement: vi.fn(async () => {}),
  };
}

async function setup() {
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
  const utils = render(<InventoryPanel port={port} onRevoked={onRevoked} />);
  const push = (s: InventoryState) => act(async () => emit(s));
  await waitFor(() => expect(watchSpy).toHaveBeenCalled()); // sesija otvorena i pretplata registrirana
  return { repo, push, unwatch, dispose, onRevoked, port, ...utils };
}
const ready: InventoryState = { status: 'ready', data: DATA, needsBootstrap: false };

describe('InventoryPanel — učitavanje i vrata', () => {
  it('dok nema server-potvrđenog skupa prikazuje samo "Učitavanje" i NIKAKVE podatke', async () => {
    const t = await setup();
    await waitFor(() => expect(t.port.open).toHaveBeenCalled());
    await t.push({ status: 'loading' });
    expect(screen.getByTestId('inv-loading')).toBeTruthy();
    expect(screen.queryByText('Kuhinja')).toBeNull();
  });
  it('ready: prikazuje stablo, predmete i punu putanju svakog smještaja', async () => {
    const t = await setup();
    await t.push(ready);
    expect(screen.getByTestId('loc-box')).toBeTruthy();
    const paths = within(screen.getByTestId('item-bat'))
      .getAllByTestId('pl-path')
      .map((n) => n.textContent);
    expect(paths.sort()).toEqual(['Kuća › Garaža', 'Kuća › Kuhinja › Gornji ormar']);
  });
  it('tree-corrupt: poruka o oštećenju, NIKAKVI nazivi lokacija/predmeta u DOM-u i nema obrazaca', async () => {
    const t = await setup();
    await t.push({ status: 'tree-corrupt', problems: [{ type: 'cycle', ids: ['a', 'b'] }] });
    expect(screen.getByTestId('inv-corrupt').textContent).toContain('oštećeno');
    expect(screen.queryByLabelText('Naziv predmeta')).toBeNull();
    expect(document.body.textContent).not.toContain('Kuhinja');
  });
  it('stale (veza pala): zadnje potvrđeno stanje je vidljivo, ali su SVE izmjene onemogućene', async () => {
    const t = await setup();
    await t.push({ status: 'stale', data: DATA });
    expect(screen.getByTestId('inv-stale')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Dodaj lokaciju' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Dodaj predmet' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it('needsBootstrap: nudi "Pripremi kućanstvo" (izričita radnja) i zove bootstrap', async () => {
    const t = await setup();
    await t.push({
      status: 'ready',
      data: { locations: [], items: [], placements: [] },
      needsBootstrap: true,
    });
    fireEvent.click(screen.getAllByRole('button', { name: /Pripremi kućanstvo/ })[0]!);
    await waitFor(() => expect(t.repo.bootstrap).toHaveBeenCalled());
  });
});

describe('InventoryPanel — P2-LOC-ROOM-01 u sučelju', () => {
  it('odabir vrste "Prostorija" prisiljava roditelja na root i zaključava izbor; spremanje šalje parentId=root', async () => {
    const t = await setup();
    await t.push(ready);
    fireEvent.change(screen.getByLabelText('Vrsta lokacije'), { target: { value: 'room' } });
    const parent = screen.getByLabelText('Nadređena lokacija') as HTMLSelectElement;
    expect(parent.disabled).toBe(true);
    expect(parent.value).toBe('root');
    fireEvent.change(screen.getByLabelText('Naziv lokacije'), { target: { value: 'Radna soba' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj lokaciju' }));
    await waitFor(() =>
      expect(t.repo.createLocation).toHaveBeenCalledWith({
        name: 'Radna soba',
        parentId: 'root',
        kind: 'room',
      }),
    );
  });
  it('prostorije NEMAJU radnju premještanja; ormar/kutija imaju', async () => {
    const t = await setup();
    await t.push(ready);
    expect(
      within(screen.getByTestId('loc-kitchen')).queryByText('Premjesti cijelu lokaciju'),
    ).toBeNull();
    expect(
      within(screen.getByTestId('loc-kitchen')).getByText('Prostorije se ne premještaju.'),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('loc-box')).getByText('Premjesti cijelu lokaciju'),
    ).toBeTruthy();
  });
  it('odredišta za premještaj ne uključuju samu lokaciju ni njezine potomke (ciklus se ni ne nudi)', async () => {
    const t = await setup();
    await t.push(ready);
    const select = screen.getByLabelText('Premjesti Gornji ormar pod') as HTMLSelectElement;
    const labels = [...select.options].map((o) => o.textContent);
    expect(labels).not.toContain('Kuća › Kuhinja › Gornji ormar');
    expect(labels).not.toContain('Kuća › Kuhinja › Gornji ormar › Kutija');
    expect(labels).toContain('Kuća › Garaža');
  });
});

describe('InventoryPanel — online izmjene i status spremanja', () => {
  it('"spremljeno na serveru" se pojavljuje TEK nakon što transakcija završi; prije toga "Spremanje…"', async () => {
    const t = await setup();
    await t.push(ready);
    let resolve!: () => void;
    (t.repo.movePlacement as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<void>((r) => (resolve = r)),
    );
    fireEvent.change(screen.getByLabelText(/Premjesti smještaj Bušilica/), {
      target: { value: 'box' },
    });
    fireEvent.click(
      within(screen.getByTestId('pl-p-drill')).getByRole('button', { name: 'Premjesti' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('inv-status').textContent).toContain('Spremanje…'),
    );
    expect(screen.getByTestId('inv-status').textContent).not.toContain('spremljeno');
    expect(t.repo.movePlacement).toHaveBeenCalledWith('p-drill', 'box', 1);
    await act(async () => resolve());
    await waitFor(() =>
      expect(screen.getByTestId('inv-status').textContent).toContain('spremljeno na serveru'),
    );
  });
  it('tijekom spremanja su SVI obrasci onemogućeni (nema dvostrukog slanja); nakon završetka ponovno omogućeni', async () => {
    const t = await setup();
    await t.push(ready);
    let resolve!: () => void;
    (t.repo.addPlacement as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<{ id: string }>((r) => (resolve = () => r({ id: 'x' }))),
    );
    fireEvent.change(screen.getByLabelText('Dodaj smještaj za Baterije'), {
      target: { value: 'box' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Dodaj smještaj' })[0]!);
    await waitFor(() =>
      expect(screen.getByTestId('inv-status').textContent).toContain('Spremanje…'),
    );
    expect(
      (screen.getByRole('button', { name: 'Dodaj lokaciju' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Dodaj predmet' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => resolve());
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Dodaj lokaciju' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });
  it('offline: poruka kaže da promjena NIJE spremljena i neće se poslati naknadno; nema "spremljeno"', async () => {
    const t = await setup();
    await t.push(ready);
    (t.repo.updateItem as ReturnType<typeof vi.fn>).mockRejectedValue(new DomainError('offline'));
    fireEvent.click(
      within(screen.getByTestId('item-bat')).getByRole('button', { name: 'Preimenuj' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('inv-status').textContent).toContain('NIJE spremljena'),
    );
    expect(screen.getByTestId('inv-status').textContent).toContain('neće se poslati naknadno');
    expect(screen.getByTestId('inv-status').textContent).not.toContain('spremljeno na serveru');
  });
  it('sukob verzija i duplikat daju jasne poruke', async () => {
    const t = await setup();
    await t.push(ready);
    (t.repo.updateItem as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new DomainError('changed-elsewhere'),
    );
    fireEvent.click(
      within(screen.getByTestId('item-bat')).getByRole('button', { name: 'Preimenuj' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('inv-status').textContent).toContain(
        'Promijenjeno na drugom uređaju',
      ),
    );
    (t.repo.addPlacement as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new DomainError('duplicate-placement'),
    );
    fireEvent.change(screen.getByLabelText('Dodaj smještaj za Baterije'), {
      target: { value: 'box' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Dodaj smještaj' })[0]!);
    await waitFor(() =>
      expect(screen.getByTestId('inv-status').textContent).toContain('već postoji'),
    );
  });
  it('jedinstveni predmet sa smještajem ne nudi "dodaj smještaj" (nudi samo premještaj); type nudi i ne nudi lokacije koje već zauzima', async () => {
    const t = await setup();
    await t.push(ready);
    expect(within(screen.getByTestId('item-drill')).getByText(/već smješten/)).toBeTruthy();
    const opts = [
      ...(screen.getByLabelText('Dodaj smještaj za Baterije') as HTMLSelectElement).options,
    ].map((o) => o.textContent);
    expect(opts).not.toContain('Kuća › Garaža');
    expect(opts).toContain('Kuća › Kuhinja › Gornji ormar › Kutija');
  });
  it('novi predmet s lokacijom: createItem pa addPlacement; ako smještaj padne, poruka kaže da je predmet stvoren a smještaj NIJE', async () => {
    const t = await setup();
    await t.push(ready);
    (t.repo.addPlacement as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new DomainError('offline'),
    );
    fireEvent.change(screen.getByLabelText('Naziv predmeta'), { target: { value: 'Ljestve' } });
    fireEvent.change(screen.getByLabelText('Početna lokacija'), { target: { value: 'garage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj predmet' }));
    await waitFor(() =>
      expect(screen.getByTestId('inv-status').textContent).toContain(
        'Predmet je stvoren, ali smještaj NIJE spremljen',
      ),
    );
    expect(t.repo.createItem).toHaveBeenCalledWith({ name: 'Ljestve', kind: 'type' });
  });
});

describe('InventoryPanel — stara poruka o spremanju', () => {
  it('kad prikaz postane nepotvrđen (stale), stara poruka "spremljeno na serveru" se skriva', async () => {
    const t = await setup();
    await t.push(ready);
    fireEvent.click(
      within(screen.getByTestId('item-bat')).getByRole('button', { name: 'Preimenuj' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('inv-status').textContent).toContain('spremljeno na serveru'),
    );
    await t.push({ status: 'stale', data: DATA });
    expect(screen.queryByTestId('inv-status')).toBeNull();
  });
});

describe('InventoryPanel — Enter ne zaobilazi onemogućene izmjene', () => {
  it('stale: slanje obrasca (Enter) ne zove repozitorij ni za lokaciju ni za predmet', async () => {
    const t = await setup();
    await t.push({ status: 'stale', data: DATA });
    fireEvent.change(screen.getByLabelText('Naziv predmeta'), {
      target: { value: 'Offline predmet' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Novi predmet' }));
    fireEvent.change(screen.getByLabelText('Naziv lokacije'), {
      target: { value: 'Offline lokacija' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Nova lokacija' }));
    await act(async () => {});
    expect(t.repo.createItem).not.toHaveBeenCalled();
    expect(t.repo.createLocation).not.toHaveBeenCalled();
    expect(screen.queryByTestId('inv-status')).toBeNull();
  });
});

describe('InventoryPanel — teardown i opoziv', () => {
  it('unmount (odjava/promjena računa): listeneri se odjavljuju i sesija se uništava; podaci nestaju iz DOM-a', async () => {
    const t = await setup();
    await t.push(ready);
    expect(screen.getByText('Kuhinja')).toBeTruthy();
    t.unmount();
    expect(t.unwatch).toHaveBeenCalledTimes(1);
    expect(t.dispose).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain('Kuhinja');
  });
  it('sesija koja se otvori NAKON unmounta odmah se uništava (nema zaostale sesije)', async () => {
    const dispose = vi.fn(async () => {});
    let finish!: (s: InventorySession) => void;
    const port: InventoryPort = { open: () => new Promise((r) => (finish = r)) };
    const { unmount } = render(<InventoryPanel port={port} onRevoked={() => {}} />);
    unmount();
    await act(async () => finish({ uid: 'u', repo: {} as never, watch: () => () => {}, dispose }));
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it('listener javi revoked: poziva se onRevoked (aplikacija uklanja odobrenje i panel)', async () => {
    const t = await setup();
    await t.push(ready);
    await t.push({ status: 'revoked' });
    expect(t.onRevoked).toHaveBeenCalled();
  });
  it('operacija vrati access-revoked: poziva se onRevoked i ne prikazuje se generička greška', async () => {
    const t = await setup();
    await t.push(ready);
    (t.repo.updateItem as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DomainError('access-revoked'),
    );
    fireEvent.click(
      within(screen.getByTestId('item-bat')).getByRole('button', { name: 'Preimenuj' }),
    );
    await waitFor(() => expect(t.onRevoked).toHaveBeenCalled());
    expect(screen.queryByTestId('inv-status')).toBeNull();
  });
  it('sesija se ne može otvoriti (access-revoked pri otvaranju): onRevoked, bez podataka', async () => {
    const port: InventoryPort = {
      open: async () => Promise.reject(new DomainError('access-revoked')),
    };
    const onRevoked = vi.fn();
    render(<InventoryPanel port={port} onRevoked={onRevoked} />);
    await waitFor(() => expect(onRevoked).toHaveBeenCalled());
  });
});
