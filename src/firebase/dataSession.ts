import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  inMemoryPersistence,
  initializeAuth,
  updateCurrentUser,
  type Auth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  terminate,
  type Firestore,
} from 'firebase/firestore';
import type { FirebasePublicConfig } from '../config/env';
import { DomainError } from '../inventory/errors';

export interface EmulatorEndpoints {
  authUrl: string;
  firestoreHost: string;
  firestorePort: number;
}

export interface DataSession {
  db: Firestore;
  uid: string;
  dispose(): Promise<void>;
}

let counter = 0;

/**
 * Otvara IZOLIRANU podatkovnu sesiju: zasebna Firebase app instanca s vlastitim Firestoreom (samo memorijski keš,
 * nikad IndexedDB) i vlastitim Authom BEZ perzistencije (nijedan token ne ostaje u pohrani). Korisnik se prenosi
 * iz primarnog Autha (`updateCurrentUser`). `dispose()` uništava instancu: keš i listeneri nestaju, a sljedeća
 * sesija (isti ili drugi račun) kreće s potpuno praznim kešom — to je jamstvo izolacije računa na istom uređaju.
 */
export async function openDataSession(
  primaryAuth: Auth,
  config: FirebasePublicConfig,
  emulator?: EmulatorEndpoints,
): Promise<DataSession> {
  const user = primaryAuth.currentUser;
  if (!user) throw new DomainError('access-revoked', 'Nema prijavljenog korisnika.');
  const app = initializeApp(config, `data-${++counter}-${Math.random().toString(36).slice(2, 8)}`);
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    try {
      if (db) await terminate(db);
    } catch {
      /* instanca je ionako uništena */
    }
    try {
      await deleteApp(app);
    } catch {
      /* već obrisana */
    }
  };
  let db: Firestore | undefined;
  try {
    const auth = initializeAuth(app, { persistence: inMemoryPersistence });
    if (emulator) connectAuthEmulator(auth, emulator.authUrl, { disableWarnings: true });
    await updateCurrentUser(auth, user);
    db = initializeFirestore(app, { localCache: memoryLocalCache() });
    if (emulator) connectFirestoreEmulator(db, emulator.firestoreHost, emulator.firestorePort);
    return { db, uid: user.uid, dispose };
  } catch (e) {
    await dispose();
    throw e;
  }
}
