import { useMemo, useSyncExternalStore } from 'react';
import { readFirebaseConfig } from '../config/env';
import type { Services } from '../auth/types';
import { useSession } from '../auth/useSession';
import { createFirebaseServices } from '../firebase/client';
import {
  AccessError,
  CheckingAccess,
  ConfigMissing,
  Denied,
  Initializing,
  Member,
  SignIn,
} from './screens';

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

let singleton: Services | null = null;
function defaultServices(): { services: Services } | { missing: string[] } {
  const cfg = readFirebaseConfig(import.meta.env);
  if (cfg.status === 'missing') return { missing: cfg.missing };
  singleton ??= createFirebaseServices(cfg.config, cfg.householdId);
  return { services: singleton };
}

function Session({ services }: { services: Services }) {
  const { state, signIn, signOut, recheck, signOutFailed } = useSession(services);
  switch (state.phase) {
    case 'initializing':
      return <Initializing />;
    case 'signed-out':
      return <SignIn error={state.error} signingIn={state.signingIn} onSignIn={signIn} />;
    case 'checking-access':
      return <CheckingAccess />;
    case 'member':
      return (
        <Member
          householdName={state.householdName}
          displayName={state.user.displayName}
          onSignOut={signOut}
          signOutFailed={signOutFailed}
        />
      );
    case 'denied':
      return <Denied uid={state.user.uid} onRecheck={recheck} onSignOut={signOut} />;
    case 'access-error':
      return <AccessError kind={state.kind} onRecheck={recheck} onSignOut={signOut} />;
  }
}

/** PRIVREMENI neutralni prikaz (P1). Konačni UI/UX dolazi iz zasebnog handoffa. */
export function App({ services }: { services?: Services }) {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine);
  const resolved = useMemo(() => (services ? { services } : defaultServices()), [services]);

  return (
    <main className="shell">
      <h1>Kućni inventar</h1>
      <p data-testid="network">{online ? 'online' : 'offline'}</p>
      {'services' in resolved ? (
        <Session services={resolved.services} />
      ) : (
        <ConfigMissing missing={resolved.missing} />
      )}
    </main>
  );
}
