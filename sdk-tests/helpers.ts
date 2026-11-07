// Pomoćni sloj za testove nad pravim SDK-om. Samo emulatori, `demo-` projekt, sintetski računi i demo kuća.
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  getAuth,
  signInWithCredential,
  signOut,
  type Auth,
} from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { FirebasePublicConfig } from '../src/config/env';
import {
  openDataSession,
  type DataSession,
  type EmulatorEndpoints,
} from '../src/firebase/dataSession';
import {
  createInventoryRepository,
  type InventoryRepository,
  type TestHooks,
} from '../src/inventory/repository';
import { seedDemoHouse, H } from '../rules-tests/p2/helpers';

export { H };
export const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-home-inventory-sdk';
if (!PROJECT.startsWith('demo-'))
  throw new Error('SDK testovi smiju raditi samo s demo- projektom.');

export const CONFIG: FirebasePublicConfig = {
  apiKey: 'fake-api-key',
  authDomain: '127.0.0.1',
  projectId: PROJECT,
  storageBucket: '',
  messagingSenderId: '1',
  appId: '1:1:web:1',
};
export const EMU: EmulatorEndpoints = {
  authUrl: 'http://127.0.0.1:9099',
  firestoreHost: '127.0.0.1',
  firestorePort: 8080,
};

let n = 0;
export interface Primary {
  app: FirebaseApp;
  auth: Auth;
  uid: string;
  name: string;
}
/** Primarna prijava (kao u aplikaciji): lažni Google račun na Auth emulatoru. */
export async function signInPrimary(name: string): Promise<Primary> {
  const app = initializeApp(CONFIG, `primary-${name}-${process.pid}-${++n}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, EMU.authUrl, { disableWarnings: true });
  const cred = await signInWithCredential(
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
  return { app, auth, uid: cred.user.uid, name };
}
export const signOutPrimary = (p: Primary) => signOut(p.auth);

let adminEnv: RulesTestEnvironment | undefined;
export async function admin(): Promise<RulesTestEnvironment> {
  adminEnv ??= await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  return adminEnv;
}
export async function closeAdmin() {
  await adminEnv?.cleanup();
  adminEnv = undefined;
}

/** Seed demo kuće (admin, zaobilazi pravila) za zadane stvarne UID-ove članova. */
export async function seedFor(members: readonly (readonly [string, boolean])[]) {
  await seedDemoHouse(await admin(), members);
}
export async function setEnabled(uid: string, enabled: boolean) {
  const env = await admin();
  await env.withSecurityRulesDisabled(
    async (c) =>
      void (await updateDoc(doc(c.firestore(), `households/${H}/members/${uid}`), { enabled })),
  );
}
export async function adminRead<T>(
  fn: (
    db: ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore'] extends () => infer F
      ? F
      : never,
  ) => Promise<T>,
): Promise<T> {
  const env = await admin();
  let out: T | undefined;
  await env.withSecurityRulesDisabled(async (c) => void (out = await fn(c.firestore() as never)));
  return out as T;
}
export async function adminWrite(fn: (db: never) => Promise<unknown>) {
  const env = await admin();
  await env.withSecurityRulesDisabled(async (c) => void (await fn(c.firestore() as never)));
}

export interface Live {
  primary: Primary;
  session: DataSession;
  repo: InventoryRepository;
  /** Promjenjivi hook za prisilno preklapanje: postavi `hooks.afterReads` prije poziva operacije. */
  hooks: TestHooks;
}
/** Otvara stvarnu podatkovnu sesiju (produkcijski kod) i repozitorij za primarnog korisnika. */
export async function openLive(
  primary: Primary,
  opts: { emulator?: EmulatorEndpoints; hooks?: TestHooks } = {},
): Promise<Live> {
  const session = await openDataSession(primary.auth, CONFIG, opts.emulator ?? EMU);
  const hooks: TestHooks = opts.hooks ?? {};
  const repo = createInventoryRepository({
    db: session.db,
    householdId: H,
    uid: session.uid,
    testHooks: hooks,
  });
  return { primary, session, repo, hooks };
}

/** Barijera: svih n sudionika čeka dok se svi ne pojave (prisilno preklapanje transakcija). */
export function barrier(count: number) {
  let waiting = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return async () => {
    if (++waiting >= count) release();
    await gate;
  };
}

export async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    const err = e as { code?: string };
    return `ERR:${err.code ?? 'unknown'}`;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function waitFor<T>(
  fn: () => T | undefined | false | null,
  ms = 15000,
  step = 50,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor: isteklo vrijeme');
    await sleep(step);
  }
}

/** TCP proxy ispred Firestore emulatora: down() STVARNO prekida mrežu (sve veze uništene, nove odbijene). */
export function createProxy(targetPort = 8080) {
  const sockets = new Set<net.Socket>();
  let up = true;
  const server = net.createServer((client) => {
    if (!up) return void client.destroy();
    const upstream = net.connect(targetPort, '127.0.0.1');
    sockets.add(client).add(upstream);
    const close = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on('error', close).on('close', close);
    upstream.on('error', close).on('close', close);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  return {
    async listen(): Promise<number> {
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      return (server.address() as net.AddressInfo).port;
    },
    down() {
      up = false;
      for (const s of sockets) s.destroy();
      sockets.clear();
    },
    up() {
      up = true;
    },
    async close() {
      up = false;
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** Kućanstvo bez ijedne lokacije (svježe, nepripremljeno): samo dokument kućanstva i članovi. */
export async function seedEmptyHousehold(members: readonly (readonly [string, boolean])[]) {
  const env = await admin();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const { setDoc } = await import('firebase/firestore');
    const db = c.firestore();
    await setDoc(doc(db, `households/${H}`), { name: 'Prazna kuća', schemaVersion: 1 });
    for (const [uid, enabled] of members)
      await setDoc(doc(db, `households/${H}/members/${uid}`), { uid, role: 'member', enabled });
  });
}

/** Lanci lokacija c0…c{len-1} (c0 pod root) i e0…e{len-1}, upisani adminom (za testove dubine). */
export async function seedChains(len = 24) {
  const env = await admin();
  await env.withSecurityRulesDisabled(async (c) => {
    const { setDoc, Timestamp } = await import('firebase/firestore');
    const db = c.firestore();
    const now = Timestamp.now();
    for (const p of ['c', 'e']) {
      for (let i = 0; i < len; i++) {
        await setDoc(doc(db, `households/${H}/locations/${p}${i}`), {
          name: `${p}${i}`,
          parentId: i === 0 ? 'root' : `${p}${i - 1}`,
          kind: 'box',
          version: 1,
          archived: false,
          createdAt: now,
          updatedAt: now,
          createdBy: 'seed',
          updatedBy: 'seed',
        });
      }
    }
  });
}

/** Promjena računa na ISTOM uređaju/Authu (kao kad se na istom telefonu prijavi drugi Google račun). */
export async function switchAccount(p: Primary, name: string): Promise<string> {
  const cred = await signInWithCredential(
    p.auth,
    GoogleAuthProvider.credential(
      JSON.stringify({
        sub: `sub-${name}`,
        email: `${name}@example.test`,
        email_verified: true,
        name,
      }),
    ),
  );
  p.uid = cred.user.uid;
  p.name = name;
  return cred.user.uid;
}
