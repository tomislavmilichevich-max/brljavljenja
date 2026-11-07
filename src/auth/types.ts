import type { InventoryPort } from '../inventory/port';
/** Minimalni podaci o prijavljenom korisniku (UID nije tajna). */
export interface SessionUser {
  uid: string;
  displayName: string | null;
}

export type AccessResult =
  | { status: 'member'; householdName: string | null }
  | { status: 'denied' }
  | { status: 'error'; kind: AccessErrorKind };

/**
 * offline/unknown: pristup nije moguće potvrditi.
 * household-missing: postoji zapis članstva, ali NE i dokument kućanstva (neuspjeli bootstrap) —
 * to nikad ne smije izgledati kao odobren pristup.
 */
export type AccessErrorKind = 'offline' | 'unknown' | 'household-missing';

/** Greške prijave svedene na razumljive vrste (bez firebase-specifičnih kodova u UI-ju). */
export type SignInErrorKind = 'cancelled' | 'network' | 'too-many-requests' | 'unknown';

export interface AuthPort {
  /** Pretplata na promjene prijave; vraća funkciju za odjavu s pretplate. */
  subscribe(
    onUser: (user: SessionUser | null) => void,
    onError: (kind: SignInErrorKind) => void,
  ): () => void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}

export interface AccessPort {
  /** Pristup za TRENUTNO prijavljenog korisnika; odluku donose Firestore Security Rules. */
  checkAccess(): Promise<AccessResult>;
}

export interface Services {
  auth: AuthPort;
  access: AccessPort;
  /** P2-B: izolirane podatkovne sesije inventara. */
  data: InventoryPort;
}
