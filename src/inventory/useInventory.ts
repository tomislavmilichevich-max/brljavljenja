import { useCallback, useEffect, useRef, useState } from 'react';
import { isDomainError } from './errors';
import type { InventoryState } from './gate';
import { messageFor } from './messages';
import type { InventoryPort, InventorySession } from './port';
import type { InventoryRepository } from './repository';

export type ActionStatus =
  | { kind: 'idle' }
  | { kind: 'saving'; label: string }
  /** Prikazuje se ISKLJUČIVO nakon što je poslužitelj potvrdio transakciju (promise je razriješen). */
  | { kind: 'saved'; label: string; at: number }
  | { kind: 'error'; message: string };

export interface UseInventory {
  opening: boolean;
  openError: string | null;
  inventory: InventoryState;
  repo: InventoryRepository | null;
  status: ActionStatus;
  busy: boolean;
  /** Izvrši online operaciju; stanje 'saved' postavlja tek nakon potvrde poslužitelja. */
  run<T>(label: string, fn: (repo: InventoryRepository) => Promise<T>): Promise<T | undefined>;
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
  const [busy, setBusy] = useState(false);
  const revokedRef = useRef(onRevoked);
  useEffect(() => {
    revokedRef.current = onRevoked;
  });
  const busyRef = useRef(false);

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
    ): Promise<T | undefined> => {
      if (!repo || busyRef.current) return undefined;
      busyRef.current = true;
      setBusy(true);
      setStatus({ kind: 'saving', label });
      try {
        const out = await fn(repo);
        setStatus({ kind: 'saved', label, at: Date.now() });
        return out;
      } catch (e) {
        if (isDomainError(e) && e.code === 'access-revoked') {
          setStatus({ kind: 'idle' }); // opoziv nije "greška spremanja": bez ikakvog statusa, panel se uklanja
          revokedRef.current();
          return undefined;
        }
        setStatus({ kind: 'error', message: messageFor(e) });
        return undefined;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [repo],
  );

  return { opening, openError, inventory, repo, status, busy, run };
}
