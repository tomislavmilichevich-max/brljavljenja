// A5/A6/A7: apply engine i planer povrata nad PRAVIM repozitorijem i PRAVIM pravilima u emulatoru (demo- projekt,
// sintetski računi i podaci). Produkcija se NE dira. Brisanje klijentom je zabranjeno Rulesima: povrat je zasebna privilegirana radnja.
import { collection, deleteDoc, doc, getDocsFromServer } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyPlan,
  memoryCheckpoint,
  type ApplyInput,
  type ImportRepo,
} from '../src/import/apply.ts';
import { signApproval, type Approval } from '../src/import/approval.ts';
import { buildManifest } from '../src/import/manifest.ts';
import { reconcile, snapshotHash } from '../src/import/reconcile.ts';
import { buildReport } from '../src/import/report.ts';
import { planRestore } from '../src/import/restore.ts';
import type { Decisions, Manifest, Plan, Snapshot } from '../src/import/types.ts';
import { findTreeProblems } from '../src/inventory/tree';
import {
  H,
  PROJECT,
  adminRead,
  closeAdmin,
  openLive,
  seedEmptyHousehold,
  setEnabled,
  signInPrimary,
  type Live,
  type Primary,
} from './helpers';

const KEY = 'emulator-only-approval-key-0123456789';
let pa: Primary, pb: Primary;
let A: Live, B: Live;

beforeAll(async () => {
  pa = await signInPrimary('impA');
  pb = await signInPrimary('impB');
  await fresh();
  A = await openLive(pa);
  B = await openLive(pb);
});
afterAll(async () => {
  await A.session.dispose();
  await B.session.dispose();
  await closeAdmin();
});
beforeEach(async () => {
  await fresh();
});
async function fresh() {
  await seedEmptyHousehold([
    [pa.uid, true],
    [pb.uid, true],
  ]);
  if (A) await A.repo.bootstrap(); // root + meta/tree (izričita radnja, kao u aplikaciji)
}

function plan(): Plan {
  const loc = (id: string, parent: string, name: string, kind: string) => ({
    plan_location_id: id,
    parent_plan_id: parent,
    name,
    kind,
  });
  const cand = (n: number, l: string, name: string) => ({
    candidate_id: `cand-${String(n).padStart(4, '0')}`,
    source_id: `src-${n}`,
    proposed_location_id: l,
    proposed_item_name: name,
    review_status: 'CANDIDATE',
  });
  return {
    metadata: { firebase_project: PROJECT, household_id: H },
    locations: [
      loc('l1', 'root', 'Soba 1', 'room'),
      loc('l2', 'l1', 'Ormar', 'cabinet'),
      loc('l3', 'l2', 'Polica', 'shelf'),
      loc('l4', 'root', 'Soba 2', 'room'),
    ],
    candidates: [
      cand(1, 'l3', 'Predmet A'),
      cand(2, 'l2', 'Predmet B'),
      cand(3, 'l4', 'Predmet B'),
      cand(4, 'l4', 'Predmet C'),
      cand(5, 'l3', 'Predmet D'),
    ],
  };
}
const decisions = (): Decisions => ({
  schema: 1,
  candidates: Object.fromEntries(
    [1, 2, 3, 4, 5].map((n) => [
      `cand-${String(n).padStart(4, '0')}`,
      { decision: 'INCLUDE' as const, kind: n % 2 ? ('type' as const) : ('unique' as const) },
    ]),
  ),
});

