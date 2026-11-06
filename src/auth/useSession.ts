import { useCallback, useEffect, useReducer, useState } from 'react';
import { classifyAuthError } from './errors';
import { initialSession, sessionReducer } from './session';
import type { Services } from './types';

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
      (result) => !cancelled && dispatch({ type: 'access', uid: checkingUid, result }),
      () =>
        !cancelled &&
        dispatch({
          type: 'access',
          uid: checkingUid,
          result: { status: 'error', kind: 'unknown' },
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [checkingUid, services]);

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

  return { state, signIn, signOut, recheck, signOutFailed };
}
