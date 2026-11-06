import { useState } from 'react';
import type { AccessErrorKind, SignInErrorKind } from '../auth/types';

/**
 * PRIVREMENI neutralni ekrani za P1 (prijava / provjera / odobren / nema pristupa / greška).
 * Nije konačni dizajn — taj dolazi iz zasebnog UI/UX handoffa.
 */

const SIGN_IN_MESSAGES: Record<SignInErrorKind, string> = {
  cancelled: 'Prijava je otkazana. Pokušaj ponovno.',
  network: 'Nema veze s internetom ili poslužiteljem. Prijava nije izvršena.',
  'too-many-requests': 'Previše pokušaja. Pričekaj malo pa pokušaj ponovno.',
  unknown: 'Prijava nije uspjela. Pokušaj ponovno.',
};

export function ConfigMissing({ missing }: { missing: string[] }) {
  return (
    <section role="alert" aria-labelledby="t">
      <h2 id="t">Firebase nije podešen</h2>
      <p>
        Aplikacija nema Firebase konfiguraciju pa se prijava ne može pokrenuti. Upute su u
        docs/OWNER_ACTIONS.md. Nedostaje: {missing.join(', ')}.
      </p>
    </section>
  );
}

export function Initializing() {
  return <p role="status">Učitavanje…</p>;
}

export function SignIn(props: {
  error: SignInErrorKind | null;
  signingIn: boolean;
  onSignIn: () => void;
}) {
  return (
    <section aria-labelledby="t">
      <h2 id="t">Prijava</h2>
      <p>Prijavi se Google računom. Pristup kućanstvu odobrava vlasnik.</p>
      {props.error && <p role="alert">{SIGN_IN_MESSAGES[props.error]}</p>}
      <button type="button" onClick={props.onSignIn} disabled={props.signingIn}>
        {props.signingIn ? 'Prijava u tijeku…' : 'Prijava Google računom'}
      </button>
    </section>
  );
}

export function CheckingAccess() {
  return <p role="status">Provjera pristupa kućanstvu…</p>;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' });
}

export function Member(props: {
  householdName: string | null;
  displayName: string | null;
  verifiedAt: number;
  stale: boolean;
  onRecheck: () => void;
  onSignOut: () => void;
  signOutFailed: boolean;
}) {
  return (
    <section aria-labelledby="t">
      <h2 id="t">Pristup odobren</h2>
      {props.displayName && <p>Prijavljen/a: {props.displayName}</p>}
      <p data-testid="household-name">
        Kućanstvo: {props.householdName ?? '(dokument kućanstva nema naziv)'}
      </p>
      {props.stale ? (
        <p role="alert" data-testid="stale-warning">
          Pristup zadnji put potvrđen u {formatTime(props.verifiedAt)}. Trenutno ga nije moguće
          potvrditi (nema veze s poslužiteljem) pa prikaz može biti zastario. Provjera se ponavlja
          kad se veza vrati.
        </p>
      ) : (
        <p data-testid="verified-at">
          Pristup potvrđen sa servera u {formatTime(props.verifiedAt)}.
        </p>
      )}
      <p>Inventar još nije implementiran (P2).</p>
      {props.signOutFailed && <p role="alert">Odjava nije uspjela. Pokušaj ponovno.</p>}
      <p>
        <button type="button" onClick={props.onRecheck}>
          Provjeri pristup
        </button>{' '}
        <button type="button" onClick={props.onSignOut}>
          Odjava
        </button>
      </p>
    </section>
  );
}

export function Denied(props: { uid: string; onRecheck: () => void; onSignOut: () => void }) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.uid);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  };
  return (
    <section aria-labelledby="t">
      <h2 id="t">Nemaš pristup</h2>
      <p>
        Ovaj Google račun nije odobren za kućanstvo. Pošalji vlasniku svoj UID (nije tajna) da te
        doda u Firebase Console, a zatim pritisni „Provjeri ponovno“.
      </p>
      <label>
        Tvoj UID
        <input
          readOnly
          value={props.uid}
          data-testid="own-uid"
          onFocus={(e) => e.currentTarget.select()}
          style={{ width: '100%' }}
        />
      </label>
      <p>
        <button type="button" onClick={copy}>
          Kopiraj UID
        </button>{' '}
        {copied === 'ok' && <span role="status">Kopirano.</span>}
        {copied === 'failed' && (
          <span role="status">Kopiranje nije moguće — označi UID gore i kopiraj ručno.</span>
        )}
      </p>
      <p>
        <button type="button" onClick={props.onRecheck}>
          Provjeri ponovno
        </button>{' '}
        <button type="button" onClick={props.onSignOut}>
          Odjava
        </button>
      </p>
    </section>
  );
}

const ACCESS_ERROR_MESSAGES: Record<AccessErrorKind, string> = {
  offline:
    'Nema veze s poslužiteljem. Pristup nije potvrđen i ništa se ne prikazuje dok se veza ne vrati.',
  unknown: 'Došlo je do pogreške pri provjeri pristupa. Pristup nije potvrđen.',
  'household-missing':
    'Tvoje članstvo postoji, ali dokument kućanstva nije postavljen (nepotpuna priprema u Firebase Console). Pristup NIJE odobren. Javi se vlasniku.',
};

export function AccessError(props: {
  kind: AccessErrorKind;
  onRecheck: () => void;
  onSignOut: () => void;
}) {
  return (
    <section aria-labelledby="t">
      <h2 id="t">Provjera pristupa nije uspjela</h2>
      <p role="alert">{ACCESS_ERROR_MESSAGES[props.kind]}</p>
      <p>
        <button type="button" onClick={props.onRecheck}>
          Pokušaj ponovno
        </button>{' '}
        <button type="button" onClick={props.onSignOut}>
          Odjava
        </button>
      </p>
    </section>
  );
}
