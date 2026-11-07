import { useCallback, useEffect, useRef, useState } from 'react';
import { DomainError, isDomainError, type DomainCode } from './errors';
import type { InventoryState } from './gate';
import { messageFor } from './messages';
import type { InventoryPort, InventorySession } from './port';
import type { InventoryRepository, VerifyResult, VerifySpec } from './repository';

export type ActionStatus =
  | { kind: 'idle' }
  | { kind: 'saving'; label: string }
  /** Prikazuje se ISKLJUČIVO nakon što je poslužitelj potvrdio transakciju (promise je razriješen). */
  | { kind: 'saved'; label: string; at: number }
  | { kind: 'error'; message: string; code: DomainCode | 'generic' }
  /**
   * P2-C: 'outcome-unknown'. Ne tvrdi se ni uspjeh ni neuspjeh i NIŠTA se ne ponavlja automatski. `resolution`
   * nastaje tek korisnikovom radnjom "Provjeri stanje" (server-potvrđeno čitanje): 'not-applied' = promjena je
   * sigurno ODSUTNA na poslužitelju (novi izričiti pokušaj dopušten), 'offline' = provjera nije mogla doći do poslužitelja.
   */
  | {
      kind: 'unknown';
      label: string;
      verify: VerifySpec | null;
      checking: boolean;
      resolution: 'not-applied' | 'offline' | null;
    };

export interface RunOptions {
  /** Što provjeriti ako ishod ostane nepoznat. */
  verify?: VerifySpec;
  /** Poziva se kad provjera dokaže da je promjena ipak primijenjena (isto kao uspjeh). */
  onApplied?: () => void;
}

export type RunResult<T> = { ok: true; value: T } | { ok: false };

export interface UseInventory {
  opening: boolean;
  openError: string | null;
  inventory: InventoryState;
  repo: InventoryRepository | null;
  status: ActionStatus;
  busy: boolean;
  /**
   * Izvrši online operaciju; stanje 'saved' postavlja tek nakon potvrde poslužitelja.
   * Rezultat je EKSPLICITAN ({ ok }): `undefined` nije pouzdan znak neuspjeha jer i uspješne operacije mogu vratiti
   * ništa. Obrasci smiju obrisati korisnikov unos ISKLJUČIVO kad je ok === true (P2B-REV-02).
   */
  run<T>(
    label: string,
    fn: (repo: InventoryRepository) => Promise<T>,
    opts?: RunOptions,
  ): Promise<RunResult<T>>;
  /** Korisnička radnja "Provjeri stanje" nakon nepoznatog ishoda. Nikad ne ponavlja upis. */
  checkUnknown(): Promise<VerifyResult | null>;
  /** Uklanja poruku o statusu (osim nerazriješenog nepoznatog ishoda, koji se mora provjeriti). */
  clearStatus(): void;
}

/**
 * Životni ciklus podatkovne sesije vezan uz React: pri mountu otvara IZOLIRANU sesiju i pretplatu; pri unmountu
 * (odjava, promjena računa, opoziv, ostanak bez članstva) ODMAH odjavljuje listenere i uništava sesiju (keš nestaje).
 * `onRevoked` se zove kad se otkrije opoziv (iz listenera ili iz operacije).
 */
