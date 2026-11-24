// @vitest-environment node
// A4 (mock snapshot), A5 (brava apply-a, lažni repo), A7 (planer povrata). Samo sintetički podaci; bez mreže.
import { describe, expect, it } from 'vitest';
import { applyPlan, memoryCheckpoint, type ApplyInput, type ImportRepo } from './apply.ts';
import { signApproval, type Approval } from './approval.ts';
import { buildManifest } from './manifest.ts';
import { reconcile } from './reconcile.ts';
import { buildReport } from './report.ts';
import { planRestore } from './restore.ts';
import { collectionUrl, restFetcher, takeSnapshot } from './snapshot.ts';
import type { Decisions, Plan, Snapshot } from './types.ts';

const P = 'demo-import-test';
const H = 'demo-house';
const KEY = 'test-only-approval-key-0123456789';
const UID = 'uid-test-1';

function plan(): Plan {
  return {
    metadata: { firebase_project: P, household_id: H },
    locations: [
      { plan_location_id: 'l1', parent_plan_id: 'root', name: 'Soba', kind: 'room' },
      { plan_location_id: 'l2', parent_plan_id: 'l1', name: 'Ormar', kind: 'cabinet' },
    ],
    candidates: [
      {
        candidate_id: 'cand-0001',
        source_id: 's1',
        proposed_location_id: 'l2',
        proposed_item_name: 'A',
        review_status: 'CANDIDATE',
      },
      {
        candidate_id: 'cand-0002',
        source_id: 's2',
        proposed_location_id: 'l2',
        proposed_item_name: 'B',
        review_status: 'CANDIDATE',
      },
    ],
  };
}
const dec = (): Decisions => ({
  schema: 1,
  candidates: {
    'cand-0001': { decision: 'INCLUDE', kind: 'type' },
    'cand-0002': { decision: 'INCLUDE', kind: 'unique' },
  },
});
const snap = (): Snapshot => ({
  meta: { projectId: P, householdId: H },
  locations: [],
  items: [],
  placements: [],
});
const opts = { expectedProject: P, expectedHousehold: H };

class FakeRepo implements ImportRepo {
  calls: string[] = [];
  failOn?: string;
  unknownOn?: string;
  verifyResult: 'applied' | 'not-applied' | 'changed-elsewhere' | 'unknown' = 'applied';
  async createLocation(i: { id?: string }) {
    this.calls.push('loc:' + i.id);
    this.maybeFail('loc:' + i.id);
    return { id: i.id! };
  }
  async createItemWithPlacement(i: { attempt?: { itemId: string } }) {
    this.calls.push('item:' + i.attempt!.itemId);
    this.maybeFail('item:' + i.attempt!.itemId);
    return { itemId: i.attempt!.itemId, placementId: 'x' };
  }
  async verify() {
    return this.verifyResult;
  }
  private maybeFail(k: string) {
    if (k === this.unknownOn) throw Object.assign(new Error('u'), { code: 'outcome-unknown' });
    if (k === this.failOn) throw Object.assign(new Error('f'), { code: 'contention' });
  }
}

async function setup(over: Partial<ApplyInput> = {}) {
  const manifest = await reconcile(buildManifest(plan(), dec(), opts), snap());
  const report = await buildReport(manifest);
  const approval: Approval = {
    project: P,
    household: H,
    manifestHash: report.manifestHash,
    reconciledHash: report.reconciledHash,
    snapshotHash: manifest.snapshotHash!,
    uid: UID,
  };
  const repo = new FakeRepo();
  const store = memoryCheckpoint();
  const input: ApplyInput = {
    manifest,
    confirm: 'CONFIRM',
    approval,
    signature: await signApproval(approval, KEY),
    approvalKey: KEY,
    currentUid: UID,
    freshSnapshotHash: async () => manifest.snapshotHash!,
    repo,
    store,
    ...over,
  };
  return { input, repo, store, manifest, approval };
}

