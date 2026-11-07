import { useEffect, useRef, type MutableRefObject, type ReactNode } from 'react';
import type { ActionStatus } from '../../inventory/useInventory';
import { GLYPH } from './model';
import type { Location } from '../../inventory/types';
import { useApp } from './ctx';

export function ScreenHead({ title, onBack }: { title: string; onBack?: () => void }) {
  const { nav } = useApp();
  return (
    <div className="pagenav">
      <button type="button" className="back" aria-label="Natrag" onClick={onBack ?? nav.back}>
        ‹
      </button>
      <h1 className="page-title">{title}</h1>
    </div>
  );
}

export function Missing() {
  return (
    <>
      <ScreenHead title="Nije pronađeno" />
      <div className="empty" role="status">
        Odabrani podatak više nije dostupan.
      </div>
    </>
  );
}

/** Poruke o statusu operacije (UX-033-04). "Spremljeno" postoji ISKLJUČIVO nakon potvrde poslužitelja. */
export function StatusBanner({
  status,
  onCheck,
  onClose,
  onRetry,
  onAbandon,
  hideSaved,
}: {
  status: ActionStatus;
  onCheck: () => void;
  onClose: () => void;
  onRetry: () => void;
  onAbandon: () => void;
  hideSaved?: boolean;
}) {
  switch (status.kind) {
    case 'idle':
      return null;
    case 'saving':
      return (
        <div className="inline-status saving" role="status" data-testid="inv-status">
          ◷ Spremanje… čeka se potvrda poslužitelja
        </div>
      );
    case 'saved':
      if (hideSaved) return null; // prikaz više nije potvrđen: stara poruka bi zbunjivala
      return (
        <div className="inline-status saved" role="status" data-testid="inv-status">
          ✓ Spremljeno · potvrđeno online
        </div>
      );
    case 'error':
      return (
        <div
          className={`inline-status ${status.code === 'changed-elsewhere' ? 'conflict' : 'error'}`}
          role="alert"
          data-testid="inv-status"
        >
          ⚠ {status.message}
          <div className="actions">
            <button type="button" className="btn secondary" onClick={onClose}>
              Zatvori poruku
            </button>
          </div>
        </div>
      );
    case 'unknown':
      return (
        <div className="inline-status unknown" role="alert" data-testid="inv-status">
          ? Veza je prekinuta tijekom potvrđivanja. Promjena je možda spremljena. Ne ponavljaj je
          prije provjere.
          {status.resolution === 'not-applied' && (
            <p data-testid="verify-result">
              Provjera: u trenutku čitanja sa poslužitelja promjena NIJE pronađena. To ne dokazuje
              da zakašnjeli upis nikad neće stići.
              {status.retryable
                ? ' Ponovni pokušaj koristi ISTE ID-eve i ISTE parametre pa ne može stvoriti duplikat.'
                : ' Unos je sačuvan.'}
            </p>
          )}
          {status.resolution === 'offline' && (
            <p data-testid="verify-result">
              Provjera nije moguća dok nema veze s poslužiteljem. Ništa se ne ponavlja automatski.
            </p>
          )}
          <div className="actions">
            {status.verify && status.resolution !== 'not-applied' && (
              <button
                type="button"
                className="btn primary"
                onClick={onCheck}
                disabled={status.checking}
              >
                {status.checking ? 'Provjeravamo…' : 'Provjeri stanje'}
              </button>
            )}
            {status.resolution === 'not-applied' && status.retryable && (
              <>
                <button type="button" className="btn primary" onClick={onRetry}>
                  Ponovi isti pokušaj
                </button>
                <button type="button" className="btn secondary" onClick={onAbandon}>
                  Odustani od pokušaja
                </button>
                <button type="button" className="btn secondary" onClick={onCheck}>
                  Provjeri ponovno
                </button>
              </>
            )}
            {status.resolution === 'not-applied' && !status.retryable && (
              <button type="button" className="btn secondary" onClick={onClose}>
                Zatvori poruku
              </button>
            )}
          </div>
        </div>
      );
  }
}

/** Dijalog UX-032-01. Escape/Natrag = "Ostani ovdje". Fokus ulazi u dijalog i vraća se na prethodni element. */
export function UnsavedDialog({
  saving,
  onChoose,
}: {
  saving: boolean;
  onChoose: (what: 'save' | 'discard' | 'stay') => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    first.current?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div className="modal-layer" role="presentation">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        data-testid="unsaved-dialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onChoose('stay');
        }}
      >
        <h2 id="dialog-title">Nespremljene izmjene</h2>
        <p>Promijenio/la si podatke. Što želiš napraviti prije izlaska?</p>
        <div className="dialog-actions">
          <button
            ref={first}
            type="button"
            className="btn primary full"
            disabled={saving}
            onClick={() => onChoose('save')}
          >
            {saving ? 'Spremanje…' : 'Spremi promjene pa nastavi'}
          </button>
          <button
            type="button"
            className="btn secondary full"
            disabled={saving}
            onClick={() => onChoose('discard')}
          >
            Odbaci izmjene
          </button>
          <button
            type="button"
            className="btn secondary full"
            disabled={saving}
            onClick={() => onChoose('stay')}
          >
            Ostani ovdje
          </button>
        </div>
      </div>
    </div>
  );
}

export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string | null;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error && (
        <span className="field-error" id={`${id}-err`} role="alert">
          {error}
        </span>
      )}
      {hint && <small className="hint">{hint}</small>}
    </div>
  );
}

export function LocGlyph({ loc }: { loc: Location }) {
  return <span aria-hidden="true">{GLYPH[loc.kind] ?? '📦'}</span>;
}

/** true dok je zaslon (obrazac) još prikazan — odgođena potvrda ishoda smije navigirati samo ako korisnik nije otišao. */
export function useMounted(): MutableRefObject<boolean> {
  const ref = useRef(true);
  useEffect(() => {
    ref.current = true;
    return () => {
      ref.current = false;
    };
  }, []);
  return ref;
}
