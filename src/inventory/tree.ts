import type { Location } from './types';

export interface LocNode {
  id: string;
  parentId: string | null;
}
export type TreeProblem =
  | { type: 'no-root' }
  | { type: 'extra-root'; ids: string[] }
  | { type: 'missing-parent'; id: string; parentId: string }
  | { type: 'cycle'; ids: string[] };

/**
 * D1: detekcija OŠTEĆENOG stabla (Rules ne jamče potpunu acikličnost). O(n), iterativno — radi za proizvoljnu dubinu.
 * Root je lokacija s ID-em 'root' i parentId == null. NE pozivati nad nepotpunim skupom (vidi checkTreeIntegrity).
 */
export function findTreeProblems(locs: LocNode[]): TreeProblem[] {
  const problems: TreeProblem[] = [];
  const byId = new Map(locs.map((l) => [l.id, l]));
  const roots = locs.filter((l) => l.parentId === null).map((l) => l.id);
  if (!byId.has('root') || byId.get('root')!.parentId !== null) problems.push({ type: 'no-root' });
  const extra = roots.filter((id) => id !== 'root');
  if (extra.length) problems.push({ type: 'extra-root', ids: extra });
  for (const l of locs) {
    if (l.parentId !== null && !byId.has(l.parentId))
      problems.push({ type: 'missing-parent', id: l.id, parentId: l.parentId });
  }
  const state = new Map<string, 1 | 2>();
  for (const start of locs) {
    if (state.get(start.id) === 2) continue;
    const path: string[] = [];
    let cur: string | null = start.id;
    while (cur !== null && byId.has(cur)) {
      const st = state.get(cur);
      if (st === 2) break;
      if (st === 1) {
        problems.push({ type: 'cycle', ids: path.slice(path.indexOf(cur)) });
        break;
      }
      state.set(cur, 1);
      path.push(cur);
      cur = byId.get(cur)!.parentId;
    }
    for (const id of path) state.set(id, 2);
  }
  return problems;
}

export type TreeCheck =
  { status: 'incomplete' } | { status: 'ok' } | { status: 'corrupt'; problems: TreeProblem[] };

/**
 * Provjera integriteta SAMO nad cjelovitim, server-potvrđenim skupom lokacija (`complete: true`). Na djelomičnom
 * skupu roditelj može samo još nedostajati pa bi `missing-parent` bio lažna uzbuna. Do cjelovitosti: 'incomplete'.
 */
export function checkTreeIntegrity(locs: LocNode[], snapshot: { complete: boolean }): TreeCheck {
  if (!snapshot.complete) return { status: 'incomplete' };
  const problems = findTreeProblems(locs);
  return problems.length ? { status: 'corrupt', problems } : { status: 'ok' };
}

/** Putanja (nazivi od roota do lokacije) izvedena iz parentId; siguran na cikluse i nedostajuće roditelje. */
export function buildPath(locs: Map<string, Location>, id: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const l = locs.get(cur);
    if (!l) break;
    names.unshift(l.name);
    cur = l.parentId;
  }
  return names;
}

/** Je li `maybeDescendant` potomak (ili jednak) lokaciji `ancestorId`? Samo za filtriranje u UI-ju; server/protokol je istina. */
export function isSameOrDescendant(
  locs: Map<string, Location>,
  ancestorId: string,
  maybeDescendant: string,
): boolean {
  const seen = new Set<string>();
  let cur: string | null = maybeDescendant;
  while (cur && !seen.has(cur)) {
    if (cur === ancestorId) return true;
    seen.add(cur);
    cur = locs.get(cur)?.parentId ?? null;
  }
  return false;
}