async function takeSnap(): Promise<Snapshot> {
  return adminRead(async (db) => {
    const read = async (c: string) =>
      (await getDocsFromServer(collection(db as never, `households/${H}/${c}`))).docs.map((d) => ({
        id: d.id,
        ...(d.data() as Record<string, unknown>),
      }));
    const [l, i, p] = await Promise.all([read('locations'), read('items'), read('placements')]);
    const au = (x: Record<string, unknown>) => ({
      version: x.version as number,
      archived: x.archived === true,
      createdBy: x.createdBy as string,
    });
    return {
      meta: { projectId: PROJECT, householdId: H },
      locations: l
        .filter((x) => x.id !== 'root')
        .map((x) => ({
          id: x.id,
          name: x.name as string,
          parentId: x.parentId === 'root' ? null : (x.parentId as string),
          kind: x.kind as string,
          ...au(x),
        })),
      items: i.map((x) => ({ id: x.id, name: x.name as string, kind: x.kind as string, ...au(x) })),
      placements: p.map((x) => ({
        id: x.id,
        itemId: x.itemId as string,
        locationId: x.locationId as string,
        ...au(x),
      })),
    };
  });
}
const counts = async () => {
  const s = await takeSnap();
  return { loc: s.locations.length, item: s.items.length, pl: s.placements.length };
};

async function prepare(live: Live, over: Partial<ApplyInput> = {}) {
  const snap = await takeSnap();
  const manifest: Manifest = await reconcile(
    buildManifest(plan(), decisions(), { expectedProject: PROJECT, expectedHousehold: H }),
    snap,
  );
  const report = await buildReport(manifest);
  const approval: Approval = {
    project: PROJECT,
    household: H,
    manifestHash: report.manifestHash,
    reconciledHash: report.reconciledHash,
    snapshotHash: manifest.snapshotHash!,
    uid: live.session.uid,
  };
  const input: ApplyInput = {
    manifest,
    confirm: 'CONFIRM',
    approval,
    signature: await signApproval(approval, KEY),
    approvalKey: KEY,
    currentUid: live.session.uid,
    freshSnapshotHash: async () => snapshotHash(await takeSnap()),
    repo: live.repo as unknown as ImportRepo,
    store: memoryCheckpoint(),
    ...over,
  };
  return { input, manifest, report };
}

describe('A5 apply nad stvarnim repozitorijem i Rulesima', () => {
  it('potpuni apply: 4 lokacije + 5 stavki; stablo valjano; verzija 1; autor = član; ključevi postoje', async () => {
    const { input, report } = await prepare(A);
    expect(report.quota.plannedWrites).toBe(4 + 5 * 3);
    const r = await applyPlan(input);
    expect(r).toMatchObject({ status: 'COMPLETED', created: 9 });
    expect(await counts()).toEqual({ loc: 4, item: 5, pl: 5 });
    const s = await takeSnap();
    expect(
      s.locations
        .concat(s.items as never, s.placements as never)
        .every((d) => d.version === 1 && d.createdBy === pa.uid),
    ).toBe(true);
    const keys = await adminRead(
      async (db) =>
        (await getDocsFromServer(collection(db as never, `households/${H}/placementKeys`))).size,
    );
    expect(keys).toBe(5);
    const all = await adminRead(async (db) =>
      (await getDocsFromServer(collection(db as never, `households/${H}/locations`))).docs.map(
        (d) => ({ id: d.id, parentId: d.data().parentId as string | null }),
      ),
    );
    expect(findTreeProblems(all as never)).toEqual([]);
  });
  it('isti naziv na dvije lokacije: dvije zasebne stavke, ništa se ne spaja', async () => {
    await applyPlan((await prepare(A)).input);
    const s = await takeSnap();
    expect(s.items.filter((i) => i.name === 'Predmet B')).toHaveLength(2);
  });
  it('ponavljanje ISTOG importa: novi reconcile = 0 upisa; ponovni apply istog manifesta ne duplicira', async () => {
    const first = await prepare(A);
    await applyPlan(first.input);
    const before = await counts();
    const again = await prepare(A);
    expect(again.manifest.planned).toHaveLength(0);
    expect(again.manifest.items.filter((i) => i.reasons.includes('ALREADY_APPLIED'))).toHaveLength(
      5,
    );
    // namjerno stari manifest + prazan checkpoint: Rules/repo idempotencija (alreadyExisted) i dalje ne smije stvoriti duplikate
    const stale = {
      ...first.input,
      store: memoryCheckpoint(),
      freshSnapshotHash: async () => first.manifest.snapshotHash!,
    };
    const r = await applyPlan(stale);
    expect(r.status).toBe('COMPLETED');
    expect(r.created).toBe(0);
    expect(await counts()).toEqual(before);
  });
  it('zaključan apply ne dira bazu (kriva potvrda / pogrešan UID)', async () => {
    const { input } = await prepare(A, { confirm: 'ok' });
    expect((await applyPlan(input)).status).toBe('LOCKED');
    const other = await prepare(A, { currentUid: pb.uid });
    expect((await applyPlan(other.input)).unmet).toContain('UID_MISMATCH');
    expect(await counts()).toEqual({ loc: 0, item: 0, pl: 0 });
  });
  it('svježi snapshot: promjena baze nakon odobrenja => SNAPSHOT_STALE, nema upisa', async () => {
    const { input } = await prepare(A);
    await B.repo.createLocation({ name: 'Netko drugi', parentId: 'root', kind: 'room' });
    const r = await applyPlan(input);
    expect(r.unmet).toContain('SNAPSHOT_STALE');
    expect((await counts()).item).toBe(0);
  });
  it('onemogućen član: Rules odbijaju, engine staje, ništa nije upisano', async () => {
    const { input } = await prepare(A);
    await setEnabled(pa.uid, false);
    const r = await applyPlan(input);
    expect(r.status).toBe('STOPPED');
    expect(await counts()).toEqual({ loc: 0, item: 0, pl: 0 });
    await setEnabled(pa.uid, true);
  });
  it('klijent ne može brisati (Rules): povrat nije moguć kroz aplikaciju', async () => {
    await applyPlan((await prepare(A)).input);
    await expect(
      deleteDoc(doc(A.session.db, `households/${H}/items/imp1-it-0001`)),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      deleteDoc(doc(A.session.db, `households/${H}/locations/imp1-l1`)),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await counts()).item).toBe(5);
  });
});

