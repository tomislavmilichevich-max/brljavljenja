// @vitest-environment node
// Isključivo SINTETIČKI podaci (nema stvarnih naziva iz kućnog popisa).
import { describe, expect, it } from 'vitest';
import { buildManifest, manifestHash } from './manifest.ts';
import { reconcile, snapshotHash } from './reconcile.ts';
import { buildReport } from './report.ts';
import { validateName } from './names.ts';
import type { Decisions, Plan, Snapshot } from './types.ts';

const P = 'home-inventory-pwa-218be';
const H = 'kuca1';
const meta = { firebase_project: P, household_id: H, already_populated_room: 'B' };

function basePlan(): Plan {
  return {
    metadata: { ...meta },
    locations: [
      {
        plan_location_id: 'loc-a',
        parent_plan_id: 'root',
        name: 'Soba A',
        kind: 'room',
        room: 'A',
      },
      {
        plan_location_id: 'loc-a1',
        parent_plan_id: 'loc-a',
        name: 'Ormar 1',
        kind: 'cabinet',
        room: 'A',
      },
      {
        plan_location_id: 'loc-a2',
        parent_plan_id: 'loc-a',
        name: 'Ormar 2',
        kind: 'cabinet',
        room: 'A',
      },
      {
        plan_location_id: 'loc-a1s',
        parent_plan_id: 'loc-a1',
        name: 'Polica',
        kind: 'shelf',
        room: 'A',
      },
      {
        plan_location_id: 'loc-b',
        parent_plan_id: 'root',
        name: 'Soba B',
        kind: 'room',
        room: 'B',
        status: 'RECONCILE_EXISTING',
      },
      {
        plan_location_id: 'loc-b1',
        parent_plan_id: 'loc-b',
        name: 'Kutija',
        kind: 'box',
        room: 'B',
        status: 'RECONCILE_EXISTING',
      },
      {
        plan_location_id: 'loc-agg',
        parent_plan_id: 'loc-a',
        name: 'Zbirno',
        kind: 'other',
        room: 'A',
        needs_review: true,
      },
    ],
    candidates: [
      {
        candidate_id: 'cand-0001',
        source_id: 'src-1',
        room: 'A',
        proposed_location_id: 'loc-a1s',
        proposed_item_name: 'Predmet 1',
        review_status: 'CANDIDATE',
      },
      {
        candidate_id: 'cand-0002',
        source_id: 'src-2',
        room: 'A',
        proposed_location_id: 'loc-a1',
        proposed_item_name: 'Isti naziv',
        review_status: 'CANDIDATE',
        duplicate_name_group: 'g1',
      },
      {
        candidate_id: 'cand-0003',
        source_id: 'src-3',
        room: 'A',
        proposed_location_id: 'loc-a2',
        proposed_item_name: 'Isti naziv',
        review_status: 'CANDIDATE',
        duplicate_name_group: 'g1',
      },
      {
        candidate_id: 'cand-0004',
        source_id: 'src-4',
        room: 'A',
        proposed_location_id: 'loc-a1',
        proposed_item_name: 'Za reviziju',
        review_status: 'REVIEW',
      },
      {
        candidate_id: 'cand-0005',
        source_id: 'src-5',
        room: 'B',
        proposed_location_id: 'loc-b1',
        proposed_item_name: 'Zadržano',
        review_status: 'HOLD_EXISTING_ROOM',
      },
      {
        candidate_id: 'cand-0006',
        source_id: 'src-6',
        room: 'A',
        proposed_location_id: 'loc-a1',
        proposed_item_name: 'Sažetak',
        review_status: 'SUMMARY_DO_NOT_IMPORT',
      },
      {
        candidate_id: 'cand-0007',
        source_id: 'src-7',
        room: 'A',
        proposed_location_id: 'loc-a1',
        proposed_item_name: 'Osjetljiv predmet',
        review_status: 'CANDIDATE',
        reconciliation_note: 'osjetljivo',
      },
      {
        candidate_id: 'cand-0008',
        source_id: 'src-8',
        room: 'A',
        proposed_location_id: 'loc-a1',
        proposed_item_name: 'Bez vrste',
        review_status: 'CANDIDATE',
      },
    ],
  };
}
const inc = (kind?: 'unique' | 'type') => ({
  decision: 'INCLUDE' as const,
  ...(kind ? { kind } : {}),
});
function decisions(): Decisions {
  return {
    schema: 1,
    candidates: {
      'cand-0001': inc('type'),
      'cand-0002': inc('type'),
      'cand-0003': inc('type'),
      'cand-0004': inc('unique'),
      'cand-0007': inc('unique'),
      'cand-0008': { decision: 'INCLUDE' }, // bez vrste
    },
  };
}
const emptySnap = (): Snapshot => ({
  meta: { projectId: P, householdId: H },
  locations: [],
  items: [],
  placements: [],
});
const item = (m: { items: { candidateId: string }[] }, id: string) =>
  m.items.find((i) => i.candidateId === id)! as ReturnType<typeof buildManifest>['items'][number];
