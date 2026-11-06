import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('App — revalidacija tijekom otvorene sesije (P1-REV-02) i household-missing (P1-REV-01)', () => {
  const MEMBER: AccessResult = { status: 'member', householdName: 'Dom' };
  const DENIED: AccessResult = { status: 'denied' };
  const OFFLINE: AccessResult = { status: 'error', kind: 'offline' };
  // Redom vraća zadane rezultate; zadnji se ponavlja.
  const seq = (results: AccessResult[]) => async () =>
    results.length > 1 ? results.shift()! : results[0]!;
  const setVisibility = (v: 'visible' | 'hidden') =>
    Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
  const fireVisibility = () =>
    act(async () => void document.dispatchEvent(new Event('visibilitychange')));

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setVisibility('visible');
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  async function openMember(f: ReturnType<typeof fake>) {
    render(<App services={f.services} />);
    await f.emitUser(userA);
    await screen.findByTestId('household-name');
  }

  it('REV-01 household ne postoji (membership postoji): NIKAD "Pristup odobren"', async () => {
    const f = fake({ status: 'error', kind: 'household-missing' });
    render(<App services={f.services} />);
    await f.emitUser(userA);
    await screen.findByRole('heading', { name: 'Provjera pristupa nije uspjela' });
    expect(screen.getByRole('alert').textContent).toContain('dokument kućanstva nije postavljen');
    expect(screen.queryByText('Pristup odobren')).toBeNull();
    expect(screen.queryByTestId('household-name')).toBeNull();
  });

  it('prikazuje vrijeme potvrde sa servera nakon odobrenja', async () => {
    await openMember(fake(MEMBER));
    expect(screen.getByTestId('verified-at').textContent).toContain('potvrđen sa servera');
  });

  it('opoziv: povratak u prvi plan nakon >15 s uklanja "Pristup odobren"', async () => {
    const f = fake(seq([MEMBER, DENIED]));
    await openMember(f);
    await act(async () => void vi.advanceTimersByTime(16_000));
    await fireVisibility();
    await screen.findByRole('heading', { name: 'Nemaš pristup' });
    expect(screen.queryByTestId('household-name')).toBeNull();
    expect(document.body.textContent).not.toContain('Dom');
    expect(f.checkAccess).toHaveBeenCalledTimes(2);
  });

  it('prag: ponovljeni povratak u prvi plan unutar 15 s NE troši novo čitanje', async () => {
    const f = fake(MEMBER);
    await openMember(f);
    await fireVisibility();
    await fireVisibility();
    expect(f.checkAccess).toHaveBeenCalledTimes(1);
  });

  it('skrivena aplikacija ne revalidira (visibilitychange u "hidden")', async () => {
    const f = fake(MEMBER);
    await openMember(f);
    await act(async () => void vi.advanceTimersByTime(16_000));
    setVisibility('hidden');
    await fireVisibility();
    expect(f.checkAccess).toHaveBeenCalledTimes(1);
  });

  it('oporavak mreže revalidira odmah (zaobilazi prag) i uklanja odobrenje opozvanom članu', async () => {
    const f = fake(seq([MEMBER, DENIED]));
    await openMember(f);
    await act(async () => void window.dispatchEvent(new Event('online')));
    await screen.findByRole('heading', { name: 'Nemaš pristup' });
    expect(f.checkAccess).toHaveBeenCalledTimes(2);
  });

  it('offline revalidacija: prikaz ostaje, ali je JASNO označen kao nepotvrđen; povratak mreže briše upozorenje', async () => {
    const f = fake(seq([MEMBER, OFFLINE, MEMBER]));
    await openMember(f);
    await act(async () => void vi.advanceTimersByTime(16_000));
    await fireVisibility();
    await screen.findByTestId('stale-warning');
    expect(screen.getByTestId('stale-warning').textContent).toContain('nije moguće potvrditi');
    expect(screen.queryByTestId('verified-at')).toBeNull();
    expect(screen.getByTestId('household-name')).toBeTruthy();
    await act(async () => void window.dispatchEvent(new Event('online')));
    await screen.findByTestId('verified-at');
    expect(screen.queryByTestId('stale-warning')).toBeNull();
  });

  it('rijetki timer (10 min) revalidira dok je vidljivo; ne prije', async () => {
    const f = fake(seq([MEMBER, DENIED]));
    await openMember(f);
    await act(async () => void vi.advanceTimersByTime(9 * 60_000));
    expect(f.checkAccess).toHaveBeenCalledTimes(1);
    await act(async () => void vi.advanceTimersByTime(60_000 + 100));
    await screen.findByRole('heading', { name: 'Nemaš pristup' });
    expect(f.checkAccess).toHaveBeenCalledTimes(2);
  });

  it('timer ne čita dok je aplikacija skrivena', async () => {
    const f = fake(MEMBER);
    await openMember(f);
    setVisibility('hidden');
    await act(async () => void vi.advanceTimersByTime(10 * 60_000 + 100));
    expect(f.checkAccess).toHaveBeenCalledTimes(1);
  });

  it('household nestane tijekom sesije: odobrenje se uklanja', async () => {
    const f = fake(seq([MEMBER, { status: 'error', kind: 'household-missing' }]));
    await openMember(f);
    await act(async () => void vi.advanceTimersByTime(16_000));
    await fireVisibility();
    await screen.findByRole('heading', { name: 'Provjera pristupa nije uspjela' });
    expect(screen.queryByTestId('household-name')).toBeNull();
  });

  it('nakon odjave nema više revalidacija (listeneri uklonjeni)', async () => {
    const f = fake(MEMBER);
    await openMember(f);
    fireEvent.click(screen.getByRole('button', { name: 'Odjava' }));
    await screen.findByRole('button', { name: 'Prijava Google računom' });
    await act(async () => void vi.advanceTimersByTime(11 * 60_000));
    await fireVisibility();
    await act(async () => void window.dispatchEvent(new Event('online')));
    expect(f.checkAccess).toHaveBeenCalledTimes(1);
  });

  it('gumb "Provjeri pristup" ručno ponavlja provjeru', async () => {
    const f = fake(seq([MEMBER, DENIED]));
    await openMember(f);
    fireEvent.click(screen.getByRole('button', { name: 'Provjeri pristup' }));
    await screen.findByRole('heading', { name: 'Nemaš pristup' });
  });
});
