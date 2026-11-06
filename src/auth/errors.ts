import type { SignInErrorKind } from './types';

/** Preslikava Firebase kodove u vrste koje UI zna prikazati. Ne koristi firebase uvoze (testabilno). */
export function classifyAuthError(error: unknown): SignInErrorKind {
  const code =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
      return 'cancelled';
    case 'auth/network-request-failed':
      return 'network';
    case 'auth/too-many-requests':
      return 'too-many-requests';
    default:
      return 'unknown';
  }
}

/** Kodovi nakon kojih se smije pokušati redirect umjesto popupa. */
export function shouldFallBackToRedirect(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return (
    code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment'
  );
}

/** Firestore greške pri provjeri članstva: permission-denied = nema pristupa, ostalo = greška. */
export function classifyAccessError(error: unknown): 'denied' | 'offline' | 'unknown' {
  const code =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === 'permission-denied') return 'denied';
  if (code === 'unavailable' || code === 'deadline-exceeded') return 'offline';
  return 'unknown';
}
