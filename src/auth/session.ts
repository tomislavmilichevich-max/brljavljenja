import type { AccessResult, SessionUser, SignInErrorKind } from './types';

/** Stanja sučelja iz P1_HANDOFF: prijava, provjera pristupa, odobren, nema pristupa, greška/mreža. */
export type SessionState =
  | { phase: 'initializing' }
  | { phase: 'signed-out'; error: SignInErrorKind | null; signingIn: boolean }
  | { phase: 'checking-access'; user: SessionUser }
  | { phase: 'member'; user: SessionUser; householdName: string | null }
  | { phase: 'denied'; user: SessionUser }
  | { phase: 'access-error'; user: SessionUser; kind: 'offline' | 'unknown' };

export type SessionEvent =
  | { type: 'user'; user: SessionUser | null }
  | { type: 'access'; uid: string; result: AccessResult }
  | { type: 'sign-in-started' }
  | { type: 'sign-in-error'; kind: SignInErrorKind }
  | { type: 'recheck' };

export const initialSession: SessionState = { phase: 'initializing' };

/**
 * Čisti reducer. Ključna svojstva (testirana):
 *  - prijava != pristup: tek rezultat 'member' vodi u 'member';
 *  - odjava/promjena računa uvijek briše prethodni pristup (nema curenja podataka);
 *  - zakašnjeli rezultat provjere za DRUGI uid se ignorira.
 */
export function sessionReducer(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'user':
      if (!event.user) return { phase: 'signed-out', error: null, signingIn: false };
      if ('user' in state && state.user.uid === event.user.uid) return state;
      return { phase: 'checking-access', user: event.user };
    case 'access': {
      if (!('user' in state) || state.user.uid !== event.uid) return state;
      const { user } = state;
      const r = event.result;
      if (r.status === 'member') return { phase: 'member', user, householdName: r.householdName };
      if (r.status === 'denied') return { phase: 'denied', user };
      return { phase: 'access-error', user, kind: r.kind };
    }
    case 'recheck':
      return 'user' in state ? { phase: 'checking-access', user: state.user } : state;
    case 'sign-in-started':
      return { phase: 'signed-out', error: null, signingIn: true };
    case 'sign-in-error':
      return state.phase === 'signed-out' || state.phase === 'initializing'
        ? { phase: 'signed-out', error: event.kind, signingIn: false }
        : state;
  }
}
