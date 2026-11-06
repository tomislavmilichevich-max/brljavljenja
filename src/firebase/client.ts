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
import {
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  getFirestore,
  type Firestore,
} from 'firebase/firestore';
import type { FirebasePublicConfig } from '../config/env';
import { evaluateAccess } from '../auth/access';
import { classifyAuthError, shouldFallBackToRedirect } from '../auth/errors';
import type { AccessPort, AccessResult, AuthPort, Services } from '../auth/types';

/** Emulatori samo u dev načinu i samo izričitom zastavicom — nikad u produkcijskom buildu. */
const useEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true';

interface Handles {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

function init(config: FirebasePublicConfig): Handles {
  const app = initializeApp(config);
  const auth = getAuth(app);
  // getFirestore: u P1 je memorijski cache (bez IndexedDB persistencea) pa nakon odjave/reloada
  // na uređaju ne ostaje privatni sadržaj kućanstva. Persistence se uvodi tek s P2/P3 uz test prelaska računa.
  const db = getFirestore(app);
  if (useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
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
  return { app, auth, db };
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

function createAccessPort({ db }: Handles, householdId: string): AccessPort {
  return {
    async checkAccess(): Promise<AccessResult> {
      // householdId je u konfiguraciji, ali NIJE autorizacija: odluku donose Security Rules.
      // getDocFromServer (NE getDoc): getDoc offline tiho vraća predmemorirani dokument, što bi pokazalo
      // 'odobren' bez potvrde poslužitelja (opozvani član) ili drugom računu na istom uređaju nakon odjave.
      return evaluateAccess(async () => {
        const snap = await getDocFromServer(doc(db, 'households', householdId));
        const name = snap.exists() ? ((snap.data()?.name as string | undefined) ?? null) : null;
        return { exists: snap.exists(), name };
      });
    },
  };
}

export function createFirebaseServices(
  config: FirebasePublicConfig,
  householdId: string,
): Services {
  const handles = init(config);
  return { auth: createAuthPort(handles), access: createAccessPort(handles, householdId) };
}