describe('A4 snapshot (mock, bez mreže)', () => {
  const doc = (coll: string, id: string, f: Record<string, unknown>) => ({
    name: `projects/${P}/databases/(default)/documents/households/${H}/${coll}/${id}`,
    fields: f,
  });
  it('parsira i straničenje; root se izostavlja; samo GET URL-ovi unutar kućanstva', async () => {
    const urls: string[] = [];
    const f = async (u: string) => {
      urls.push(u);
      if (u.includes('/locations') && !u.includes('pageToken'))
        return {
          documents: [
            doc('locations', 'root', { name: { stringValue: 'root' } }),
            doc('locations', 'a', {
              name: { stringValue: 'Soba' },
              parentId: { stringValue: 'root' },
              kind: { stringValue: 'room' },
              version: { integerValue: '1' },
              createdBy: { stringValue: 'u' },
            }),
          ],
          nextPageToken: 't2',
        };
      if (u.includes('/locations'))
        return {
          documents: [
            doc('locations', 'b', {
              name: { stringValue: 'Ormar' },
              parentId: { stringValue: 'a' },
              kind: { stringValue: 'cabinet' },
            }),
          ],
        };
      return {};
    };
    const s = await takeSnapshot(f, P, H, () => 'T');
    expect(s.locations.map((l) => [l.id, l.parentId])).toEqual([
      ['a', null],
      ['b', 'a'],
    ]);
    expect(s.locations[0]!.version).toBe(1);
    expect(
      urls.every((u) => u.startsWith('https://firestore.googleapis.com/v1/projects/' + P)),
    ).toBe(true);
  });
  it('odbija strani dokument, loš scope, nepoznatu kolekciju', async () => {
    await expect(
      takeSnapshot(
        async () => ({
          documents: [
            { name: 'projects/drugi/databases/(default)/documents/households/x/locations/a' },
          ],
        }),
        P,
        H,
      ),
    ).rejects.toThrow('SNAPSHOT_FOREIGN_DOCUMENT');
    expect(() => collectionUrl('P/../x', H, 'items')).toThrow('SNAPSHOT_BAD_SCOPE');
    expect(() => collectionUrl(P, H, 'members')).toThrow('SNAPSHOT_BAD_COLLECTION');
  });
  it('restFetcher: samo GET, token u zaglavlju (ne u URL-u), URL izvan opsega odbijen', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => (
      seen.push({ url, init }),
      new Response('{}')
    )) as unknown as typeof fetch;
    const f = restFetcher('TOKEN-X', P, fake);
    await f(collectionUrl(P, H, 'items'));
    expect(seen[0]!.init.method).toBe('GET');
    expect(seen[0]!.url).not.toContain('TOKEN-X');
    await expect(f('https://example.com/x')).rejects.toThrow('SNAPSHOT_URL_OUT_OF_SCOPE');
  });
});

