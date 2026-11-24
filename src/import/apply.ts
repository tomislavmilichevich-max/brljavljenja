// A5: apply engine (SAMO dizajn + emulator testovi; produkcijski apply je ZAKLJUČAN, vidi lock.ts).
// Piše isključivo kroz repozitorij aplikacije kao član (Rules ostaju na snazi): nikad Admin SDK/IAM.
// Svaki upis ima deterministički ID => ponovni run je idempotentan; STOP na prvoj nejasnoći; checkpoint nakon svakog koraka.
import { hashOf } from './canonical.ts';
import { isDemoProject, PRODUCTION_APPLY_ENABLED } from './lock.ts';
import { verifyApproval, type Approval } from './approval.ts';
import { buildReport, type Report } from './report.ts';
import type { Manifest, PlannedWrite } from './types.ts';

export interface ImportRepo {
  createLocation(i: {
    name: string;
    parentId: string;
    kind: never | string;
    id?: string;
  }): Promise<{ id: string; alreadyExisted?: boolean }>;
  createItemWithPlacement(i: {
    name: string;
    kind: 'unique' | 'type';
    locationId: string;
    note?: string | null;
    attempt?: { itemId: string; placementId: string };
  }): Promise<{ itemId: string; placementId: string; alreadyExisted?: boolean }>;
  verify(
    spec:
      | { op: 'createItem'; itemId: string; placementId: string; locationId: string }
      | { op: 'createLocation'; id: string },
  ): Promise<'applied' | 'not-applied' | 'changed-elsewhere' | 'unknown'>;
}

export type StepState = 'created' | 'existed' | 'verified-applied';
export interface Checkpoint {
  manifestHash: string;
  reconciledHash: string;
  snapshotHash: string;
  uid: string;
  done: Record<string, { state: StepState; ids: string[]; at: number }>;
  stop?: { key: string; reason: string };
}
export interface CheckpointStore {
  load(): Promise<Checkpoint | null>;
  save(c: Checkpoint): Promise<void>;
}
export const memoryCheckpoint = (): CheckpointStore & { last: Checkpoint | null } => {
  const s = {
    last: null as Checkpoint | null,
    load: async () => s.last && structuredClone(s.last),
    save: async (c: Checkpoint) => void (s.last = structuredClone(c)),
  };
  return s;
};

export interface ApplyInput {
  manifest: Manifest; // već usklađen (reconcile) sa snapshotom
  confirm: string; // mora biti točno 'CONFIRM'
  approval: Approval;
  signature: string;
  approvalKey: string; // lokalni tajni ključ vlasnika (nije u repozitoriju)
  currentUid: string; // UID prijavljenog člana (potvrđen izvan ovog modula)
  freshSnapshotHash: () => Promise<string>; // ponovno uzet snapshot neposredno prije
  repo: ImportRepo;
  store: CheckpointStore;
  maxWrites?: number; // stupnjevani apply (npr. prvo 1 lokacija)
  onStep?: (key: string) => void; // samo za testove (prekid/ometanje)
}
export type ApplyStatus = 'LOCKED' | 'COMPLETED' | 'STOPPED';
export interface ApplyResult {
  status: ApplyStatus;
  unmet: string[];
  created: number;
  skipped: number;
  stop?: { key: string; reason: string };
}

const codeOf = (e: unknown): string => (e as { code?: string })?.code ?? 'unknown';

/** Popis neispunjenih uvjeta; prazan = apply smije krenuti. Redoslijed je namjerno neovisan (svi razlozi se prijavljuju). */
export async function gateProblems(inp: ApplyInput, report: Report): Promise<string[]> {
  const m = inp.manifest;
  const u: string[] = [];
  if (!isDemoProject(m.project) && !PRODUCTION_APPLY_ENABLED) u.push('PRODUCTION_APPLY_LOCKED');
  if (inp.confirm !== 'CONFIRM') u.push('NO_CONFIRM');
  if (!m.snapshotHash) u.push('NO_SNAPSHOT');
  if (!report.readiness.ready) u.push('NOT_READY:' + report.readiness.reasons.join('+'));
  const a = inp.approval;
  if (a.project !== m.project || a.household !== m.household) u.push('APPROVAL_SCOPE_MISMATCH');
  if (a.manifestHash !== report.manifestHash) u.push('MANIFEST_HASH_MISMATCH');
  if (a.reconciledHash !== report.reconciledHash) u.push('RECONCILED_HASH_MISMATCH');
  if (a.snapshotHash !== m.snapshotHash) u.push('APPROVAL_SNAPSHOT_MISMATCH');
  if (!(await verifyApproval(a, inp.signature, inp.approvalKey))) u.push('BAD_SIGNATURE');
  if (!a.uid || a.uid !== inp.currentUid) u.push('UID_MISMATCH');
  if (u.length === 0 && (await inp.freshSnapshotHash()) !== m.snapshotHash)
    u.push('SNAPSHOT_STALE');
  return u;
}

