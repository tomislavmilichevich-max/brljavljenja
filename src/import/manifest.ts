// A1: parser/validator + deterministički ID plan. Razdvaja: source_candidate (plan) → candidate_decision (vlasnik) → planned_write.
// Čista logika bez mreže i bez Firestorea. Pravila su zadane politike iz A0 (nisu pristanak na apply).
import { hashOf } from './canonical.ts';
import { normName, validId, validateName, validateNote } from './names.ts';
import {
  EXPECTED_HOUSEHOLD,
  EXPECTED_PROJECT,
  ID_PREFIX,
  LOCATION_KINDS,
  type CandidateDecision,
  type Decisions,
  type ItemEntry,
  type ItemKind,
  type LocationEntry,
  type Manifest,
  type Plan,
  type PlanCandidate,
  type PlanLocation,
  type Status,
} from './types.ts';

export interface BuildOptions {
  expectedProject?: string;
  expectedHousehold?: string;
  prefix?: string;
}

/** Zadani PRIJEDLOG vrste (nikad se ne koristi za apply bez izričite potvrde): zamjenjive/zbirne stvari = type, prepoznatljiva oprema = unique. */
const TYPE_HINTS =
  /(papir|hran|sredstv|vrećic|začin|napit|ručnic|krp[ea]|posteljin|plaht|igrač|ukras|knjig|roba|obuć|kabl|baterij|pribor|maramic|sitnic)/i;
const UNIQUE_HINTS =
  /(aparat|blender|toster|pegla|usisava|mikser|sokovnik|kuhalo|^fen\b|lampa|škrinj|daska|ormarić od struje|laptop)/i;
export function suggestKind(name: string): { kind: ItemKind; reason: string } | undefined {
  if (TYPE_HINTS.test(name))
    return { kind: 'type', reason: 'zbirna/zamjenjiva vrsta (prijedlog, nije potvrđeno)' };
  if (UNIQUE_HINTS.test(name))
    return {
      kind: 'unique',
      reason: 'prepoznatljiva pojedinačna oprema (prijedlog, nije potvrđeno)',
    };
  return undefined;
}

const SENSITIVE = /osjetljiv/i;

function depthOf(id: string, byId: Map<string, PlanLocation>): number {
  let d = 0;
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur && cur.parent_plan_id !== 'root') {
    if (seen.has(cur.plan_location_id)) return 99;
    seen.add(cur.plan_location_id);
    d++;
    cur = byId.get(cur.parent_plan_id);
  }
  return d;
}

export function buildManifest(
  plan: Plan,
  decisions: Decisions | null,
  opts: BuildOptions = {},
): Manifest {
  const project = opts.expectedProject ?? EXPECTED_PROJECT;
  const household = opts.expectedHousehold ?? EXPECTED_HOUSEHOLD;
  const prefix = opts.prefix ?? ID_PREFIX;
  const blockers: string[] = [];
  const problems: string[] = [];
  if (plan.metadata?.firebase_project !== project) blockers.push('PROJECT_MISMATCH');
  if (plan.metadata?.household_id !== household) blockers.push('HOUSEHOLD_MISMATCH');
  const blocked = blockers.length > 0;
  const populated = plan.metadata?.already_populated_room as string | undefined;

  const byId = new Map(plan.locations.map((l) => [l.plan_location_id, l]));
  if (byId.size !== plan.locations.length) blockers.push('DUPLICATE_PLAN_LOCATION_ID');
  const order = [...plan.locations].sort(
    (a, b) =>
      depthOf(a.plan_location_id, byId) - depthOf(b.plan_location_id, byId) ||
      a.plan_location_id.localeCompare(b.plan_location_id),
  );
  const locs = new Map<string, LocationEntry>();
  const plannedLocId = (planId: string) => `${prefix}-${planId}`;

  for (const l of order) {
    const reasons: string[] = [];
    let status: Status = 'CREATE';
    const planned = plannedLocId(l.plan_location_id);
    const parentEntry = l.parent_plan_id === 'root' ? null : locs.get(l.parent_plan_id);
    const nv = validateName(l.name);
    if (blocked) {
      status = 'BLOCKED';
      reasons.push(...blockers);
    } else if (!nv.ok) {
      status = 'BLOCKED';
      reasons.push(nv.reason);
    } else if (!(LOCATION_KINDS as readonly string[]).includes(l.kind)) {
      status = 'BLOCKED';
      reasons.push('KIND_INVALID');
    } else if (!validId(planned)) {
      status = 'BLOCKED';
      reasons.push('ID_INVALID');
    } else if (l.parent_plan_id !== 'root' && !byId.has(l.parent_plan_id)) {
      status = 'BLOCKED';
      reasons.push('PARENT_MISSING');
    } else if ((l.kind === 'room') !== (l.parent_plan_id === 'root')) {
      status = 'BLOCKED';
      reasons.push('ROOM_PARENT_RULE'); // P2-LOC-ROOM-01: room samo izravno pod root
    } else if (decisions?.locations?.[l.plan_location_id]?.decision === 'EXCLUDE') {
      status = 'SKIP';
      reasons.push('EXCLUDED_BY_OWNER');
    } else if (
      l.status === 'RECONCILE_EXISTING' ||
      (populated !== undefined && l.room === populated)
    ) {
      status = 'HOLD';
      reasons.push('HOLD_EXISTING_ROOM');
    } else if (l.needs_review) {
      status = 'REVIEW';
      reasons.push('AGGREGATE_LOCATION');
    } else if (parentEntry) {
      if (parentEntry.status === 'HOLD') {
        status = 'HOLD';
        reasons.push('PARENT_HOLD');
      } else if (parentEntry.status === 'SKIP') {
        status = 'SKIP';
        reasons.push('PARENT_SKIPPED');
      } else if (parentEntry.status !== 'CREATE') {
        status = 'REVIEW';
        reasons.push('PARENT_UNRESOLVED');
      }
    }
    locs.set(l.plan_location_id, {
      planId: l.plan_location_id,
      parentPlanId: l.parent_plan_id,
      name: l.name,
      kind: l.kind,
      status,
      reasons,
      plannedId: planned,
      path: l.path,
      room: l.room,
    });
  }

  const knownCand = new Set(plan.candidates.map((c) => c.candidate_id));
  for (const k of Object.keys(decisions?.candidates ?? {})) {
    if (!knownCand.has(k)) problems.push(`UNKNOWN_DECISION_CANDIDATE:${k}`);
  }
  const items: ItemEntry[] = [];
  const sorted = [...plan.candidates].sort((a, b) => a.candidate_id.localeCompare(b.candidate_id));
  for (const c of sorted)
    items.push(
      buildItem(
        c,
        decisions?.candidates?.[c.candidate_id],
        locs,
        blocked ? blockers : null,
        prefix,
        populated,
      ),
    );
  return {
    schema: 1,
    project,
    household,
    prefix,
    locations: [...locs.values()],
    items,
    blockers,
    problems,
    planned: [],
    snapshotHash: null,
  };
}