describe('A6 prekid, nepoznat ishod, konkurentnost', () => {
  it('prekinut import (pad procesa usred koraka, izgubljen checkpoint): ponovni run završava bez duplikata', async () => {
    const { input } = await prepare(A, {
      onStep: (k) => {
        if (k === 'item:imp1-it-0002') throw new Error('PROCES PAO');
      },
    });
    await expect(applyPlan(input)).rejects.toThrow('PROCES PAO');
    const partial = await counts();
    expect(partial.loc).toBe(4);
    expect(partial.item).toBe(1);
    // nova sesija bez checkpointa: svježi reconcile prepoznaje postojeće (ALREADY_APPLIED) i dovršava ostatak
    const next = await prepare(A);
    expect(next.manifest.planned.length).toBeGreaterThan(0);
    expect((await applyPlan(next.input)).status).toBe('COMPLETED');
    expect(await counts()).toEqual({ loc: 4, item: 5, pl: 5 });
  });
  it('nepoznat ishod nakon STVARNO primijenjenog upisa: verify=applied, nastavlja', async () => {
    const real = A.repo as unknown as ImportRepo;
    let hit = false;
    const wrapped: ImportRepo = {
      ...real,
      createLocation: async (i) => {
        const r = await real.createLocation(i);
        if (!hit && i.id === 'imp1-l2') {
          hit = true;
          throw Object.assign(new Error('veza pala'), { code: 'outcome-unknown' });
        }
        return r;
      },
      createItemWithPlacement: (i) => real.createItemWithPlacement(i),
      verify: (s) => real.verify(s),
    };
    const { input } = await prepare(A, { repo: wrapped });
    const r = await applyPlan(input);
    expect(r.status).toBe('COMPLETED');
    expect(input.store && (await input.store.load())!.done['loc:imp1-l2']!.state).toBe(
      'verified-applied',
    );
    expect(await counts()).toEqual({ loc: 4, item: 5, pl: 5 });
  });
  it('nepoznat ishod PRIJE upisa: verify=not-applied => STOP; ručni nastavak potom dovršava bez duplikata', async () => {
    const real = A.repo as unknown as ImportRepo;
    const wrapped: ImportRepo = {
      ...real,
      createLocation: async (i) => {
        if (i.id === 'imp1-l2')
          throw Object.assign(new Error('veza pala'), { code: 'outcome-unknown' });
        return real.createLocation(i);
      },
      createItemWithPlacement: (i) => real.createItemWithPlacement(i),
      verify: (s) => real.verify(s),
    };
    const { input } = await prepare(A, { repo: wrapped });
    const r = await applyPlan(input);
    expect(r.status).toBe('STOPPED');
    expect(r.stop!.reason).toBe('UNKNOWN_OUTCOME:not-applied');
    expect(await counts()).toEqual({ loc: 2, item: 0, pl: 0 }); // dvije sobe (dubina 0) prije prekida na 'Ormar'
    const next = await prepare(A);
    expect((await applyPlan(next.input)).status).toBe('COMPLETED');
    expect(await counts()).toEqual({ loc: 4, item: 5, pl: 5 });
  });
  it('dva člana istodobno primjenjuju ISTI import: nema duplikata, dovršetak ponovnim runom', async () => {
    const [a, b] = await Promise.all([prepare(A), prepare(B)]);
    await Promise.all([applyPlan(a.input), applyPlan(b.input)]);
    // mogući STOP zbog konkurencije je dopušten; bitno je da NEMA duplikata i da ponovni run konvergira
    const mid = await counts();
    expect(mid.item).toBeLessThanOrEqual(5);
    expect(mid.loc).toBeLessThanOrEqual(4);
    const next = await prepare(A);
    const r = await applyPlan(next.input);
    // ako je prvi krug već sve dovršio, prazan plan je ispravno zaključan (NO_PLANNED_WRITES); inače se dovršava
    if (next.manifest.planned.length === 0)
      expect(r.unmet).toContain('NOT_READY:NO_PLANNED_WRITES');
    else expect(r.status).toBe('COMPLETED');
    expect(await counts()).toEqual({ loc: 4, item: 5, pl: 5 });
    const s = await takeSnap();
    expect(new Set(s.items.map((i) => i.id)).size).toBe(5);
    expect(s.placements.every((p) => s.items.some((i) => i.id === p.itemId))).toBe(true);
  });
});

