import { describe, expect, it } from 'vitest';
import { initialSession, sessionReducer, type SessionState } from './session';

const A = { uid: 'uidA', displayName: 'A' };
const C = { uid: 'uidC', displayName: 'C' };

describe('sessionReducer', () => {
  it('prijavljen korisnik prvo ide u provjeru pristupa, ne u member', () => {
    expect(sessionReducer(initialSession, { type: 'user', user: A })).toEqual({
      phase: 'checking-access',
      user: A,
    });
  });
  it('member samo nakon rezultata member', () => {
    const s = sessionReducer(
      { phase: 'checking-access', user: A },
      { type: 'access', uid: 'uidA', result: { status: 'member', householdName: 'Dom' } },
    );
    expect(s).toEqual({ phase: 'member', user: A, householdName: 'Dom' });
  });
  it('denied i error rezultati', () => {
    const base: SessionState = { phase: 'checking-access', user: C };
    expect(
      sessionReducer(base, { type: 'access', uid: 'uidC', result: { status: 'denied' } }).phase,
    ).toBe('denied');
    expect(
      sessionReducer(base, {
        type: 'access',
        uid: 'uidC',
        result: { status: 'error', kind: 'offline' },
      }),
    ).toEqual({ phase: 'access-error', user: C, kind: 'offline' });
  });
  it('zakašnjeli rezultat za drugi uid se ignorira (nema curenja nakon promjene računa)', () => {
    const s: SessionState = { phase: 'checking-access', user: C };
    expect(
      sessionReducer(s, {
        type: 'access',
        uid: 'uidA',
        result: { status: 'member', householdName: 'Dom' },
      }),
    ).toBe(s);
  });
  it('rezultat nakon odjave se ignorira', () => {
    const s: SessionState = { phase: 'signed-out', error: null, signingIn: false };
    expect(
      sessionReducer(s, {
        type: 'access',
        uid: 'uidA',
        result: { status: 'member', householdName: 'Dom' },
      }),
    ).toBe(s);
  });
  it('odjava iz member uklanja household podatke', () => {
    const s = sessionReducer(
      { phase: 'member', user: A, householdName: 'Dom' },
      { type: 'user', user: null },
    );
    expect(s).toEqual({ phase: 'signed-out', error: null, signingIn: false });
    expect(JSON.stringify(s)).not.toContain('Dom');
  });
  it('promjena računa A -> C resetira na provjeru za C bez A-ovih podataka', () => {
    const s = sessionReducer(
      { phase: 'member', user: A, householdName: 'Dom' },
      { type: 'user', user: C },
    );
    expect(s).toEqual({ phase: 'checking-access', user: C });
  });
  it('ponovljeni događaj istog korisnika ne resetira stanje', () => {
    const s: SessionState = { phase: 'member', user: A, householdName: 'Dom' };
    expect(sessionReducer(s, { type: 'user', user: A })).toBe(s);
  });
  it('recheck iz denied vraća na provjeru', () => {
    expect(sessionReducer({ phase: 'denied', user: C }, { type: 'recheck' })).toEqual({
      phase: 'checking-access',
      user: C,
    });
  });
  it('greška prijave se prikazuje samo na ekranu prijave', () => {
    const s = sessionReducer(
      { phase: 'signed-out', error: null, signingIn: true },
      { type: 'sign-in-error', kind: 'network' },
    );
    expect(s).toEqual({ phase: 'signed-out', error: 'network', signingIn: false });
    const m: SessionState = { phase: 'member', user: A, householdName: null };
    expect(sessionReducer(m, { type: 'sign-in-error', kind: 'unknown' })).toBe(m);
  });
});
