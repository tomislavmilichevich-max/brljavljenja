import { describe, expect, it } from 'vitest';
import { initialSession, sessionReducer, type SessionState } from './session';
import type { AccessResult } from './types';

const A = { uid: 'uidA', displayName: 'A' };
const C = { uid: 'uidC', displayName: 'C' };
const member = (extra: Partial<Extract<SessionState, { phase: 'member' }>> = {}): SessionState => ({
  phase: 'member',
  user: A,
  householdName: 'Dom',
  verifiedAt: 1000,
  stale: false,
  ...extra,
});
const ok: AccessResult = { status: 'member', householdName: 'Dom' };

describe('sessionReducer — prijava i početna provjera', () => {
  it('prijavljen korisnik prvo ide u provjeru pristupa, ne u member', () => {
    expect(sessionReducer(initialSession, { type: 'user', user: A })).toEqual({
      phase: 'checking-access',
      user: A,
    });
  });
  it('member samo nakon rezultata member, s vremenom potvrde', () => {
    const s = sessionReducer(
      { phase: 'checking-access', user: A },
      { type: 'access', uid: 'uidA', result: ok, at: 5 },
    );
    expect(s).toEqual(member({ verifiedAt: 5 }));
  });
  it('denied i error rezultati (uključujući household-missing)', () => {
    const base: SessionState = { phase: 'checking-access', user: C };
    expect(
      sessionReducer(base, { type: 'access', uid: 'uidC', result: { status: 'denied' }, at: 1 })
        .phase,
    ).toBe('denied');
    expect(
      sessionReducer(base, {
        type: 'access',
        uid: 'uidC',
        result: { status: 'error', kind: 'household-missing' },
        at: 1,
      }),
    ).toEqual({ phase: 'access-error', user: C, kind: 'household-missing' });
  });
  it('zakašnjeli rezultat za drugi uid se ignorira (nema curenja nakon promjene računa)', () => {
    const s: SessionState = { phase: 'checking-access', user: C };
    expect(sessionReducer(s, { type: 'access', uid: 'uidA', result: ok, at: 1 })).toBe(s);
  });
  it('rezultat nakon odjave se ignorira', () => {
    const s: SessionState = { phase: 'signed-out', error: null, signingIn: false };
    expect(sessionReducer(s, { type: 'access', uid: 'uidA', result: ok, at: 1 })).toBe(s);
  });
  it('odjava iz member uklanja household podatke', () => {
    const s = sessionReducer(member({ householdName: 'Dom' }), { type: 'user', user: null });
    expect(s).toEqual({ phase: 'signed-out', error: null, signingIn: false });
    expect(JSON.stringify(s)).not.toContain('Dom');
  });
  it('promjena računa A -> C resetira na provjeru za C bez A-ovih podataka', () => {
    expect(sessionReducer(member(), { type: 'user', user: C })).toEqual({
      phase: 'checking-access',
      user: C,
    });
  });
  it('ponovljeni događaj istog korisnika ne resetira stanje', () => {
    const s = member();
    expect(sessionReducer(s, { type: 'user', user: A })).toBe(s);
  });
  it('recheck iz denied vraća na provjeru; iz member skriva podatke dok se ne potvrdi', () => {
    expect(sessionReducer({ phase: 'denied', user: C }, { type: 'recheck' })).toEqual({
      phase: 'checking-access',
      user: C,
    });
    expect(sessionReducer(member(), { type: 'recheck' }).phase).toBe('checking-access');
  });
  it('greška prijave se prikazuje samo na ekranu prijave', () => {
    const s = sessionReducer(
      { phase: 'signed-out', error: null, signingIn: true },
      { type: 'sign-in-error', kind: 'network' },
    );
    expect(s).toEqual({ phase: 'signed-out', error: 'network', signingIn: false });
    const m = member();
    expect(sessionReducer(m, { type: 'sign-in-error', kind: 'unknown' })).toBe(m);
  });
});

describe('sessionReducer — revalidacija tijekom otvorene sesije (P1-REV-02)', () => {
  it('opoziv (denied s poslužitelja) uklanja "Pristup odobren" i podatke kućanstva', () => {
    const s = sessionReducer(member(), {
      type: 'revalidated',
      uid: 'uidA',
      result: { status: 'denied' },
      at: 2000,
    });
    expect(s).toEqual({ phase: 'denied', user: A });
    expect(JSON.stringify(s)).not.toContain('Dom');
  });
  it('household nestao tijekom sesije -> access-error, ne member', () => {
    const s = sessionReducer(member(), {
      type: 'revalidated',
      uid: 'uidA',
      result: { status: 'error', kind: 'household-missing' },
      at: 2000,
    });
    expect(s).toEqual({ phase: 'access-error', user: A, kind: 'household-missing' });
  });
  it('offline NE briše pristup, ali ga označava nepotvrđenim i čuva vrijeme zadnje potvrde', () => {
    const s = sessionReducer(member(), {
      type: 'revalidated',
      uid: 'uidA',
      result: { status: 'error', kind: 'offline' },
      at: 2000,
    });
    expect(s).toEqual(member({ stale: true, verifiedAt: 1000 }));
  });
  it('uspješna revalidacija nakon offline vraća stale=false i novo vrijeme', () => {
    const s = sessionReducer(member({ stale: true }), {
      type: 'revalidated',
      uid: 'uidA',
      result: ok,
      at: 3000,
    });
    expect(s).toEqual(member({ stale: false, verifiedAt: 3000 }));
  });
  it('ponovljena offline greška ne mijenja stanje (isti objekt)', () => {
    const stale = member({ stale: true });
    expect(
      sessionReducer(stale, {
        type: 'revalidated',
        uid: 'uidA',
        result: { status: 'error', kind: 'unknown' },
        at: 9,
      }),
    ).toBe(stale);
  });
  it('zakašnjela revalidacija za drugog korisnika ili izvan member stanja se ignorira', () => {
    const m = member();
    expect(
      sessionReducer(m, { type: 'revalidated', uid: 'uidC', result: { status: 'denied' }, at: 1 }),
    ).toBe(m);
    const out: SessionState = { phase: 'signed-out', error: null, signingIn: false };
    expect(sessionReducer(out, { type: 'revalidated', uid: 'uidA', result: ok, at: 1 })).toBe(out);
  });
});

describe('sessionReducer — opoziv iz podatkovnog sloja (P2-B)', () => {
  it('revoked iz member => denied bez podataka kućanstva', () => {
    const s = sessionReducer(member({ householdName: 'Tajno' }), { type: 'revoked', uid: 'uidA' });
    expect(s).toEqual({ phase: 'denied', user: A });
    expect(JSON.stringify(s)).not.toContain('Tajno');
  });
  it('revoked za drugog korisnika ili izvan member stanja se ignorira', () => {
    const m = member();
    expect(sessionReducer(m, { type: 'revoked', uid: 'uidC' })).toBe(m);
    const out: SessionState = { phase: 'signed-out', error: null, signingIn: false };
    expect(sessionReducer(out, { type: 'revoked', uid: 'uidA' })).toBe(out);
  });
});
