// A3: dry-run izvještaj. Bez snapshota ili bez potvrđene vrste: "NOT READY FOR APPLY" (izvještaj je i tada koristan).
// Imena stavki/lokacija ulaze SAMO uz includeNames (lokalna datoteka izvan repozitorija); inače samo ID-evi i brojke.
import { hashOf } from './canonical.ts';
import { manifestHash } from './manifest.ts';
import type { Manifest, Status } from './types.ts';

export const SPARK_FREE = { writesPerDay: 20000, readsPerDay: 50000 } as const; // objavljene besplatne kvote; provjeriti u Usage

type Counts = Record<Status, number>;
const zero = (): Counts => ({ CREATE: 0, MATCH: 0, REVIEW: 0, HOLD: 0, SKIP: 0, BLOCKED: 0 });

export interface Report {
  project: string;
  household: string;
  manifestHash: string;
  snapshotHash: string | null;
  reconciledHash: string;
  readiness: { ready: boolean; label: string; reasons: string[] };
  apply: 'NOT AUTHORIZED';
  counts: { locations: Counts; items: Counts };
  byRoom: Record<string, { locations: Counts; items: Counts }>;
  reasonCounts: Record<string, number>;
  quota: {
    plannedWrites: number;
    clientTxReads: number;
    writesPctOfDaily: number;
    readsPctOfDaily: number;
    note: string;
  };
  confirmedKinds: number;
  potential: { reviewItems: number; writesIfAllConfirmed: number; note: string };
  creates: { locations: unknown[]; items: unknown[] };
  uncertainties: unknown[];
  existing: unknown[];
  warnings: string[];
}

export async function buildReport(
  m: Manifest,
  opts: { includeNames?: boolean } = {},
): Promise<Report> {
  const names = !!opts.includeNames;
  const counts = { locations: zero(), items: zero() };
  const byRoom: Report['byRoom'] = {};
  const reasonCounts: Record<string, number> = {};
  const room = (r: string | undefined) =>
    (byRoom[r ?? '?'] ??= { locations: zero(), items: zero() });
  for (const l of m.locations) {
    counts.locations[l.status]++;
    room(l.room).locations[l.status]++;
    for (const r of l.reasons) reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
  }
  for (const i of m.items) {
    counts.items[i.status]++;
    room(i.room).items[i.status]++;
    for (const r of i.reasons) reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
  }
  const locCreate = m.planned.filter((p) => p.op === 'createLocation').length;
  const itemCreate = m.planned.length - locCreate;
  const plannedWrites = locCreate + itemCreate * 3; // Location 1 dokument; Item + Placement + placementKey = 3
  const clientTxReads = locCreate * 2 + itemCreate * 3; // samo tx.get u repozitoriju; Rules get()/getAfter() NISU uključeni (nemjereno)
  const confirmedKinds = m.items.filter((i) => i.kind).length;
  const reasons: string[] = [];
  if (!m.snapshotHash) reasons.push('NO_SNAPSHOT');
  if (m.blockers.length || counts.locations.BLOCKED || counts.items.BLOCKED)
    reasons.push('BLOCKED_PRESENT');
  if (confirmedKinds === 0) reasons.push('NO_CONFIRMED_KINDS');
  if (m.planned.length === 0) reasons.push('NO_PLANNED_WRITES');
  const ready = reasons.length === 0;
  const unresolved = m.items.filter((i) => i.status === 'REVIEW' || i.status === 'BLOCKED');
  return {
    project: m.project,
    household: m.household,
    manifestHash: await manifestHash(m),
    snapshotHash: m.snapshotHash,
    reconciledHash: await hashOf({
      planned: m.planned,
      snapshotHash: m.snapshotHash,
      project: m.project,
      household: m.household,
    }),
    readiness: {
      ready,
      label: ready ? 'READY FOR OWNER REVIEW (apply nije autoriziran)' : 'NOT READY FOR APPLY',
      reasons,
    },
    apply: 'NOT AUTHORIZED',
    counts,
    byRoom,
    reasonCounts,
    quota: {
      plannedWrites,
      clientTxReads,
      writesPctOfDaily: Math.round((plannedWrites / SPARK_FREE.writesPerDay) * 1000) / 10,
      readsPctOfDaily: Math.round((clientTxReads / SPARK_FREE.readsPerDay) * 1000) / 10,
      note: 'PROCJENA za odabrani skup. Rules get()/getAfter() i stvarna potrošnja nisu mjereni; provjeriti emulator mjerenjem i Usage prije apply.',
    },
    confirmedKinds,
    potential: {
      reviewItems: counts.items.REVIEW,
      writesIfAllConfirmed: counts.items.REVIEW * 3,
      note: 'Samo informativno: REVIEW stavke se NE pripremaju za upis dok vlasnik ne potvrdi (INCLUDE + kind).',
    },
    creates: {
      locations: m.planned
        .filter((p) => p.op === 'createLocation')
        .map((p) =>
          p.op === 'createLocation'
            ? {
                id: p.id,
                parentId: p.parentId,
                kind: p.kind,
                planId: p.planId,
                ...(names ? { name: p.name } : {}),
              }
            : null,
        ),
      items: m.planned
        .filter((p) => p.op === 'createItemWithPlacement')
        .map((p) =>
          p.op === 'createItemWithPlacement'
            ? {
                itemId: p.itemId,
                placementId: p.placementId,
                locationId: p.locationId,
                kind: p.kind,
                candidateId: p.candidateId,
                sourceId: p.sourceId,
                ...(names ? { name: p.name } : {}),
              }
            : null,
        ),
    },
    uncertainties: unresolved.map((i) => ({
      candidateId: i.candidateId,
      sourceId: i.sourceId,
      status: i.status,
      reasons: i.reasons,
      flags: i.flags,
      kindSuggestion: i.kindSuggestion,
      ...(names ? { name: i.name } : {}),
    })),
    existing: [
      ...m.locations
        .filter((l) => l.existingId)
        .map((l) => ({ planId: l.planId, existingId: l.existingId })),
      ...m.items
        .filter((i) => i.existingItemId)
        .map((i) => ({ candidateId: i.candidateId, existingItemId: i.existingItemId })),
    ],
    warnings: [...m.problems, ...m.blockers],
  };
}

