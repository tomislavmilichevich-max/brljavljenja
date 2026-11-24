// @vitest-environment node
// Sintetički skup istog OBLIKA kao stvarni paket (7 soba, 161 lokacija, 393 kandidata: 224/128/38/3; 19 skupina duplikata,
// 19 osjetljivih, 3 zbirne lokacije, 2 predugačka naziva). Nema nijednog stvarnog naziva. Provjerava i točan zbroj upisa.
import { describe, expect, it } from 'vitest';
import { buildManifest } from './manifest.ts';
import { reconcile } from './reconcile.ts';
import { buildReport } from './report.ts';
import type { Decisions, Plan, Snapshot } from './types.ts';

const P = 'home-inventory-pwa-218be';
const H = 'kuca1';
export function syntheticPlan(): Plan {
  const locations: Plan['locations'] = [];
  const candidates: Plan['candidates'] = [];
  for (let r = 1; r <= 7; r++) {
    const room = `R${r}`;
    locations.push({
      plan_location_id: `room-${r}`,
      parent_plan_id: 'root',
      name: `Soba ${r}`,
      kind: 'room',
      room,
      status: r === 7 ? 'RECONCILE_EXISTING' : 'PROPOSED_VERIFY',
    });
  }
  // 154 pod-lokacije; soba 7 (HOLD): 1 soba + 20 lokacija = 21 RECONCILE_EXISTING; 3 zbirne lokacije (needs_review)
  const per: Record<number, number> = { 1: 23, 2: 23, 3: 23, 4: 22, 5: 22, 6: 21, 7: 21 };
  for (let r = 1; r <= 7; r++)
    for (let k = 0; k < per[r]! - (r === 7 ? 1 : 0); k++) {
      const id = `loc-${r}-${k}`;
      const parent = k % 4 === 0 ? `room-${r}` : `loc-${r}-${k - (k % 4)}`;
      locations.push({
        plan_location_id: id,
        parent_plan_id: parent,
        name: `Mjesto ${r}.${k}`,
        kind: k % 4 === 0 ? 'cabinet' : 'shelf',
        room: `R${r}`,
        status: r === 7 ? 'RECONCILE_EXISTING' : 'PROPOSED_VERIFY',
        needs_review:
          r === 2 && k === 5 ? true : r === 3 && k === 6 ? true : r === 4 && k === 9 ? true : false,
      });
    }
  const usable = locations.filter((l) => l.room !== 'R7' && !l.needs_review && l.kind !== 'room');
  const hold = locations.filter((l) => l.room === 'R7' && l.kind !== 'room');
  const mk = (
    i: number,
    status: string,
    loc: string,
    room: string,
    extra: Record<string, unknown> = {},
  ) =>
    candidates.push({
      candidate_id: `cand-${String(i).padStart(4, '0')}`,
      source_id: `src-${i}`,
      room,
      proposed_location_id: loc,
      proposed_item_name: `Predmet ${i}`,
      review_status: status,
      ...extra,
    } as never);
  let i = 0;
  for (let k = 0; k < 224; k++)
    mk(
      ++i,
      'CANDIDATE',
      usable[k % usable.length]!.plan_location_id,
      usable[k % usable.length]!.room!,
    );
  for (let k = 0; k < 128; k++)
    mk(
      ++i,
      'REVIEW',
      usable[(k * 3) % usable.length]!.plan_location_id,
      usable[(k * 3) % usable.length]!.room!,
    );
  for (let k = 0; k < 38; k++)
    mk(++i, 'HOLD_EXISTING_ROOM', hold[k % hold.length]!.plan_location_id, 'R7');
  for (let k = 0; k < 3; k++)
    mk(++i, 'SUMMARY_DO_NOT_IMPORT', usable[k]!.plan_location_id, usable[k]!.room!);
  // 19 osjetljivih (među CANDIDATE), 19 skupina istog naziva (po 2 kandidata na različitim lokacijama), 2 predugačka
  for (let k = 0; k < 19; k++) candidates[k]!.reconciliation_note = 'osjetljivo';
  for (let g = 0; g < 19; g++)
    for (const off of [20, 60])
      Object.assign(candidates[off + g]!, {
        proposed_item_name: `Isti ${g}`,
        duplicate_name_group: `g${g}`,
      });
  candidates[100]!.proposed_item_name = 'x'.repeat(128);
  candidates[352]!.proposed_item_name = 'y'.repeat(152); // HOLD_EXISTING_ROOM
  return {
    metadata: { firebase_project: P, household_id: H, already_populated_room: 'R7' },
    locations,
    candidates,
  };
}

