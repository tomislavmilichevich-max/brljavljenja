import { useCallback, useEffect, useRef, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'locations' }
  | { name: 'location'; id: string }
  | { name: 'item'; id: string }
  | { name: 'add-item'; locationId?: string }
  | { name: 'edit-item'; id: string }
  | { name: 'move-item'; id: string; placementId?: string }
  | { name: 'add-location'; parentId?: string }
  | { name: 'edit-location'; id: string }
  | { name: 'move-location'; id: string }
  | { name: 'add-placement'; id: string }
  | { name: 'more' };

export type Tab = 'home' | 'locations' | 'add' | 'more';
export const tabOf = (r: Route): Tab => {
  switch (r.name) {
    case 'home':
    case 'item':
    case 'edit-item':
    case 'move-item':
    case 'add-placement':
      return 'home';
    case 'locations':
    case 'location':
    case 'add-location':
    case 'edit-location':
    case 'move-location':
      return 'locations';
    case 'add-item':
      return 'add';
    case 'more':
      return 'more';
  }
};

/** Zaštita nespremljenih izmjena (UX-032-01): obrazac se registrira dok ima izmjena. */
export interface LeaveGuard {
  dirty: boolean;
  /** Pokušaj spremiti online; true tek nakon potvrde poslužitelja. */
  save: () => Promise<boolean>;
}

export interface Navigator {
  route: Route;
  depth: number;
  go: (r: Route, opts?: { replace?: boolean; keepStatus?: boolean }) => void;
  /** Kartica donje navigacije: Početna = [home], ostalo = [home, kartica] (Natrag vodi na Početnu). */
  goTab: (r: Route) => void;
  back: () => void;
  setGuard: (g: LeaveGuard | null) => void;
  /** Dijalog "Nespremljene izmjene" (null kad nije otvoren). */
  pending: PendingLeave | null;
  saving: boolean;
  choose: (what: 'save' | 'discard' | 'stay') => Promise<void>;
}
export interface PendingLeave {
  proceed: () => void;
}

/**
 * Navigacija u memoriji + Android Back: u povijest preglednika stavlja jedan "sentinel" zapis dok je stog dublji od
 * jedne razine; pritisak Natrag (popstate) obrađuje se u aplikaciji (kroz zaštitu nespremljenih izmjena), a tek s
 * Početne Natrag napušta aplikaciju. Nikakvi podaci se ne stavljaju u URL niti u povijest.
 */
export function useNavigator(onNavigate: (keepStatus: boolean) => void): Navigator {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const [pending, setPending] = useState<PendingLeave | null>(null);
  const [saving, setSaving] = useState(false);
  const stackRef = useRef(stack);
  const guardRef = useRef<LeaveGuard | null>(null);
  const pendingRef = useRef<PendingLeave | null>(null);
  const sentinel = useRef(false);
  const onNav = useRef(onNavigate);
  useEffect(() => {
    stackRef.current = stack;
    onNav.current = onNavigate;
    pendingRef.current = pending;
  });

  const ensureSentinel = useCallback(() => {
    if (!sentinel.current) {
      try {
        window.history.pushState({ kucniInventar: 1 }, '');
        sentinel.current = true;
      } catch {
        /* povijest nedostupna: Natrag u aplikaciji radi samo preko gumba */
      }
    }
  }, []);

  const commit = useCallback(
    (next: Route[], keepStatus: boolean) => {
      setStack(next);
      stackRef.current = next;
      onNav.current(keepStatus);
      if (next.length > 1) ensureSentinel();
      window.scrollTo?.(0, 0);
    },
    [ensureSentinel],
  );

  /** Izvrši navigaciju, ali ako obrazac ima nespremljene izmjene, najprije pitaj korisnika. */
  const guarded = useCallback((proceed: () => void) => {
    if (guardRef.current?.dirty) setPending({ proceed });
    else proceed();
  }, []);

  const go = useCallback<Navigator['go']>(
    (r, opts) =>
      guarded(() => {
        const cur = stackRef.current;
        commit(opts?.replace ? [...cur.slice(0, -1), r] : [...cur, r], opts?.keepStatus ?? false);
      }),
    [commit, guarded],
  );
  const goTab = useCallback<Navigator['goTab']>(
    (r) =>
      guarded(() => commit(r.name === 'home' ? [{ name: 'home' }] : [{ name: 'home' }, r], false)),
    [commit, guarded],
  );
  const popOne = useCallback(
    () =>
      guarded(() => {
        const cur = stackRef.current;
        if (cur.length > 1) commit(cur.slice(0, -1), false);
      }),
    [commit, guarded],
  );
  const back = useCallback(() => {
    if (stackRef.current.length > 1) popOne();
  }, [popOne]);

  // Android Back / gumb Natrag preglednika
  useEffect(() => {
    const onPop = () => {
      sentinel.current = false; // preglednik je potrošio naš zapis
      if (pendingRef.current) {
        // otvoren dijalog: Natrag = "Ostani ovdje"
        setPending(null);
        ensureSentinel();
        return;
      }
      if (stackRef.current.length > 1) {
        popOne();
        // ako nas zaštita zadržava ili još ima razina, sentinel mora ostati
        if (stackRef.current.length > 1 || guardRef.current?.dirty) ensureSentinel();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [popOne, ensureSentinel]);

  const setGuard = useCallback((g: LeaveGuard | null) => {
    guardRef.current = g;
  }, []);

  const choose = useCallback<Navigator['choose']>(async (what) => {
    const p = pendingRef.current;
    if (!p) return;
    if (what === 'stay') {
      setPending(null);
      return;
    }
    if (what === 'discard') {
      guardRef.current = null; // odbacuje se SAMO lokalni nacrt
      setPending(null);
      p.proceed();
      return;
    }
    const g = guardRef.current;
    if (!g) return;
    setSaving(true);
    const ok = await g.save().catch(() => false);
    setSaving(false);
    if (ok) {
      guardRef.current = null;
      setPending(null);
      p.proceed();
    } else {
      setPending(null); // spremanje nije uspjelo: ostaje na obrascu, tekst je sačuvan, poruka je u statusu
    }
  }, []);

  return {
    route: stack[stack.length - 1]!,
    depth: stack.length,
    go,
    goTab,
    back,
    setGuard,
    pending,
    saving,
    choose,
  };
}