export function renderMarkdown(r: Report): string {
  const row = (c: Counts) =>
    `CREATE ${c.CREATE} · MATCH ${c.MATCH} · REVIEW ${c.REVIEW} · HOLD ${c.HOLD} · SKIP ${c.SKIP} · BLOCKED ${c.BLOCKED}`;
  const L = [
    `# Dry-run uvoza — ${r.readiness.label}`,
    '',
    `Projekt \`${r.project}\` · kućanstvo \`${r.household}\` · **apply: ${r.apply}**`,
    `Hash manifesta: \`${r.manifestHash}\``,
    `Hash snapshota: \`${r.snapshotHash ?? '—'}\` · hash usklađenog plana: \`${r.reconciledHash}\``,
    r.readiness.reasons.length ? `Razlozi: ${r.readiness.reasons.join(', ')}` : '',
    '',
    `## Sažetak`,
    `- Lokacije: ${row(r.counts.locations)}`,
    `- Stavke: ${row(r.counts.items)}`,
    `- Potvrđenih vrsta (kind): ${r.confirmedKinds}`,
    `- Potencijal (NIJE pripremljeno): ${r.potential.reviewItems} REVIEW stavki ≈ ${r.potential.writesIfAllConfirmed} upisa kad bi se sve potvrdile`,
    `- Planirani upisi: ${r.quota.plannedWrites} (${r.quota.writesPctOfDaily} % dnevne kvote upisa); čitanja tx: ${r.quota.clientTxReads} (${r.quota.readsPctOfDaily} %)`,
    `- ${r.quota.note}`,
    '',
    '## Po prostoriji',
    ...Object.entries(r.byRoom).map(
      ([k, v]) => `- **${k}** — lokacije: ${row(v.locations)}; stavke: ${row(v.items)}`,
    ),
    '',
    '## Razlozi (broj pojavljivanja)',
    ...Object.entries(r.reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `- ${k}: ${v}`),
    '',
    r.warnings.length ? `## Upozorenja\n${r.warnings.map((w) => `- ${w}`).join('\n')}` : '',
  ];
  return L.filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n') + '\n';
}
