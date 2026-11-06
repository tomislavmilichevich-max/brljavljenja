import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AccessResult, AuthPort, Services, SessionUser, SignInErrorKind } from '../auth/types';
import { App } from './App';

/** Lažni servisi: testira se UI logika, a ne Firebase (to pokrivaju testovi pravila i e2e s emulatorom). */
function fake(access: AccessResult | (() => Promise<AccessResult>)) {
  let onUser: (u: SessionUser | null) => void = () => {};
  let onError: (k: SignInErrorKind) => void = () => {};
  const auth: AuthPort = {
    subscribe: (u, e) => {
      onUser = u;
      onError = e;
      return () => {};
    },
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn(async () => onUser(null)),
  };
  const checkAccess = vi.fn(async () => (typeof access === 'function' ? access() : access));
  const services: Services = { auth, access: { checkAccess } };
  return {
    services,
    emitUser: (u: SessionUser | null) => act(() => onUser(u)),
    emitError: (k: SignInErrorKind) => act(() => onError(k)),
    auth,
    checkAccess,
  };
}
const userC: SessionUser = { uid: 'uidC-123', displayName: 'Treći' };
const userA: SessionUser = { uid: 'uidA-1', displayName: 'Ana' };

describe('App — P1 ekrani', () => {
  it('APP-01 bez konfiguracije: jasna poruka, bez pada', () => {
    render(<App />);
    expect(screen.getByRole('alert').textContent).toContain('Firebase nije podešen');
    expect(screen.getByRole('alert').textContent).toContain('VITE_FIREBASE_API_KEY');
  });

  it('prije odgovora Auth-a prikazuje učitavanje, zatim prijavu', async () => {
    const f = fake({ status: 'denied' });
    render(<App services={f.services} />);
    expect(screen.getByRole('status').textContent).toContain('Učitavanje');
    await f.emitUser(null);
    expect(screen.getByRole('button', { name: 'Prijava Google računom' })).toBeTruthy();
  });

  it('APP-02 prijavljen, nije član: "Nemaš pristup", bez household podataka', async () => {
    const f = fake({ status: 'denied' });
    render(<App services={f.services} />);
    await f.emitUser(userC);
    await screen.findByRole('heading', { name: 'Nemaš pristup' });
    expect(screen.queryByTestId('household-name')).toBeNull();
  });

  it('APP-06 neodobreni korisnik vidi i može kopirati samo vlastiti UID', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const f = fake({ status: 'denied' });
    render(<App services={f.services} />);
    await f.emitUser(userC);
    await screen.findByRole('heading', { name: 'Nemaš pristup' });
    expect((screen.getByTestId('own-uid') as HTMLInputElement).value).toBe('uidC-123');
    fireEvent.click(screen.getByRole('button', { name: 'Kopiraj UID' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('uidC-123'));
  });

  it('kopiranje ne uspije: poruka za ručno kopiranje', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('x')) },
      configurable: true,
    });
    const f = fake({ status: 'denied' });
    render(<App services={f.services} />);
    await f.emitUser(userC);
    fireEvent.click(await screen.findByRole('button', { name: 'Kopiraj UID' }));
    await screen.findByText(/ručno/);
  });

  it('APP-03 odobreni član vidi naziv kućanstva', async () => {
    const f = fake({ status: 'member', householdName: 'Testno kućanstvo' });
    render(<App services={f.services} />);
    await f.emitUser(userA);
    await waitFor(() =>
      expect(screen.getByTestId('household-name').textContent).toContain('Testno kućanstvo'),
    );
  });

  it('prijava sama po sebi nije pristup: tijekom provjere nema household podataka', async () => {
    let resolve!: (r: AccessResult) => void;
    const f = fake(() => new Promise<AccessResult>((r) => (resolve = r)));
    render(<App services={f.services} />);
    await f.emitUser(userA);
    expect(screen.getByRole('status').textContent).toContain('Provjera pristupa');
    expect(screen.queryByTestId('household-name')).toBeNull();
    await act(async () => resolve({ status: 'member', householdName: 'X' }));
    expect(screen.getByTestId('household-name')).toBeTruthy();
  });

  it('APP-04 odjava uklanja privatne podatke s ekrana', async () => {
    const f = fake({ status: 'member', householdName: 'Tajno ime' });
    render(<App services={f.services} />);
    await f.emitUser(userA);
    await screen.findByTestId('household-name');
    fireEvent.click(screen.getByRole('button', { name: 'Odjava' }));
    await screen.findByRole('button', { name: 'Prijava Google računom' });
    expect(document.body.textContent).not.toContain('Tajno ime');
    expect(f.auth.signOut).toHaveBeenCalled();
  });

  it('promjena računa A -> C: C ne vidi podatke kućanstva od A', async () => {
    const results = [
      { status: 'member', householdName: 'Anino kućanstvo' } as const,
      { status: 'denied' } as const,
    ];
    const f = fake(async () => results.shift()!);
    render(<App services={f.services} />);
    await f.emitUser(userA);
    await screen.findByTestId('household-name');
    await f.emitUser(userC);
    await screen.findByRole('heading', { name: 'Nemaš pristup' });
    expect(document.body.textContent).not.toContain('Anino kućanstvo');
  });

  it('APP-05 greška prijave (mreža) prikazuje poruku i nikad uspjeh', async () => {
    const f = fake({ status: 'denied' });
    (f.auth.signIn as ReturnType<typeof vi.fn>).mockRejectedValue({
      code: 'auth/network-request-failed',
    });
    render(<App services={f.services} />);
    await f.emitUser(null);
    fireEvent.click(screen.getByRole('button', { name: 'Prijava Google računom' }));
    await screen.findByText(/Nema veze/);
    expect(screen.queryByText('Pristup odobren')).toBeNull();
  });

  it('otkazana prijava (zatvoren popup) daje blagu poruku', async () => {
    const f = fake({ status: 'denied' });
    (f.auth.signIn as ReturnType<typeof vi.fn>).mockRejectedValue({
      code: 'auth/popup-closed-by-user',
    });
    render(<App services={f.services} />);
    await f.emitUser(null);
    fireEvent.click(screen.getByRole('button', { name: 'Prijava Google računom' }));
    await screen.findByText(/otkazana/);
  });

  it('APP-05 offline pri provjeri pristupa: nije prikazan kao odobren; "Pokušaj ponovno" radi', async () => {
    const results: AccessResult[] = [
      { status: 'error', kind: 'offline' },
      { status: 'member', householdName: 'Dom' },
    ];
    const f = fake(async () => results.shift()!);
    render(<App services={f.services} />);
    await f.emitUser(userA);
    await screen.findByText(/Nema veze s poslužiteljem/);
    expect(screen.queryByTestId('household-name')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pokušaj ponovno' }));
    await screen.findByTestId('household-name');
  });

  it('povratak mreže automatski ponavlja provjeru nakon offline greške', async () => {
    const results: AccessResult[] = [
      { status: 'error', kind: 'offline' },
      { status: 'member', householdName: 'Dom' },
    ];
    const f = fake(async () => results.shift()!);
    render(<App services={f.services} />);
    await f.emitUser(userA);
    await screen.findByText(/Nema veze s poslužiteljem/);
    await act(async () => window.dispatchEvent(new Event('online')));
    await screen.findByTestId('household-name');
  });

  it('nakon ručnog odobrenja "Provjeri ponovno" daje pristup', async () => {
    const results: AccessResult[] = [
      { status: 'denied' },
      { status: 'member', householdName: 'Dom' },
    ];
    const f = fake(async () => results.shift()!);
    render(<App services={f.services} />);
    await f.emitUser(userC);
    fireEvent.click(await screen.findByRole('button', { name: 'Provjeri ponovno' }));
    await screen.findByTestId('household-name');
  });

  it('neočekivano odbijanje checkAccess-a završava u grešci, ne u odobrenom stanju', async () => {
    const f = fake(async () => {
      throw new Error('boom');
    });
    render(<App services={f.services} />);
    await f.emitUser(userA);
    await screen.findByRole('heading', { name: 'Provjera pristupa nije uspjela' });
  });
});