export function useInventory(port: InventoryPort, onRevoked: () => void): UseInventory {
  const [opening, setOpening] = useState(true);
  const [openError, setOpenError] = useState<string | null>(null);
  const [inventory, setInventory] = useState<InventoryState>({ status: 'loading' });
  const [repo, setRepo] = useState<InventoryRepository | null>(null);
  const [status, setStatus] = useState<ActionStatus>({ kind: 'idle' });
  const statusRef = useRef<ActionStatus>(status);
  useEffect(() => {
    statusRef.current = status;
  });
  const [busy, setBusy] = useState(false);
  const revokedRef = useRef(onRevoked);
  useEffect(() => {
    revokedRef.current = onRevoked;
  });
  const busyRef = useRef(false);
  const onAppliedRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let session: InventorySession | null = null;
    let unwatch: (() => void) | null = null;
    // početno stanje (opening, loading, bez repozitorija) već je ispravno; komponenta se remounta po računu (key=uid)
    port.open().then(
      (s) => {
        if (cancelled) {
          void s.dispose(); // sesija otvorena nakon unmounta: odmah uništi
          return;
        }
        session = s;
        setRepo(s.repo);
        setOpening(false);
        unwatch = s.watch((state) => {
          if (cancelled) return;
          setInventory(state);
          if (state.status === 'revoked') revokedRef.current();
        });
      },
      (e) => {
        if (cancelled) return;
        setOpening(false);
        if (isDomainError(e) && e.code === 'access-revoked') revokedRef.current();
        else setOpenError(messageFor(e));
      },
    );
    return () => {
      cancelled = true;
      unwatch?.();
      unwatch = null;
      setRepo(null);
      setInventory({ status: 'loading' }); // nikakvi podaci ne ostaju u stanju
      void session?.dispose();
      session = null;
    };
  }, [port]);

  const run = useCallback(
    async <T>(
      label: string,
      fn: (r: InventoryRepository) => Promise<T>,
      opts?: RunOptions,
    ): Promise<RunResult<T>> => {
      if (!repo || busyRef.current) return { ok: false };
      busyRef.current = true;
      setBusy(true);
      setStatus({ kind: 'saving', label });
      try {
        const out = await fn(repo);
        onAppliedRef.current = undefined;
        setStatus({ kind: 'saved', label, at: Date.now() });
        return { ok: true, value: out };
      } catch (e) {
        if (isDomainError(e) && e.code === 'access-revoked') {
          setStatus({ kind: 'idle' }); // opoziv nije "greška spremanja": bez ikakvog statusa, panel se uklanja
          revokedRef.current();
          return { ok: false };
        }
        if (isDomainError(e) && e.code === 'outcome-unknown') {
          onAppliedRef.current = opts?.onApplied;
          setStatus({
            kind: 'unknown',
            label,
            verify: opts?.verify ?? null,
            checking: false,
            resolution: null,
          });
          return { ok: false };
        }
        setStatus({
          kind: 'error',
          message: messageFor(e),
          code: isDomainError(e) ? e.code : 'generic',
        });
        return { ok: false };
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [repo],
  );

  const checkUnknown = useCallback(async (): Promise<VerifyResult | null> => {
    const cur = statusRef.current;
    if (!repo || cur.kind !== 'unknown' || cur.checking || busyRef.current) return null;
    const spec = cur.verify;
    if (!spec) return null; // nema se što provjeriti: ostaje neodređeno
    setStatus({ ...cur, checking: true });
    try {
      const r = await repo.verify(spec);
      if (r === 'applied') {
        const done = onAppliedRef.current;
        onAppliedRef.current = undefined;
        setStatus({ kind: 'saved', label: cur.label, at: Date.now() });
        done?.();
      } else if (r === 'not-applied') {
        setStatus({ ...cur, checking: false, resolution: 'not-applied' });
      } else if (r === 'changed-elsewhere') {
        onAppliedRef.current = undefined;
        setStatus({
          kind: 'error',
          code: 'changed-elsewhere',
          message: messageFor(new DomainError('changed-elsewhere')),
        });
      } else {
        setStatus({ ...cur, checking: false, resolution: 'offline' });
      }
      return r;
    } catch (e) {
      if (isDomainError(e) && e.code === 'access-revoked') {
        setStatus({ kind: 'idle' });
        revokedRef.current();
        return null;
      }
      setStatus({ ...cur, checking: false, resolution: 'offline' });
      return 'unknown';
    }
  }, [repo]);

  const clearStatus = useCallback(() => {
    setStatus((s) =>
      s.kind === 'unknown' && s.resolution !== 'not-applied' ? s : { kind: 'idle' },
    );
  }, []);

  return { opening, openError, inventory, repo, status, busy, run, checkUnknown, clearStatus };
}
