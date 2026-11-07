import { useState, type ReactNode } from 'react';
import type { AccessErrorKind, SignInErrorKind } from '../auth/types';

/** Ekrani prije inventara (prijava / provjera / nema pristupa / greška) u Organized Cozy izgledu (P2-C). */

function Header() {
  return (
    <header className="top">
      <div className="brand">
        <span className="brandmark" aria-hidden="true">
          🏠
        </span>
        <span>Kućni inventar</span>
      </div>
    </header>
  );
}

function Card({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <>
      <Header />
      <main id="app" className="appview" tabIndex={-1}>
        <section className="authscreen" aria-labelledby="t">
          <div className="authicon" aria-hidden="true">
            {icon}
          </div>
          {children}
        </section>
      </main>
    </>
  );
}

const SIGN_IN_MESSAGES: Record<SignInErrorKind, string> = {
  cancelled: 'Prijava je otkazana. Pokušaj ponovno.',
  network: 'Nema veze s internetom ili poslužiteljem. Prijava nije izvršena.',
  'too-many-requests': 'Previše pokušaja. Pričekaj malo pa pokušaj ponovno.',
  unknown: 'Prijava nije uspjela. Pokušaj ponovno.',
};

export function ConfigMissing({ missing }: { missing: string[] }) {
  return (
    <Card icon="⚙">
      <div role="alert">
        <h1 id="t">Firebase nije podešen</h1>
        <p>
          Aplikacija nema Firebase konfiguraciju pa se prijava ne može pokrenuti. Upute su u
          docs/OWNER_ACTIONS.md. Nedostaje: {missing.join(', ')}.
        </p>
      </div>
    </Card>
  );
}

export function Initializing() {
  return (
    <>
      <Header />
      <p role="status" className="sub" style={{ textAlign: 'center' }}>
        Učitavanje…
      </p>
    </>
  );
}

export function SignIn(props: {
  error: SignInErrorKind | null;
  signingIn: boolean;
  onSignIn: () => void;
}) {
  return (
    <Card icon="🔒">
      <h1 id="t">Prijava</h1>
      <p className="sub">Prijavi se Google računom. Pristup kućanstvu odobrava vlasnik.</p>
      {props.error && <p role="alert">{SIGN_IN_MESSAGES[props.error]}</p>}
      <button
        type="button"
        className="btn primary"
        onClick={props.onSignIn}
        disabled={props.signingIn}
      >
        {props.signingIn ? 'Prijava u tijeku…' : 'Prijava Google računom'}
      </button>
    </Card>
  );
}

export function CheckingAccess() {
  return (
    <>
      <Header />
      <p role="status" className="sub" style={{ textAlign: 'center' }}>
        Provjera pristupa kućanstvu…
      </p>
    </>
  );
}

export function Denied(props: {
  uid: string;
  revoked?: boolean;
  onRecheck: () => void;
  onSignOut: () => void;
}) {
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
    <Card icon="🔒">
      <h1 id="t" data-testid={props.revoked ? 'access-revoked' : undefined}>
        {props.revoked ? 'Članstvo je opozvano' : 'Nemaš pristup'}
      </h1>
      <p className="sub">
        {props.revoked
          ? 'Inventar je uklonjen sa zaslona. Ponovna prijava zahtijeva važeći pristup. '
          : ''}
        Ovaj Google račun nije odobren za kućanstvo. Pošalji vlasniku svoj UID (nije tajna) da te
        doda u Firebase Console, a zatim pritisni „Provjeri ponovno“.
      </p>
      <div className="field" style={{ textAlign: 'left' }}>
        <label htmlFor="own-uid">Tvoj UID</label>
        <input
          id="own-uid"
          readOnly
          value={props.uid}
          data-testid="own-uid"
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>
      <div className="buttonrow" style={{ justifyContent: 'center', margin: '12px 0' }}>
        <button type="button" className="btn secondary" onClick={copy}>
          Kopiraj UID
        </button>
        {copied === 'ok' && <span role="status">Kopirano.</span>}
        {copied === 'failed' && (
          <span role="status">Kopiranje nije moguće — označi UID gore i kopiraj ručno.</span>
        )}
      </div>
      <div className="buttonrow" style={{ justifyContent: 'center' }}>
        <button type="button" className="btn primary" onClick={props.onRecheck}>
          Provjeri ponovno
        </button>
        <button type="button" className="btn secondary" onClick={props.onSignOut}>
          Odjava
        </button>
      </div>
    </Card>
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
    <Card icon="⌛">
      <h1 id="t">Provjera pristupa nije uspjela</h1>
      <p role="alert">{ACCESS_ERROR_MESSAGES[props.kind]}</p>
      <div className="buttonrow" style={{ justifyContent: 'center' }}>
        <button type="button" className="btn primary" onClick={props.onRecheck}>
          Pokušaj ponovno
        </button>
        <button type="button" className="btn secondary" onClick={props.onSignOut}>
          Odjava
        </button>
      </div>
    </Card>
  );
}
