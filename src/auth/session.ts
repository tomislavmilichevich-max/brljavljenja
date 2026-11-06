import type { AccessErrorKind, AccessResult, SessionUser, SignInErrorKind } from './types';

/** Stanja sučelja iz P1_HANDOFF: prijava, provjera pristupa, odobren, nema pristupa, greška/mreža. */
export type SessionState =
  | { phase: 'initializing' }
  | { phase: 'signed-out'; error: SignInErrorKind | null; signingIn: boolean }
  | { phase: 'checking-access'; user: SessionUser }
  | {
      phase: 'member';
      user: SessionUser;
      householdName: string | null;
      /** Kada je pristup zadnji put POTVRĐEN S POSLUŽITELJA (ms). */
      verifiedAt: number;
      /** true = zadnja revalidacija nije uspjela doći do poslužitelja (offline/greška): prikaz nije svježe potvrđen. */
      stale: boolean;
    }
  | { phase: 'denied'; user: SessionUser }
  | { phase: 'access-error'; user: SessionUser; kind: AccessErrorKind };

export type SessionEvent =
  | { type: 'user'; user: SessionUser | null }
  | { type: 'access'; uid: string; result: AccessResult; at: number }
  /** Ponovna provjera tijekom otvorene sesije (povratak u prvi plan, mreža, rijedak timer). */
  | { type: 'revalidated'; uid: string; result: AccessResult; at: number }
  | { type: 'sign-in-started' }
  | { type: 'sign-in-error'; kind: SignInErrorKind }
  | { type: 'recheck' };

export const initialSession: SessionState = { phase: 'initializing' };

/**
 * Čisti reducer. Ključna svojstva (testirana):
 *  - prijava != pristup: tek rezultat 'member' vodi u 'member';
 *  - odjava/promjena računa uvijek briše prethodni pristup (nema curenja podataka);
 *  - zakašnjeli rezultat provjere za DRUGI uid se ignorira;
 *  - revalidacija: odbijanje s poslužitelja UKLANJA odobrenje; nedostupnost poslužitelja NE briše ga,
 *    ali ga označava kao nepotvrđeno (stale) — offline korištenje nije blokirano, ali ni lažno "potvrđeno".
 */
export function sessionReducer(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'user':
      if (!event.user) return { phase: 'signed-out', error: null, signingIn: false };
      if ('user' in state && state.user.uid === event.user.uid) return state;
      return { phase: 'checking-access', user: event.user };
    case 'access': {
      if (state.phase !== 'checking-access' || state.user.uid !== event.uid) return state;
      const { user } = state;
      const r = event.result;
      if (r.status === 'member') {
        return {
          phase: 'member',
          user,
          householdName: r.householdName,
          verifiedAt: event.at,
          stale: false,
        };
      }
      if (r.status === 'denied') return { phase: 'denied', user };
      return { phase: 'access-error', user, kind: r.kind };
    }
    case 'revalidated': {
      if (state.phase !== 'member' || state.user.uid !== event.uid) return state;
      const { user } = state;
      const r = event.result;
      if (r.status === 'member') {
        return { ...state, householdName: r.householdName, verifiedAt: event.at, stale: false };
      }
      if (r.status === 'denied') return { phase: 'denied', user };
      if (r.kind === 'household-missing') return { phase: 'access-error', user, kind: r.kind };
      return state.stale ? state : { ...state, stale: true };
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