function buildItem(
  c: PlanCandidate,
  d: CandidateDecision | undefined,
  locs: Map<string, LocationEntry>,
  blockers: string[] | null,
  prefix: string,
  populated: string | undefined,
): ItemEntry {
  const num = c.candidate_id.replace(/^cand-/, '');
  const base = {
    candidateId: c.candidate_id,
    sourceId: c.source_id,
    locationPlanId: c.proposed_location_id,
    plannedItemId: `${prefix}-it-${num}`,
    plannedPlacementId: `${prefix}-pl-${num}`,
    room: c.room,
  };
  const flags: string[] = [];
  if (c.duplicate_name_group) flags.push('DUPLICATE_NAME_GROUP'); // samo informativno: nema spajanja
  const reasons: string[] = [];
  const done = (status: Status, extra: Partial<ItemEntry> = {}): ItemEntry => ({
    ...base,
    status,
    reasons,
    flags,
    name: extra.name ?? c.proposed_item_name,
    ...extra,
  });

  if (blockers) return done('BLOCKED', { reasons: (reasons.push(...blockers), reasons) });
  if (c.review_status === 'SUMMARY_DO_NOT_IMPORT')
    return done('SKIP', { reasons: (reasons.push('SUMMARY_DO_NOT_IMPORT'), reasons) });
  if (c.review_status === 'HOLD_EXISTING_ROOM' || (populated !== undefined && c.room === populated))
    return done('HOLD', { reasons: (reasons.push('HOLD_EXISTING_ROOM'), reasons) });
  if (d?.decision === 'EXCLUDE')
    return done('SKIP', { reasons: (reasons.push('EXCLUDED_BY_OWNER'), reasons) });
  if (!validId(base.plannedItemId) || !validId(base.plannedPlacementId))
    return done('BLOCKED', { reasons: (reasons.push('ID_INVALID'), reasons) });
  const loc = locs.get(c.proposed_location_id);
  if (!loc) return done('BLOCKED', { reasons: (reasons.push('LOCATION_MISSING'), reasons) });
  if (loc.status === 'HOLD')
    return done('HOLD', { reasons: (reasons.push('LOCATION_HOLD'), reasons) });
  if (loc.status === 'SKIP')
    return done('SKIP', { reasons: (reasons.push('LOCATION_SKIPPED'), reasons) });

  // naziv: izričiti čitljiv naziv ≤120 (odluka) ili izvorni; automatsko skraćivanje je ZABRANJENO
  const override = d?.name;
  const name = override ?? c.proposed_item_name;
  const nv = validateName(name);
  if (!nv.ok) {
    if (override !== undefined)
      return done('BLOCKED', { name, reasons: (reasons.push('DECISION_' + nv.reason), reasons) });
    reasons.push(nv.reason);
  }
  let note: string | undefined;
  if (d?.note !== undefined) {
    const nt = validateNote(d.note);
    if (!nt.ok)
      return done('BLOCKED', { name, reasons: (reasons.push('DECISION_' + nt.reason), reasons) });
    note = d.note;
  }
  if (loc.status !== 'CREATE') reasons.push('LOCATION_UNRESOLVED');
  const confirmed = d?.decision === 'INCLUDE';
  if (c.review_status === 'REVIEW' && !confirmed) reasons.push('REVIEW_NOT_CONFIRMED');
  if (SENSITIVE.test(c.reconciliation_note ?? '') && !confirmed)
    reasons.push('SENSITIVE_NOT_APPROVED');
  let kind: ItemKind | undefined;
  if (d?.kind === 'unique' || d?.kind === 'type') kind = d.kind;
  const suggestion = kind ? undefined : suggestKind(name);
  if (!kind) reasons.push('KIND_NOT_CONFIRMED');
  if (!confirmed) reasons.push('NOT_CONFIRMED'); // ni CANDIDATE nije odobrenje: potreban izričit INCLUDE vlasnika
  const status: Status = reasons.length === 0 ? 'CREATE' : 'REVIEW';
  return done(status, { name, kind, kindSuggestion: suggestion, note, path: undefined });
}

/** Kanonski hash manifesta (bez snapshot-a; ovisi samo o planu, odlukama i politici). */
export async function manifestHash(m: Manifest): Promise<string> {
  return hashOf({ ...m, planned: undefined, snapshotHash: undefined, problems: undefined });
}
export { normName };
