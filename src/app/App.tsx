import { useSyncExternalStore } from 'react';
import { readFirebaseConfig } from '../config/env';

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/**
 * PRIVREMENI neutralni prikaz za P0 (dijagnostika infrastrukture).
 * Konačni UI/UX dolazi iz zasebnog handoffa — ovdje se ne donose dizajnerske odluke.
 */
export function App() {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine);
  const firebase = readFirebaseConfig(import.meta.env);

  return (
    <main className="shell">
      <h1>Kućni inventar</h1>
      <p>Tehnički pilot v0.0.1 — faza P0 (samo infrastruktura, bez funkcionalnosti inventara).</p>
      <dl>
        <dt>Mreža</dt>
        <dd data-testid="network">{online ? 'online' : 'offline'}</dd>
        <dt>Firebase konfiguracija</dt>
        <dd data-testid="firebase-config">
          {firebase.status === 'configured'
            ? 'postavljena'
            : `nije postavljena (nedostaje: ${firebase.missing.join(', ')})`}
        </dd>
        <dt>Prijava, inventar, sinkronizacija</dt>
        <dd>nije implementirano (P1+)</dd>
      </dl>
    </main>
  );
}