const loc = (m: ReturnType<typeof buildManifest>, id: string) =>
  m.locations.find((l) => l.planId === id)!;

describe('validateName (A1: granica je > 120)', () => {
  it('120 znakova prolazi, 121 ne', () => {
    expect(validateName('a'.repeat(120)).ok).toBe(true);
    const r = validateName('a'.repeat(121));
    expect(r.ok).toBe(false);
  });
  it('prazno i neobrezano se odbija', () => {
    expect(validateName('').ok).toBe(false);
    expect(validateName(' x').ok).toBe(false);
    expect(validateName('x ').ok).toBe(false);
  });
});

describe('buildManifest', () => {
  it('120 znakova: bez razloga duljine; 121: REVIEW, bez rezanja', () => {
    const p = basePlan();
    p.candidates[0]!.proposed_item_name = 'a'.repeat(120);
    p.candidates[1]!.proposed_item_name = 'b'.repeat(121);
    const m = buildManifest(p, decisions());
    expect(item(m, 'cand-0001').status).toBe('CREATE');
    expect(item(m, 'cand-0002').status).toBe('REVIEW');
    expect(item(m, 'cand-0002').reasons).toContain('NAME_TOO_LONG');
    expect(item(m, 'cand-0002').name).toHaveLength(121); // nije skraćeno
  });
  it('missing kind -> REVIEW + prijedlog, ne CREATE', () => {
    const m = buildManifest(basePlan(), decisions());
    expect(item(m, 'cand-0008').status).toBe('REVIEW');
    expect(item(m, 'cand-0008').reasons).toContain('KIND_NOT_CONFIRMED');
    expect(item(m, 'cand-0008').kind).toBeUndefined();
  });
  it('bez odluka ništa nije CREATE (CANDIDATE nije odobrenje)', () => {
    const m = buildManifest(basePlan(), null);
    expect(m.items.filter((i) => i.status === 'CREATE')).toHaveLength(0);
  });
  it('REVIEW bez potvrde ostaje REVIEW; s potvrdom i kind postaje CREATE', () => {
    const none = buildManifest(basePlan(), { schema: 1, candidates: {} });
    expect(item(none, 'cand-0004').reasons).toContain('REVIEW_NOT_CONFIRMED');
    const m = buildManifest(basePlan(), decisions());
    expect(item(m, 'cand-0004').status).toBe('CREATE');
  });
  it('HOLD: Dnevni-boravak-slična soba, lokacije i stavke', () => {
    const m = buildManifest(basePlan(), decisions());
    expect(loc(m, 'loc-b').status).toBe('HOLD');
    expect(loc(m, 'loc-b1').status).toBe('HOLD');
    expect(item(m, 'cand-0005').status).toBe('HOLD');
  });
  it('SUMMARY je uvijek SKIP, čak i uz INCLUDE odluku', () => {
    const d = decisions();
    d.candidates!['cand-0006'] = inc('type');
    expect(item(buildManifest(basePlan(), d), 'cand-0006').status).toBe('SKIP');
  });
  it('osjetljivo bez izričitog INCLUDE nije u skupu; s INCLUDE ulazi', () => {
    const d = decisions();
    delete d.candidates!['cand-0007'];
    expect(item(buildManifest(basePlan(), d), 'cand-0007').reasons).toContain(
      'SENSITIVE_NOT_APPROVED',
    );
    expect(item(buildManifest(basePlan(), decisions()), 'cand-0007').status).toBe('CREATE');
  });
  it('zbirna lokacija: REVIEW; stavke u njoj nisu CREATE', () => {
    const p = basePlan();
    p.candidates.push({
      candidate_id: 'cand-0009',
      source_id: 'src-9',
      room: 'A',
      proposed_location_id: 'loc-agg',
      proposed_item_name: 'X',
      review_status: 'CANDIDATE',
    });
    const d = decisions();
    d.candidates!['cand-0009'] = inc('type');
    const m = buildManifest(p, d);
    expect(loc(m, 'loc-agg').status).toBe('REVIEW');
    expect(item(m, 'cand-0009').status).toBe('REVIEW');
  });
  it('identični nazivi na dvije lokacije: oba CREATE, zasebni ID-evi, samo informativna oznaka', () => {
    const m = buildManifest(basePlan(), decisions());
    const a = item(m, 'cand-0002');
    const b = item(m, 'cand-0003');
    expect(a.status).toBe('CREATE');
    expect(b.status).toBe('CREATE');
    expect(a.plannedItemId).not.toBe(b.plannedItemId);
    expect(a.flags).toContain('DUPLICATE_NAME_GROUP');
  });
  it('roditeljstvo i root/room pravilo', () => {
    const m = buildManifest(basePlan(), decisions());
    expect(loc(m, 'loc-a1s').parentPlanId).toBe('loc-a1');
    const p = basePlan();
    p.locations.push({
      plan_location_id: 'loc-bad',
      parent_plan_id: 'loc-a',
      name: 'Soba pod sobom',
      kind: 'room',
    });
    p.locations.push({
      plan_location_id: 'loc-bad2',
      parent_plan_id: 'root',
      name: 'Ormar na rootu',
      kind: 'cabinet',
    });
    const m2 = buildManifest(p, decisions());
    expect(loc(m2, 'loc-bad').reasons).toContain('ROOM_PARENT_RULE');
    expect(loc(m2, 'loc-bad2').reasons).toContain('ROOM_PARENT_RULE');
  });
  it('neispravan projekt / kućanstvo: sve BLOCKED', async () => {
    for (const bad of [{ firebase_project: 'drugi-projekt' }, { household_id: 'drugo' }]) {
      const p = basePlan();
      p.metadata = { ...p.metadata, ...bad };
      const m = buildManifest(p, decisions());
      expect(m.blockers.length).toBeGreaterThan(0);
      expect(m.items.every((i) => i.status === 'BLOCKED')).toBe(true);
      expect(m.locations.every((l) => l.status === 'BLOCKED')).toBe(true);
      const r = await buildReport(await reconcile(m, emptySnap()));
      expect(r.readiness.ready).toBe(false);
      expect(r.counts.items.CREATE).toBe(0);
    }
  });
  it('svaka stavka ima candidateId i sourceId; nepoznata odluka je upozorenje', () => {
    const d = decisions();
    d.candidates!['cand-9999'] = inc('type');
    const m = buildManifest(basePlan(), d);
    expect(m.items.every((i) => i.candidateId && i.sourceId)).toBe(true);
    expect(m.problems).toContain('UNKNOWN_DECISION_CANDIDATE:cand-9999');
  });
  it('ID-evi su deterministički i hash manifesta stabilan (rerun)', async () => {
    const a = buildManifest(basePlan(), decisions());
    const b = buildManifest(basePlan(), decisions());
    expect(await manifestHash(a)).toBe(await manifestHash(b));
    expect(a.items.map((i) => i.plannedItemId)).toEqual(b.items.map((i) => i.plannedItemId));
    const d = decisions();
    d.candidates!['cand-0001'] = inc('unique');
    expect(await manifestHash(buildManifest(basePlan(), d))).not.toBe(await manifestHash(a));
  });
});