describe('A5 brava apply-a', () => {
  it('sve ispunjeno na demo projektu: COMPLETED, redoslijed lokacije pa stavke', async () => {
    const { input, repo } = await setup();
    const r = await applyPlan(input);
    expect(r.status).toBe('COMPLETED');
    expect(repo.calls).toEqual([
      'loc:imp1-l1',
      'loc:imp1-l2',
      'item:imp1-it-0001',
      'item:imp1-it-0002',
    ]);
  });
  it.each([
    ['CONFIRM', { confirm: 'confirm' }, 'NO_CONFIRM'],
    ['UID', { currentUid: 'uid-drugi' }, 'UID_MISMATCH'],
    ['potpis', { signature: 'a'.repeat(64) }, 'BAD_SIGNATURE'],
    ['ključ', { approvalKey: 'drugi-kljuc-drugi-kljuc-1234' }, 'BAD_SIGNATURE'],
    ['svježi snapshot', { freshSnapshotHash: async () => 'f'.repeat(64) }, 'SNAPSHOT_STALE'],
  ] as const)('zaključano: %s', async (_n, over, reason) => {
    const { input, repo } = await setup(over as Partial<ApplyInput>);
    const r = await applyPlan(input);
    expect(r.status).toBe('LOCKED');
    expect(r.unmet).toContain(reason);
    expect(repo.calls).toHaveLength(0);
  });
  it('zaključano: odobrenje za drugi manifest/plan', async () => {
    const { input, approval } = await setup();
    const bad = { ...approval, manifestHash: 'e'.repeat(64) };
    const r = await applyPlan({ ...input, approval: bad, signature: await signApproval(bad, KEY) });
    expect(r.unmet).toContain('MANIFEST_HASH_MISMATCH');
  });
  it('zaključano: bez snapshota i nespreman plan', async () => {
    const m = await reconcile(buildManifest(plan(), dec(), opts), null);
    const { input } = await setup({ manifest: m });
    const r = await applyPlan(input);
    expect(r.status).toBe('LOCKED');
    expect(r.unmet).toContain('NO_SNAPSHOT');
  });
  it('PRODUKCIJSKI projekt je fizički zaključan i uz sve ostale uvjete', async () => {
    const prod = { expectedProject: 'home-inventory-pwa-218be', expectedHousehold: 'kuca1' };
    const p = plan();
    p.metadata = { firebase_project: prod.expectedProject, household_id: prod.expectedHousehold };
    const manifest = await reconcile(buildManifest(p, dec(), prod), {
      ...snap(),
      meta: { projectId: prod.expectedProject, householdId: prod.expectedHousehold },
    });
    const report = await buildReport(manifest);
    const approval: Approval = {
      project: prod.expectedProject,
      household: prod.expectedHousehold,
      manifestHash: report.manifestHash,
      reconciledHash: report.reconciledHash,
      snapshotHash: manifest.snapshotHash!,
      uid: UID,
    };
    const repo = new FakeRepo();
    const r = await applyPlan({
      manifest,
      confirm: 'CONFIRM',
      approval,
      signature: await signApproval(approval, KEY),
      approvalKey: KEY,
      currentUid: UID,
      freshSnapshotHash: async () => manifest.snapshotHash!,
      repo,
      store: memoryCheckpoint(),
    });
    expect(r.status).toBe('LOCKED');
    expect(r.unmet).toContain('PRODUCTION_APPLY_LOCKED');
    expect(repo.calls).toHaveLength(0);
  });
});

describe('A5/A6 tijek: prekid, nepoznat ishod, ponavljanje (lažni repo)', () => {
  it('greška -> STOP, checkpoint sadrži samo gotove korake; nastavak ne ponavlja gotove', async () => {
    const { input, repo, store } = await setup();
    repo.failOn = 'item:imp1-it-0001';
    const r1 = await applyPlan(input);
    expect(r1.status).toBe('STOPPED');
    expect(Object.keys(store.last!.done)).toEqual(['loc:imp1-l1', 'loc:imp1-l2']);
    repo.failOn = undefined;
    repo.calls = [];
    const r2 = await applyPlan(input);
    expect(r2.status).toBe('COMPLETED');
    expect(repo.calls).toEqual(['item:imp1-it-0001', 'item:imp1-it-0002']);
  });
  it('outcome-unknown + verify applied => nastavlja; not-applied/unknown => STOP bez automatskog ponavljanja', async () => {
    const a = await setup();
    a.repo.unknownOn = 'loc:imp1-l1';
    expect((await applyPlan(a.input)).status).toBe('COMPLETED');
    expect(a.store.last!.done['loc:imp1-l1']!.state).toBe('verified-applied');
    for (const v of ['not-applied', 'unknown', 'changed-elsewhere'] as const) {
      const b = await setup();
      b.repo.unknownOn = 'loc:imp1-l1';
      b.repo.verifyResult = v;
      const r = await applyPlan(b.input);
      expect(r.status).toBe('STOPPED');
      expect(r.stop!.reason).toBe('UNKNOWN_OUTCOME:' + v);
      expect(b.repo.calls).toEqual(['loc:imp1-l1']); // nijedan daljnji upis
    }
  });
  it('checkpoint drugog plana odbijen', async () => {
    const { input, store } = await setup();
    await store.save({
      manifestHash: 'x',
      reconciledHash: 'y',
      snapshotHash: 'z',
      uid: UID,
      done: {},
    });
    expect((await applyPlan(input)).unmet).toContain('CHECKPOINT_FOR_DIFFERENT_PLAN');
  });
  it('maxWrites (stupnjevani apply) staje nakon n upisa', async () => {
    const { input, repo } = await setup({ maxWrites: 1 });
    const r = await applyPlan(input);
    expect(r.stop!.reason).toBe('MAX_WRITES_REACHED');
    expect(repo.calls).toHaveLength(1);
  });
});