export async function applyPlan(inp: ApplyInput): Promise<ApplyResult> {
  const m = inp.manifest;
  const report = await buildReport(m);
  const unmet = await gateProblems(inp, report);
  if (unmet.length) return { status: 'LOCKED', unmet, created: 0, skipped: 0 };

  let cp = await inp.store.load();
  if (cp && (cp.reconciledHash !== report.reconciledHash || cp.snapshotHash !== m.snapshotHash))
    return { status: 'LOCKED', unmet: ['CHECKPOINT_FOR_DIFFERENT_PLAN'], created: 0, skipped: 0 };
  cp ??= {
    manifestHash: report.manifestHash,
    reconciledHash: report.reconciledHash,
    snapshotHash: m.snapshotHash!,
    uid: inp.currentUid,
    done: {},
  };
  delete cp.stop;
  let created = 0;
  let skipped = 0;
  const stop = async (key: string, reason: string): Promise<ApplyResult> => {
    cp!.stop = { key, reason };
    await inp.store.save(cp!);
    return { status: 'STOPPED', unmet: [], created, skipped, stop: { key, reason } };
  };
  for (const w of m.planned) {
    if (cp.done[w.key]) {
      skipped++;
      continue;
    }
    if (inp.maxWrites !== undefined && created >= inp.maxWrites)
      return {
        status: 'STOPPED',
        unmet: [],
        created,
        skipped,
        stop: { key: w.key, reason: 'MAX_WRITES_REACHED' },
      };
    inp.onStep?.(w.key);
    try {
      const r = await writeOne(inp.repo, w);
      cp.done[w.key] = { state: r.existed ? 'existed' : 'created', ids: r.ids, at: Date.now() };
      if (!r.existed) created++;
    } catch (e) {
      if (codeOf(e) !== 'outcome-unknown') return stop(w.key, 'ERR:' + codeOf(e));
      const v = await inp.repo
        .verify(
          w.op === 'createLocation'
            ? { op: 'createLocation', id: w.id }
            : {
                op: 'createItem',
                itemId: w.itemId,
                placementId: w.placementId,
                locationId: w.locationId,
              },
        )
        .catch(() => 'unknown' as const);
      if (v !== 'applied') return stop(w.key, 'UNKNOWN_OUTCOME:' + v); // nikad automatski ponavljanje ni nastavak
      cp.done[w.key] = { state: 'verified-applied', ids: idsOf(w), at: Date.now() };
      created++;
    }
    await inp.store.save(cp);
  }
  await inp.store.save(cp);
  return { status: 'COMPLETED', unmet: [], created, skipped };
}

const idsOf = (w: PlannedWrite): string[] =>
  w.op === 'createLocation' ? [w.id] : [w.itemId, w.placementId];
async function writeOne(
  repo: ImportRepo,
  w: PlannedWrite,
): Promise<{ existed: boolean; ids: string[] }> {
  if (w.op === 'createLocation') {
    const r = await repo.createLocation({
      name: w.name,
      parentId: w.parentId,
      kind: w.kind,
      id: w.id,
    });
    return { existed: !!r.alreadyExisted, ids: [w.id] };
  }
  const r = await repo.createItemWithPlacement({
    name: w.name,
    kind: w.kind,
    locationId: w.locationId,
    note: w.note ?? null,
    attempt: { itemId: w.itemId, placementId: w.placementId },
  });
  return { existed: !!r.alreadyExisted, ids: [w.itemId, w.placementId] };
}
export { hashOf };
