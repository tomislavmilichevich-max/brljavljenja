import { useMemo, useSyncExternalStore } from 'react';
import { readFirebaseConfig } from '../config/env';
import type { Services } from '../auth/types';
import { useSession } from '../auth/useSession';
import { createFirebaseServices } from '../firebase/client';
import { InventoryApp } from './ui/InventoryApp';
import {
  AccessError,
  CheckingAccess,
  ConfigMissing,
  Denied,
  Initializing,
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

function Session({ services, online }: { services: Services; online: boolean }) {
  const { state, signIn, signOut, recheck, revoke, signOutFailed } = useSession(services);
  switch (state.phase) {
    case 'initializing':
      return <Initializing />;
    case 'signed-out':
      return <SignIn error={state.error} signingIn={state.signingIn} onSignIn={signIn} />;
    case 'checking-access':
      return <CheckingAccess />;
    case 'member':
      // key=uid: promjena računa ODMAH uništava staru podatkovnu sesiju (listeneri + keš) i otvara novu
      return (
        <InventoryApp
          key={state.user.uid}
          port={services.data}
          onRevoked={revoke}
          online={online}
          account={{
            householdName: state.householdName,
            displayName: state.user.displayName,
            verifiedAt: state.verifiedAt,
            stale: state.stale,
            onRecheck: recheck,
            onSignOut: signOut,
            signOutFailed,
          }}
        />
      );
    case 'denied':
      return (
        <Denied
          uid={state.user.uid}
          revoked={state.revoked === true}
          onRecheck={recheck}
          onSignOut={signOut}
        />
      );
    case 'access-error':
      return <AccessError kind={state.kind} onRecheck={recheck} onSignOut={signOut} />;
  }
}

/** Završni Organized Cozy prikaz (P2-C). Prijava, provjera pristupa i inventar zadržavaju P1/P2-B jamstva. */
export function App({ services }: { services?: Services }) {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine);
  const resolved = useMemo(() => (services ? { services } : defaultServices()), [services]);

  return (
    <div className="shell">
      <div className="app-wrap">
        <span className="sr-only" data-testid="network">
          {online ? 'online' : 'offline'}
        </span>
        {'services' in resolved ? (
          <Session services={resolved.services} online={online} />
        ) : (
          <ConfigMissing missing={resolved.missing} />
        )}
      </div>
    </div>
  );
}