describe('A7 planer povrata', () => {
  async function applied() {
    const { input, store, manifest } = await setup();
    await applyPlan(input);
    const cp = store.last!;
    const s: Snapshot = {
      meta: { projectId: P, householdId: H },
      locations: [],
      items: [],
      placements: [],
    };
    for (const w of manifest.planned) {
      if (w.op === 'createLocation')
        s.locations.push({
          id: w.id,
          name: w.name,
          parentId: w.parentId === 'root' ? null : w.parentId,
          kind: w.kind,
          version: 1,
          createdBy: UID,
        });
      else {
        s.items.push({ id: w.itemId, name: w.name, kind: w.kind, version: 1, createdBy: UID });
        s.placements.push({
          id: w.placementId,
          itemId: w.itemId,
          locationId: w.locationId,
          version: 1,
          createdBy: UID,
        });
      }
    }
    return { cp, s };
  }
  it('nepromijenjeno stanje: PROPOSE, djeca prije roditelja, placements prije items', async () => {
    const { cp, s } = await applied();
    const r = planRestore(cp, s, UID);
    expect(r.decision).toBe('PROPOSE');
    const order = r.proposedDeletes.map((d) => d.collection);
    expect(order.indexOf('placements')).toBeLessThan(order.indexOf('items'));
    const locs = r.proposedDeletes.filter((d) => d.collection === 'locations').map((d) => d.id);
    expect(locs).toEqual(['imp1-l2', 'imp1-l1']);
    expect(r.note).toMatch(/NE obećava/);
  });
  it.each([
    ['verzija promijenjena', (s: Snapshot) => void (s.items[0]!.version = 2), 'CHANGED:items/'],
    [
      'drugi autor',
      (s: Snapshot) => void (s.locations[0]!.createdBy = 'netko'),
      'CHANGED:locations/',
    ],
    ['zapis nestao', (s: Snapshot) => void s.items.pop(), 'MISSING:items/'],
    [
      'naknadni placement predmeta',
      (s: Snapshot) =>
        void s.placements.push({
          id: 'later',
          itemId: s.items[0]!.id,
          locationId: 'drugo',
          version: 1,
          createdBy: UID,
        }),
      'LATER_PLACEMENT_FOR_IMPORTED_ITEM:later',
    ],
    [
      'naknadno dijete lokacije',
      (s: Snapshot) =>
        void s.locations.push({
          id: 'dijete',
          name: 'N',
          parentId: s.locations[1]!.id,
          kind: 'box',
          version: 1,
          createdBy: UID,
        }),
      'LATER_CHILD_LOCATION:dijete',
    ],
    [
      'naknadna stavka u uvezenoj lokaciji',
      (s: Snapshot) =>
        void s.placements.push({
          id: 'later2',
          itemId: 'tudji',
          locationId: s.locations[1]!.id,
          version: 1,
          createdBy: 'netko',
        }),
      'LATER_PLACEMENT_IN_IMPORTED_LOCATION:later2',
    ],
  ])('STOP: %s', async (_n, mutate, reason) => {
    const { cp, s } = await applied();
    mutate(s);
    const r = planRestore(cp, s, UID);
    expect(r.decision).toBe('STOP');
    expect(r.proposedDeletes).toHaveLength(0);
    expect(r.stopReasons.some((x) => x.startsWith(reason))).toBe(true);
  });
  it('STOP: pogrešan UID i checkpoint koji je stao; zapisi s imp1- prefiksom izvan checkpointa se ne diraju', async () => {
    const { cp, s } = await applied();
    expect(planRestore(cp, s, 'drugi').decision).toBe('STOP');
    s.items.push({ id: 'imp1-it-9999', name: 'Strani', kind: 'type', version: 1, createdBy: UID });
    const r = planRestore(cp, s, UID);
    expect(r.proposedDeletes.some((d) => d.id === 'imp1-it-9999')).toBe(false);
    cp.stop = { key: 'k', reason: 'r' };
    expect(planRestore(cp, s, UID).decision).toBe('STOP');
  });
  it('"existed" koraci nikad nisu na popisu za brisanje', async () => {
    const { cp, s } = await applied();
    cp.done['loc:imp1-l1']!.state = 'existed';
    expect(planRestore(cp, s, UID).proposedDeletes.some((d) => d.id === 'imp1-l1')).toBe(false);
  });
});
