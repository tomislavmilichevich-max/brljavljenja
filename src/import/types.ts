// Faza A uvoza (docs/IMPORT_PHASE_A_PLAN.md): čisti tipovi. NIKAD stvarni podaci u repozitoriju; testovi samo sintetički.
// Datoteke u src/import/ koriste importe s ekstenzijom .ts i samo "erasable" TypeScript, pa ih Node može izravno izvršiti
// (CLI wrapperi u scripts/import/) i pa se ista logika može kasnije ponovno upotrijebiti u aplikaciji (opcija B).
export const EXPECTED_PROJECT = 'home-inventory-pwa-218be';
export const EXPECTED_HOUSEHOLD = 'kuca1';
export const ID_PREFIX = 'imp1';
export const NAME_MAX = 120;
export const NOTE_MAX = 1000;
export const LOCATION_KINDS = ['room', 'cabinet', 'shelf', 'box', 'drawer', 'other'] as const;
export type LocKind = (typeof LOCATION_KINDS)[number];
export type ItemKind = 'unique' | 'type';

// ---- ulaz: plan (lokalni JSON, nikad u Git) ----
export interface PlanLocation {
  plan_location_id: string;
  parent_plan_id: string; // 'root' ili plan ID
  name: string;
  kind: string;
  path?: string;
  room?: string;
  status?: string; // PROPOSED_VERIFY | RECONCILE_EXISTING
  needs_review?: boolean;
  review_note?: string;
}
export interface PlanCandidate {
  candidate_id: string;
  source_id: string;
  room?: string;
  proposed_location_id: string;
  proposed_item_name: string;
  review_status: string; // CANDIDATE | REVIEW | HOLD_EXISTING_ROOM | SUMMARY_DO_NOT_IMPORT
  reconciliation_note?: string;
  duplicate_name_group?: string | null;
  quantity?: unknown;
  item_kind?: unknown;
  item_category?: unknown;
}
export interface Plan {
  metadata: { household_id?: string; firebase_project?: string; [k: string]: unknown };
  locations: PlanLocation[];
  candidates: PlanCandidate[];
  source_rows?: unknown[];
}

// ---- vlasnikove odluke (lokalni JSON, nikad u Git) ----
export interface CandidateDecision {
  decision: 'INCLUDE' | 'EXCLUDE';
  kind?: ItemKind; // IZRIČITO potvrđena vrsta (nepromjenjiva u P2)
  name?: string; // čitljiv naziv ≤ 120 (npr. za predugačke)
  note?: string; // ≤ 1000
}
export interface Decisions {
  schema: 1;
  candidates?: Record<string, CandidateDecision>;
  locations?: Record<string, { decision: 'INCLUDE' | 'EXCLUDE' }>;
}

// ---- manifest ----
export type Status = 'CREATE' | 'MATCH' | 'REVIEW' | 'HOLD' | 'SKIP' | 'BLOCKED';
export interface LocationEntry {
  planId: string;
  parentPlanId: string;
  name: string;
  kind: string;
  status: Status;
  reasons: string[];
  plannedId: string; // deterministički Firestore ID
  existingId?: string; // postavlja reconcile (MATCH)
  parentId?: string; // stvarni/planirani ID roditelja (postavlja reconcile)
  path?: string;
  room?: string;
}
export interface ItemEntry {
  candidateId: string; // izvorni ID kandidata (obavezno)
  sourceId: string; // izvorni redak (obavezno)
  status: Status;
  reasons: string[];
  flags: string[]; // informativno (npr. DUPLICATE_NAME_GROUP)
  name: string;
  kind?: ItemKind; // samo IZRIČITO potvrđena
  kindSuggestion?: { kind: ItemKind; reason: string };
  note?: string;
  locationPlanId: string;
  locationId?: string; // postavlja reconcile
  plannedItemId: string;
  plannedPlacementId: string;
  existingItemId?: string;
  room?: string;
  path?: string;
}
export type PlannedWrite =
  | {
      op: 'createLocation';
      key: string;
      id: string;
      parentId: string;
      name: string;
      kind: string;
      planId: string;
    }
  | {
      op: 'createItemWithPlacement';
      key: string;
      itemId: string;
      placementId: string;
      locationId: string;
      name: string;
      kind: ItemKind;
      note?: string;
      candidateId: string;
      sourceId: string;
    };
export interface Manifest {
  schema: 1;
  project: string;
  household: string;
  prefix: string;
  locations: LocationEntry[];
  items: ItemEntry[];
  blockers: string[];
  problems: string[]; // upozorenja (npr. odluka za nepoznatog kandidata)
  planned: PlannedWrite[]; // popunjava reconcile
  snapshotHash: string | null; // popunjava reconcile
}

// ---- snapshot (read-only; lokalno izvan repozitorija) ----
export interface SnapDoc {
  id: string;
  version?: number;
  archived?: boolean;
  createdBy?: string;
}
export interface SnapLocation extends SnapDoc {
  name: string;
  parentId: string | null;
  kind: string;
}
export interface SnapItem extends SnapDoc {
  name: string;
  kind: string;
}
export interface SnapPlacement extends SnapDoc {
  itemId: string;
  locationId: string;
}
export interface Snapshot {
  meta: { projectId: string; householdId: string; takenAt?: string };
  locations: SnapLocation[];
  items: SnapItem[];
  placements: SnapPlacement[];
  placementKeys?: string[];
}