describe('A6/A7 nepotpun povrat i planer', () => {
  it('planer: nepromijenjeno => PROPOSE; naknadna korisnička promjena => STOP, ništa se ne briše', async () => {
    const { input } = await prepare(A);
    await applyPlan(input);
    const cp = (await input.store.load())!;
    const ok = planRestore(cp, await takeSnap(), pa.uid);
    expect(ok.decision).toBe('PROPOSE');
    expect(ok.proposedDeletes).toHaveLength(5 + 5 + 4);
    // korisnik naknadno doda stavku u uvezenu lokaciju
    await B.repo.createItemWithPlacement({
      name: 'Korisnikova',
      kind: 'type',
      locationId: 'imp1-l3',
    });
    const stopped = planRestore(cp, await takeSnap(), pa.uid);
    expect(stopped.decision).toBe('STOP');
    expect(
      stopped.stopReasons.some((x) => x.startsWith('LATER_PLACEMENT_IN_IMPORTED_LOCATION')),
    ).toBe(true);
    expect(stopped.proposedDeletes).toHaveLength(0);
    expect((await counts()).item).toBe(6); // planer ništa ne mijenja
  });
  it('djelomičan import (STOP usred) daje povrat samo za zapise iz checkpointa', async () => {
    const { input } = await prepare(A, {
      onStep: (k) => {
        if (k === 'item:imp1-it-0003') throw new Error('PROCES PAO');
      },
      maxWrites: undefined,
    });
    await expect(applyPlan(input)).rejects.toThrow();
    const cp = (await input.store.load())!;
    const plan = planRestore(cp, await takeSnap(), pa.uid);
    expect(plan.decision).toBe('PROPOSE');
    expect(plan.proposedDeletes.filter((d) => d.collection === 'items')).toHaveLength(2);
  });
});
