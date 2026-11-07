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
   * nastaje tek korisnikovom radnjom "Provjeri stanje" (server-potvrđeno čitanje): 'not-applied' = promjena je bila
   * ODSUTNA u trenutku server-potvrđenog čitanja (NE dokazuje da zakašnjeli upis nikad neće stići), 'offline' = provjera
   * nije mogla doći do poslužitelja.
   *
   * P2C-REV-01: ovo stanje je session-scoped REGISTAR nerazriješenog pokušaja (živi u ovom hooku = uz aktivnu podatkovnu
   * sesiju i UID; nestaje pri odjavi, promjeni UID-a, opozivu i osvježavanju stranice — nema trajne pohrane). Čuva
   * identitet pokušaja i izvorne parametre (zatvorenje funkcije), pa preživljava navigaciju i napuštanje obrasca.
   * `retryable`: operacija je idempotentna po ID-evima pokušaja, pa je "Ponovi isti pokušaj" siguran (isti ID-evi i
   * parametri). Dok je pokušaj nerazriješen, novi upisi su blokirani.
   */
  | {
      kind: 'unknown';
      label: string;
      verify: VerifySpec | null;
      checking: boolean;
      resolution: 'not-applied' | 'offline' | null;
      retryable: boolean;
    };

export interface RunOptions {
  /** Što provjeriti ako ishod ostane nepoznat. */
  verify?: VerifySpec;
  /**
   * Operacija je idempotentna po unaprijed sačuvanim ID-evima (createItemWithPlacement, createLocation, addPlacement):
   * nakon nepoznatog ishoda korisnik smije IZRIČITO ponoviti ISTI pokušaj (iste ID-eve i iste parametre).
   */
  idempotent?: boolean;
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
  /** "Ponovi isti pokušaj": izvršava ISTU spremljenu operaciju (isti ID-evi, isti parametri). Samo izričitom radnjom. */
  retryUnknown(): Promise<RunResult<unknown> | null>;
  /** Izričito odustajanje od nerazriješenog pokušaja (korisnik prihvaća da zakašnjeli upis ipak može stići). */
  abandonUnknown(): void;
  /** Raste pri svakom odustajanju: obrasci tada moraju generirati NOVE ID-eve pokušaja. */
  epoch: number;
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
  // ref se mijenja SINKRONO uz svaku promjenu statusa (pasivni efekti kasne, a korisnička radnja može doći odmah)
  const put = useCallback((next: ActionStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);
  const [busy, setBusy] = useState(false);
  const revokedRef = useRef(onRevoked);
  useEffect(() => {
    revokedRef.current = onRevoked;
  });
  const busyRef = useRef(false);
  const onAppliedRef = useRef<(() => void) | undefined>(undefined);
  const retryRef = useRef<{
    label: string;
    fn: (r: InventoryRepository) => Promise<unknown>;
    opts?: RunOptions;
  } | null>(null);
  const [epoch, setEpoch] = useState(0);

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
      retryRef.current = null; // registar nerazriješenog pokušaja ne smije preživjeti sesiju (odjava/UID/opoziv)
      onAppliedRef.current = undefined;
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
      put({ kind: 'saving', label });
      try {
        const out = await fn(repo);
        onAppliedRef.current = undefined;
        retryRef.current = null;
        put({ kind: 'saved', label, at: Date.now() });
        return { ok: true, value: out };
      } catch (e) {
        if (isDomainError(e) && e.code === 'access-revoked') {
          put({ kind: 'idle' }); // opoziv nije "greška spremanja": bez ikakvog statusa, panel se uklanja
          revokedRef.current();
          return { ok: false };
        }
        if (isDomainError(e) && e.code === 'outcome-unknown') {
          onAppliedRef.current = opts?.onApplied;
          retryRef.current = { label, fn, opts };
          put({
            kind: 'unknown',
            label,
            verify: opts?.verify ?? null,
            checking: false,
            resolution: null,
            retryable: opts?.idempotent === true,
          });
          return { ok: false };
        }
        put({
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
    [repo, put],
  );

  const checkUnknown = useCallback(async (): Promise<VerifyResult | null> => {
    const cur = statusRef.current;
    if (!repo || cur.kind !== 'unknown' || cur.checking || busyRef.current) return null;
    const spec = cur.verify;
    if (!spec) return null; // nema se što provjeriti: ostaje neodređeno
    put({ ...cur, checking: true });
    try {
      const r = await repo.verify(spec);
      if (r === 'applied') {
        const done = onAppliedRef.current;
        onAppliedRef.current = undefined;
        retryRef.current = null;
        put({ kind: 'saved', label: cur.label, at: Date.now() });
        done?.();
      } else if (r === 'not-applied') {
        put({ ...cur, checking: false, resolution: 'not-applied' });
      } else if (r === 'changed-elsewhere') {
        onAppliedRef.current = undefined;
        retryRef.current = null;
        put({
          kind: 'error',
          code: 'changed-elsewhere',
          message: messageFor(new DomainError('changed-elsewhere')),
        });
      } else {
        put({ ...cur, checking: false, resolution: 'offline' });
      }
      return r;
    } catch (e) {
      if (isDomainError(e) && e.code === 'access-revoked') {
        put({ kind: 'idle' });
        revokedRef.current();
        return null;
      }
      put({ ...cur, checking: false, resolution: 'offline' });
      return 'unknown';
    }
  }, [repo, put]);

  const retryUnknown = useCallback(async (): Promise<RunResult<unknown> | null> => {
    const cur = statusRef.current;
    const saved = retryRef.current;
    if (cur.kind !== 'unknown' || !cur.retryable || cur.resolution !== 'not-applied' || !saved)
      return null;
    const done = onAppliedRef.current;
    // run() ponovno pohranjuje isti zapis ako ishod opet bude nepoznat; uspjeh ga briše
    const res = await run(saved.label, saved.fn, saved.opts);
    if (res.ok) done?.();
    return res;
  }, [run]);

  const abandonUnknown = useCallback(() => {
    if (statusRef.current.kind !== 'unknown') return;
    retryRef.current = null;
    onAppliedRef.current = undefined;
    setEpoch((n) => n + 1);
    put({ kind: 'idle' });
  }, [put]);

  const clearStatus = useCallback(() => {
    // nerazriješen pokušaj se ne smije "zatvoriti" navigacijom; samo ne-ponovljiv, već provjeren ('not-applied') smije
    const s = statusRef.current;
    if (!(s.kind === 'unknown' && !(s.resolution === 'not-applied' && !s.retryable)))
      put({ kind: 'idle' });
  }, [put]);

  return {
    opening,
    openError,
    inventory,
    repo,
    status,
    busy,
    run,
    checkUnknown,
    retryUnknown,
    abandonUnknown,
    epoch,
    clearStatus,
  };
}
