import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type Auth,
} from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import type { FirebasePublicConfig } from '../config/env';
import { evaluateAccess } from '../auth/access';
import { classifyAuthError, shouldFallBackToRedirect } from '../auth/errors';
import type { AccessPort, AccessResult, AuthPort, Services } from '../auth/types';
import { createInventoryRepository } from '../inventory/repository';
import type { InventoryPort } from '../inventory/port';
import { watchInventory } from '../inventory/watch';
import { openDataSession, type EmulatorEndpoints } from './dataSession';

/** Emulatori samo u dev načinu i samo izričitom zastavicom — nikad u produkcijskom buildu. */
const useEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true';

interface Handles {
  app: FirebaseApp;
  auth: Auth;
}

const EMULATOR: EmulatorEndpoints | undefined = useEmulators
  ? { authUrl: 'http://127.0.0.1:9099', firestoreHost: '127.0.0.1', firestorePort: 8080 }
  : undefined;

function init(config: FirebasePublicConfig): Handles {
  const app = initializeApp(config);
  const auth = getAuth(app);
  // P2-B: primarna instanca NEMA Firestore (nema keša koji bi preživio odjavu). Sva čitanja/pisanja idu kroz
  // izolirane podatkovne sesije (dataSession.ts) koje se uništavaju pri odjavi/promjeni računa/opozivu.
  if (useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    // Samo za automatizirani e2e protiv emulatora (u produkcijskom buildu ovaj blok ne postoji jer je DEV=false).
    // Sandbox ne doseže apis.google.com pa se pravi popup ne može vrtjeti; emulator prima lažni Google token.
    (window as unknown as Record<string, unknown>).__e2eSignInWithEmulatorAccount = (
      name: string,
    ) =>
      signInWithCredential(
        auth,
        GoogleAuthProvider.credential(
          JSON.stringify({
            sub: `sub-${name}`,
            email: `${name}@example.test`,
            email_verified: true,
            name,
          }),
        ),
      );
  }
  return { app, auth };
}

function createAuthPort({ auth }: Handles): AuthPort {
  return {
    subscribe(onUser, onError) {
      // Rezultat redirect prijave (ako je bila); greške se prijavljuju, ne gutaju.
      getRedirectResult(auth).catch((e: unknown) => onError(classifyAuthError(e)));
      return onAuthStateChanged(
        auth,
        (u) => onUser(u ? { uid: u.uid, displayName: u.displayName } : null),
        (e) => onError(classifyAuthError(e)),
      );
    },
    async signIn() {
      // VAŽNO: nikakav `await` prije signInWithPopup — popup mora nastati sinkrono iz korisnikova dodira
      // (inače ga preglednici, osobito Chrome na Androidu, blokiraju). Zadana Auth perzistencija je trajna.
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        if (shouldFallBackToRedirect(e)) {
          await signInWithRedirect(auth, provider);
          return;
        }
        throw e;
      }
    },
    async signOut() {
      await fbSignOut(auth);
    },
  };
}

function createAccessPort(
  { auth }: Handles,
  config: FirebasePublicConfig,
  householdId: string,
): AccessPort {
  return {
    async checkAccess(): Promise<AccessResult> {
      // householdId je u konfiguraciji, ali NIJE autorizacija: odluku donose Security Rules.
      // Provjera ide kroz KRATKOTRAJNU izoliranu sesiju i getDocFromServer (NIKAD iz keša): ništa ne ostaje u
      // kešu nakon provjere, a offline se ne prikazuje 'odobren'.
      return evaluateAccess(async () => {
        const session = await openDataSession(auth, config, EMULATOR);
        try {
          const snap = await getDocFromServer(doc(session.db, 'households', householdId));
          const name = snap.exists() ? ((snap.data()?.name as string | undefined) ?? null) : null;
          return { exists: snap.exists(), name };
        } finally {
          await session.dispose();
        }
      });
    },
  };
}

function createInventoryPort(
  { auth }: Handles,
  config: FirebasePublicConfig,
  householdId: string,
): InventoryPort {
  return {
    async open() {
      const s = await openDataSession(auth, config, EMULATOR);
      return {
        uid: s.uid,
        repo: createInventoryRepository({ db: s.db, householdId, uid: s.uid }),
        watch: (onState) => watchInventory(s.db, householdId, onState),
        dispose: s.dispose,
      };
    },
  };
}

export function createFirebaseServices(
  config: FirebasePublicConfig,
  householdId: string,
): Services {
  const handles = init(config);
  return {
    auth: createAuthPort(handles),
    access: createAccessPort(handles, config, householdId),
    data: createInventoryPort(handles, config, householdId),
  };
}