describe('sintetički skup oblika stvarnog paketa', () => {
  it('struktura: 7 soba, 161 lokacija, 393 kandidata', () => {
    const p = syntheticPlan();
    expect(p.locations).toHaveLength(161);
    expect(p.locations.filter((l) => l.kind === 'room')).toHaveLength(7);
    expect(p.candidates).toHaveLength(393);
  });
  it('bez odluka: nula CREATE stavki, nula planiranih upisa za stavke, NOT READY', async () => {
    const m = await reconcile(buildManifest(syntheticPlan(), null), {
      meta: { projectId: P, householdId: H },
      locations: [],
      items: [],
      placements: [],
    });
    const r = await buildReport(m);
    expect(r.counts.items.CREATE).toBe(0);
    expect(r.counts.items.HOLD).toBe(38);
    expect(r.counts.items.SKIP).toBe(3);
    expect(r.counts.locations.HOLD).toBe(21);
    expect(r.counts.locations.REVIEW).toBe(3); // zbirne lokacije
    expect(r.readiness.label).toBe('NOT READY FOR APPLY');
    expect(r.readiness.reasons).toContain('NO_CONFIRMED_KINDS');
    expect(m.planned.filter((w) => w.op === 'createItemWithPlacement')).toHaveLength(0);
  });
  it('s odlukama za prvi val (CANDIDATE bez osjetljivih i predugačkog): točni brojevi i zbroj upisa', async () => {
    const p = syntheticPlan();
    const d: Decisions = { schema: 1, candidates: {} };
    for (const c of p.candidates)
      if (c.review_status === 'CANDIDATE' && !c.reconciliation_note)
        d.candidates![c.candidate_id] = { decision: 'INCLUDE', kind: 'type' };
    const snap: Snapshot = {
      meta: { projectId: P, householdId: H },
      locations: [],
      items: [],
      placements: [],
    };
    const m = await reconcile(buildManifest(p, d), snap);
    const r = await buildReport(m);
    const items = m.planned.filter((w) => w.op === 'createItemWithPlacement').length;
    const locs = m.planned.filter((w) => w.op === 'createLocation').length;
    // 224 CANDIDATE − 19 osjetljivih − 1 predugačak (cand-0101, NAME_TOO_LONG) = 204
    expect(r.counts.items.CREATE).toBe(204);
    expect(items).toBe(204);
    expect(r.counts.items.REVIEW).toBe(19 + 1 + 128);
    expect(r.quota.plannedWrites).toBe(locs + items * 3);
    expect(
      m.items
        .filter((i) => i.status === 'CREATE')
        .every((i) => i.candidateId && i.sourceId && i.kind === 'type'),
    ).toBe(true);
    expect(
      m.planned.some(
        (w) => JSON.stringify(w).includes('room-7') || JSON.stringify(w).includes('loc-7-'),
      ),
    ).toBe(false); // R7 se ne dira
    expect(r.readiness.ready).toBe(true);
    expect(r.potential.reviewItems).toBe(148);
    // predugačak naziv nije skraćen
    expect(m.items.find((i) => i.candidateId === 'cand-0101')!.name).toHaveLength(128);
  });
});
