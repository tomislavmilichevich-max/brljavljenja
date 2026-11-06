/** Javna Firebase web konfiguracija (nije tajna; zaštitu daju Security Rules). */
export interface FirebasePublicConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export type FirebaseConfigResult =
  | { status: 'configured'; config: FirebasePublicConfig; householdId: string }
  | { status: 'missing'; missing: string[] };

// storageBucket je namjerno neobavezan: Cloud Storage for Firebase se NE koristi (0 EUR / Spark).
const REQUIRED: Record<string, string> = {
  VITE_FIREBASE_API_KEY: 'apiKey',
  VITE_FIREBASE_AUTH_DOMAIN: 'authDomain',
  VITE_FIREBASE_PROJECT_ID: 'projectId',
  VITE_FIREBASE_MESSAGING_SENDER_ID: 'messagingSenderId',
  VITE_FIREBASE_APP_ID: 'appId',
  VITE_HOUSEHOLD_ID: 'householdId',
};

export function readFirebaseConfig(env: Record<string, string | undefined>): FirebaseConfigResult {
  const missing = Object.keys(REQUIRED).filter((k) => !env[k]?.trim());
  if (missing.length > 0) return { status: 'missing', missing };
  const v = (k: string) => (env[k] ?? '').trim();
  return {
    status: 'configured',
    householdId: v('VITE_HOUSEHOLD_ID'),
    config: {
      apiKey: v('VITE_FIREBASE_API_KEY'),
      authDomain: v('VITE_FIREBASE_AUTH_DOMAIN'),
      projectId: v('VITE_FIREBASE_PROJECT_ID'),
      storageBucket: v('VITE_FIREBASE_STORAGE_BUCKET'),
      messagingSenderId: v('VITE_FIREBASE_MESSAGING_SENDER_ID'),
      appId: v('VITE_FIREBASE_APP_ID'),
    },
  };
}
