/** Domenski kodovi grešaka inventara. UI preslikava kod u poruku; nikad ne prikazuje sirove Firebase poruke. */
export type DomainCode =
  | 'access-revoked' // D5: korisnik više nije aktivan član — ukloniti podatke i pretplate, bez "pokušaj ponovno"
  | 'changed-elsewhere' // sukob verzija: netko je promijenio zapis
  | 'duplicate-placement' // isti predmet već postoji na toj lokaciji / unique već smješten
  | 'cycle' // premještaj bi stvorio ciklus
  | 'room-immovable' // P2-LOC-ROOM-01
  | 'room-parent' // P2-LOC-ROOM-01
  | 'same-parent'
  | 'same-location'
  | 'bad-parent'
  | 'bad-item'
  | 'bad-location'
  | 'not-found'
  | 'corrupt-tree' // stablo je oštećeno (D1) — premještanja onemogućena
  | 'not-bootstrapped' // nema roota / meta/tree
  | 'offline' // nema veze PRIJE commita: promjena sigurno NIJE spremljena i NIJE u redu za kasnije slanje
  | 'outcome-unknown' // veza pala dok se commit potvrđivao: poslužitelj je MOGAO primiti promjenu; ishod se mora provjeriti
  | 'contention' // previše istodobnih izmjena, pokušaj kasnije
  | 'invalid-input'
  | 'unknown';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'DomainError';
  }
}

export const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError;

const codeOf = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;

/** Firestore greška -> DomainError (već postojeći DomainError prolazi nepromijenjen). */
export function toDomainError(e: unknown): DomainError {
  if (isDomainError(e)) return e;
  switch (codeOf(e)) {
    case 'unavailable':
    case 'deadline-exceeded':
    case 'cancelled':
      return new DomainError('offline');
    case 'aborted':
    case 'resource-exhausted':
      return new DomainError('contention');
    default:
      return new DomainError('unknown', e instanceof Error ? e.message : String(e));
  }
}

export const isPermissionDenied = (e: unknown) => codeOf(e) === 'permission-denied';
