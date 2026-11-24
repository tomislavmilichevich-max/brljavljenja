// A4: READ-ONLY snapshot iz Firestore REST-a (samo GET, samo project/household iz manifesta, token nikad u logove).
// NE POKREĆE SE NA PRODUKCIJI bez izričitog odobrenja vlasnika (docs/IMPORT_PHASE_A_PLAN.md, produkcijski gate).
// REST s Google OAuth/IAM je PRIVILEGIRAN put: čita mimo Rules i NIJE dokaz da korisnička pravila dopuštaju upis.
// Ovdje se koristi isključivo za čitanje; injektirani `fetchJson` omogućuje mock testove bez mreže.
import type { Snapshot, SnapItem, SnapLocation, SnapPlacement } from './types.ts';

export type FetchJson = (url: string) => Promise<unknown>;
const HOST = 'https://firestore.googleapis.com/v1/';
const SAFE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function collectionUrl(
  project: string,
  household: string,
  coll: string,
  pageToken?: string,
): string {
  if (!SAFE.test(project) || !SAFE.test(household)) throw new Error('SNAPSHOT_BAD_SCOPE');
  if (!['locations', 'items', 'placements'].includes(coll))
    throw new Error('SNAPSHOT_BAD_COLLECTION');
  const q = new URLSearchParams({ pageSize: '300' });
  if (pageToken) q.set('pageToken', pageToken);
  return `${HOST}projects/${project}/databases/(default)/documents/households/${household}/${coll}?${q}`;
}

type FV = {
  stringValue?: string;
  integerValue?: string;
  booleanValue?: boolean;
  nullValue?: null;
  timestampValue?: string;
};
const str = (f: Record<string, FV> | undefined, k: string): string | undefined =>
  f?.[k]?.stringValue;
const idOf = (name: string): string => name.slice(name.lastIndexOf('/') + 1);

interface RestDoc {
  name: string;
  fields?: Record<string, FV>;
}
async function listAll(
  fetchJson: FetchJson,
  project: string,
  household: string,
  coll: string,
): Promise<RestDoc[]> {
  const out: RestDoc[] = [];
  let token: string | undefined;
  for (let page = 0; page < 200; page++) {
    const r = (await fetchJson(collectionUrl(project, household, coll, token))) as {
      documents?: RestDoc[];
      nextPageToken?: string;
    } | null;
    if (!r || typeof r !== 'object') throw new Error('SNAPSHOT_BAD_RESPONSE');
    for (const d of r.documents ?? []) {
      const expect = `projects/${project}/databases/(default)/documents/households/${household}/${coll}/`;
      if (typeof d.name !== 'string' || !d.name.startsWith(expect))
        throw new Error('SNAPSHOT_FOREIGN_DOCUMENT');
      out.push(d);
    }
    token = r.nextPageToken;
    if (!token) return out;
  }
  throw new Error('SNAPSHOT_TOO_MANY_PAGES');
}
const audit = (f: Record<string, FV> | undefined) => ({
  version: f?.version?.integerValue === undefined ? undefined : Number(f.version.integerValue),
  archived: f?.archived?.booleanValue === true,
  createdBy: str(f, 'createdBy'),
});

export async function takeSnapshot(
  fetchJson: FetchJson,
  project: string,
  household: string,
  now: () => string = () => new Date().toISOString(),
): Promise<Snapshot> {
  const [l, i, p] = await Promise.all(
    ['locations', 'items', 'placements'].map((c) => listAll(fetchJson, project, household, c)),
  );
  const locations: SnapLocation[] = l!
    .map((d) => ({
      id: idOf(d.name),
      name: str(d.fields, 'name') ?? '',
      parentId: str(d.fields, 'parentId') === 'root' ? null : (str(d.fields, 'parentId') ?? null),
      kind: str(d.fields, 'kind') ?? '',
      ...audit(d.fields),
    }))
    .filter((x) => x.id !== 'root');
  const items: SnapItem[] = i!.map((d) => ({
    id: idOf(d.name),
    name: str(d.fields, 'name') ?? '',
    kind: str(d.fields, 'kind') ?? '',
    ...audit(d.fields),
  }));
  const placements: SnapPlacement[] = p!.map((d) => ({
    id: idOf(d.name),
    itemId: str(d.fields, 'itemId') ?? '',
    locationId: str(d.fields, 'locationId') ?? '',
    ...audit(d.fields),
  }));
  return {
    meta: { projectId: project, householdId: household, takenAt: now() },
    locations,
    items,
    placements,
  };
}

/** Pristup tokenu samo kroz zaglavlje; nikad u URL-u ni logu. Namjerno samo GET. */
export function restFetcher(
  token: string,
  project: string,
  fetchImpl: typeof fetch = fetch,
): FetchJson {
  return async (url) => {
    if (!url.startsWith(`${HOST}projects/${project}/databases/(default)/documents/households/`))
      throw new Error('SNAPSHOT_URL_OUT_OF_SCOPE');
    const r = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': project },
    });
    if (!r.ok) throw new Error(`SNAPSHOT_HTTP_${r.status}`);
    return r.json();
  };
}