describe('reconcile', () => {
  it('bez snapshota: nema planiranih upisa, NOT READY FOR APPLY, izvještaj koristan', async () => {
    const m = await reconcile(buildManifest(basePlan(), decisions()), null);
    const r = await buildReport(m);
    expect(m.planned).toHaveLength(0);
    expect(r.readiness.label).toBe('NOT READY FOR APPLY');
    expect(r.readiness.reasons).toContain('NO_SNAPSHOT');
    expect(r.counts.items.CREATE).toBeGreaterThan(0);
    expect(r.apply).toBe('NOT AUTHORIZED');
  });
  it('bez potvrđenih vrsta: NOT READY (NO_CONFIRMED_KINDS)', async () => {
    const m = await reconcile(buildManifest(basePlan(), null), emptySnap());
    const r = await buildReport(m);
    expect(r.readiness.reasons).toContain('NO_CONFIRMED_KINDS');
    expect(r.readiness.ready).toBe(false);
  });
  it('prazan snapshot: lokacije prije djece, svaka stavka ima item+placement ID, HOLD nema upisa', async () => {
    const m = await reconcile(buildManifest(basePlan(), decisions()), emptySnap());
    const w = m.planned;
    const ids = w.filter((x) => x.op === 'createLocation').map((x) => (x as { id: string }).id);
    expect(ids).toEqual(['imp1-loc-a', 'imp1-loc-a1', 'imp1-loc-a2', 'imp1-loc-a1s']);
    for (const x of w)
      if (x.op === 'createLocation')
        expect(x.parentId === 'root' || ids.includes(x.parentId)).toBe(true);
    const items = w.filter((x) => x.op === 'createItemWithPlacement');
    expect(items).toHaveLength(5); // 0001,0002,0003,0004,0007
    expect(w.some((x) => JSON.stringify(x).includes('loc-b'))).toBe(false);
    expect(m.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    const r = await buildReport(m);
    expect(r.readiness.ready).toBe(true);
    expect(r.quota.plannedWrites).toBe(4 + 5 * 3);
  });
  it('rerun s identičnim manifestom i snapshotom daje identičan plan i hash', async () => {
    const a = await reconcile(buildManifest(basePlan(), decisions()), emptySnap());
    const b = await reconcile(buildManifest(basePlan(), decisions()), emptySnap());
    expect(JSON.stringify(a.planned)).toBe(JSON.stringify(b.planned));
    expect(a.snapshotHash).toBe(b.snapshotHash);
  });
  it('snapshot hash se mijenja kad se snapshot promijeni', async () => {
    const s = emptySnap();
    const h1 = await snapshotHash(s);
    s.locations.push({ id: 'x1', name: 'Neka', parentId: null, kind: 'room' });
    expect(await snapshotHash(s)).not.toBe(h1);
  });
  it('već primijenjen uvoz: sve MATCH/ALREADY_APPLIED, nema upisa', async () => {
    const first = await reconcile(buildManifest(basePlan(), decisions()), emptySnap());
    const snap = emptySnap();
    for (const w of first.planned) {
      if (w.op === 'createLocation')
        snap.locations.push({
          id: w.id,
          name: w.name,
          parentId: w.parentId === 'root' ? null : w.parentId,
          kind: w.kind,
        });
      else {
        snap.items.push({ id: w.itemId, name: w.name, kind: w.kind });
        snap.placements.push({ id: w.placementId, itemId: w.itemId, locationId: w.locationId });
      }
    }
    const again = await reconcile(buildManifest(basePlan(), decisions()), snap);
    expect(again.planned).toHaveLength(0);
    expect(again.items.filter((i) => i.reasons.includes('ALREADY_APPLIED')).length).toBe(5);
  });
  it('postojeća lokacija (drugi ID, isti roditelj+naziv+vrsta) = MATCH; djeca se razrješavaju pod stvarnim ID-em', async () => {
    const snap = emptySnap();
    snap.locations.push({ id: 'real-a', name: ' soba a ', parentId: null, kind: 'room' });
    const m = await reconcile(buildManifest(basePlan(), decisions()), snap);
    expect(loc(m, 'loc-a').status).toBe('MATCH');
    expect(loc(m, 'loc-a').existingId).toBe('real-a');
    const w = m.planned.find((x) => x.op === 'createLocation' && x.planId === 'loc-a1');
    expect(w && w.op === 'createLocation' && w.parentId).toBe('real-a');
    expect(m.planned.some((x) => x.op === 'createLocation' && x.id === 'imp1-loc-a')).toBe(false);
  });
  it('isti naziv, druga vrsta = REVIEW (ne prepisuje)', async () => {
    const snap = emptySnap();
    snap.locations.push({ id: 'real-a', name: 'Soba A', parentId: null, kind: 'other' });
    const m = await reconcile(buildManifest(basePlan(), decisions()), snap);
    expect(loc(m, 'loc-a').status).toBe('REVIEW');
    expect(loc(m, 'loc-a').reasons).toContain('KIND_MISMATCH');
    expect(m.planned).toHaveLength(0);
  });
  it('dva stvarna ID-a za isti naziv: AMBIGUOUS_MATCH -> REVIEW', async () => {
    const snap = emptySnap();
    snap.locations.push(
      { id: 'r1', name: 'Soba A', parentId: null, kind: 'room' },
      { id: 'r2', name: 'soba a', parentId: null, kind: 'room' },
    );
    const m = await reconcile(buildManifest(basePlan(), decisions()), snap);
    expect(loc(m, 'loc-a').reasons).toContain('AMBIGUOUS_MATCH');
    expect(m.planned).toHaveLength(0);
  });
  it('postojeća stavka na istoj lokaciji = MATCH; dva = REVIEW; isti naziv drugdje = REVIEW', async () => {
    const snap = emptySnap();
    snap.locations.push(
      { id: 'ra', name: 'Soba A', parentId: null, kind: 'room' },
      { id: 'ro1', name: 'Ormar 1', parentId: 'ra', kind: 'cabinet' },
      { id: 'ro2', name: 'Ormar 2', parentId: 'ra', kind: 'cabinet' },
      { id: 'rs', name: 'Polica', parentId: 'ro1', kind: 'shelf' },
    );
    snap.items.push(
      { id: 'i1', name: 'Predmet 1', kind: 'type' },
      { id: 'i2', name: 'Isti naziv', kind: 'type' },
      { id: 'i3', name: 'isti naziv', kind: 'type' },
      { id: 'i4', name: 'Za reviziju', kind: 'unique' },
    );
    snap.placements.push(
      { id: 'p1', itemId: 'i1', locationId: 'rs' },
      { id: 'p2', itemId: 'i2', locationId: 'ro1' },
      { id: 'p3', itemId: 'i3', locationId: 'ro1' },
      { id: 'p4', itemId: 'i4', locationId: 'ro2' }, // isti naziv na drugoj lokaciji
    );
    const m = await reconcile(buildManifest(basePlan(), decisions()), snap);
    expect(item(m, 'cand-0001').status).toBe('MATCH');
    expect(item(m, 'cand-0001').existingItemId).toBe('i1');
    expect(item(m, 'cand-0002').reasons).toContain('AMBIGUOUS_MATCH');
    expect(item(m, 'cand-0004').reasons).toContain('SAME_NAME_ELSEWHERE');
    expect(item(m, 'cand-0003').reasons).toContain('SAME_NAME_ELSEWHERE'); // postojeći isti naziv na drugoj lokaciji: odluka vlasnika
  });
  it('sudar planiranog ID-a s drugačijim zapisom = BLOCKED, ništa se ne prepisuje', async () => {
    const snap = emptySnap();
    snap.locations.push({
      id: 'imp1-loc-a',
      name: 'Nešto sasvim drugo',
      parentId: null,
      kind: 'room',
    });
    const m = await reconcile(buildManifest(basePlan(), decisions()), snap);
    expect(loc(m, 'loc-a').status).toBe('BLOCKED');
    expect(loc(m, 'loc-a').reasons).toContain('ID_COLLISION');
    expect(m.planned).toHaveLength(0); // djeca ostaju REVIEW jer roditelj nije razriješen
  });
  it('snapshot drugog projekta/kućanstva: BLOCKED, nema upisa', async () => {
    for (const meta2 of [
      { projectId: 'x', householdId: H },
      { projectId: P, householdId: 'y' },
    ]) {
      const s = emptySnap();
      s.meta = meta2;
      const m = await reconcile(buildManifest(basePlan(), decisions()), s);
      expect(m.planned).toHaveLength(0);
      expect(m.blockers).toContain('SNAPSHOT_PROJECT_OR_HOUSEHOLD_MISMATCH');
      expect((await buildReport(m)).readiness.ready).toBe(false);
    }
  });
  it('izvještaj bez imena po zadanom ne sadrži nazive; s includeNames ih sadrži', async () => {
    const m = await reconcile(buildManifest(basePlan(), decisions()), emptySnap());
    expect(JSON.stringify(await buildReport(m))).not.toContain('Predmet 1');
    expect(JSON.stringify(await buildReport(m, { includeNames: true }))).toContain('Predmet 1');
  });
});
