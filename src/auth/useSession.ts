import { useCallback, useEffect, useReducer, useState } from 'react';
import { classifyAuthError } from './errors';
import { initialSession, sessionReducer } from './session';
import type { AccessResult, Services } from './types';

/** Najkraći razmak između dviju revalidacija pokrenutih povratkom u prvi plan (štiti kvotu čitanja). */
export const REVALIDATE_MIN_INTERVAL_MS = 15_000;
/** Rijetki sigurnosni timer (samo dok je aplikacija vidljiva): ≤ 6 čitanja/h po aktivnom uređaju. */
export const REVALIDATE_INTERVAL_MS = 10 * 60_000;

export function useSession(services: Services) {
  const [state, dispatch] = useReducer(sessionReducer, initialSession);
  const [signOutFailed, setSignOutFailed] = useState(false);

  // Pretplata na Firebase Auth stanje.
  useEffect(() => {
    return services.auth.subscribe(
      (user) => dispatch({ type: 'user', user }),
      (kind) => dispatch({ type: 'sign-in-error', kind }),
    );
  }, [services]);

  // Provjera članstva — pokreće se samo za prijavljenog korisnika; odluku donose Security Rules.
  const checkingUid = state.phase === 'checking-access' ? state.user.uid : null;
  useEffect(() => {
    if (!checkingUid) return;
    let cancelled = false;
    services.access.checkAccess().then(
      (result) =>
        !cancelled && dispatch({ type: 'access', uid: checkingUid, result, at: Date.now() }),
      () =>
        !cancelled &&
        dispatch({
          type: 'access',
          uid: checkingUid,
          result: { status: 'error', kind: 'unknown' },
          at: Date.now(),
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [checkingUid, services]);

  // Revalidacija TIJEKOM otvorene sesije (P1-REV-02): opoziv članstva ne smije ostati nevidljiv.
  // Bez pollinga: okidači su povratak aplikacije u prvi plan, oporavak mreže i vrlo rijedak timer
  // koji radi samo dok je aplikacija vidljiva. Odbijanje s poslužitelja uklanja odobrenje;
  // nedostupan poslužitelj označava prikaz kao nepotvrđen (offline rad se ne blokira).
  const memberUid = state.phase === 'member' ? state.user.uid : null;
  useEffect(() => {
    if (!memberUid) return;
    let cancelled = false;
    let inflight = false;
    let lastAttempt = Date.now();
    const run = async (force: boolean) => {
      if (cancelled || inflight) return;
      if (!force && Date.now() - lastAttempt < REVALIDATE_MIN_INTERVAL_MS) return;
      inflight = true;
      lastAttempt = Date.now();
      let result: AccessResult;
      try {
        result = await services.access.checkAccess();
      } catch {
        result = { status: 'error', kind: 'unknown' };
      } finally {
        inflight = false;
      }
      if (!cancelled) dispatch({ type: 'revalidated', uid: memberUid, result, at: Date.now() });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void run(false);
    };
    const onOnline = () => void run(true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        if (document.visibilityState === 'visible') void run(true);
        schedule();
      }, REVALIDATE_INTERVAL_MS);
    };
    schedule();
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      clearTimeout(timer);
    };
  }, [memberUid, services]);

  // Kad se mreža vrati, automatski ponovi neuspjelu provjeru.
  const offlineError = state.phase === 'access-error' && state.kind === 'offline';
  useEffect(() => {
    if (!offlineError) return;
    const onOnline = () => dispatch({ type: 'recheck' });
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [offlineError]);

  const signIn = useCallback(async () => {
    dispatch({ type: 'sign-in-started' });
    try {
      await services.auth.signIn();
    } catch (e) {
      dispatch({ type: 'sign-in-error', kind: classifyAuthError(e) });
    }
  }, [services]);

  const signOut = useCallback(async () => {
    setSignOutFailed(false);
    try {
      await services.auth.signOut();
    } catch {
      setSignOutFailed(true);
    }
  }, [services]);

  const recheck = useCallback(() => dispatch({ type: 'recheck' }), []);
  const memberUidForRevoke = state.phase === 'member' ? state.user.uid : null;
  const revoke = useCallback(() => {
    if (memberUidForRevoke) dispatch({ type: 'revoked', uid: memberUidForRevoke });
  }, [memberUidForRevoke]);

  return { state, signIn, signOut, recheck, revoke, signOutFailed };
}
