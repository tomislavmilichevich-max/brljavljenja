import type { InventoryState } from './gate';
import type { InventoryRepository } from './repository';

/**
 * Jedna PODATKOVNA SESIJA = jedna zasebna Firebase instanca (vlastiti memorijski keš, auth bez perzistencije).
 * dispose() odjavljuje sve listenere, uništava instancu i time potpuno briše privatne podatke iz memorije.
 */
export interface InventorySession {
  uid: string;
  repo: InventoryRepository;
  /** Pretplata na živi inventar; povratna funkcija odmah odjavljuje listenere. */
  watch(onState: (s: InventoryState) => void): () => void;
  dispose(): Promise<void>;
}

export interface InventoryPort {
  /** Otvara novu, izoliranu podatkovnu sesiju za TRENUTNO prijavljenog korisnika. */
  open(): Promise<InventorySession>;
}
