import type { InventoryData } from '../inventory/types';
import { buildPath } from '../inventory/tree';
import { editDistance, normalize, tokenize, typoBudget } from './normalize';
import { synonymsOf } from './synonyms';

/** Redoslijed = rang (manji je bolji). Sve osim 'approx' ide u glavne rezultate; 'approx' u "Približne rezultate". */
export type MatchType = 'name' | 'alias' | 'prefix' | 'partial' | 'synonym' | 'metadata' | 'approx';

const RANK: Record<MatchType, number> = {
  name: 0,
  alias: 1,
  prefix: 2,
  partial: 3,
  synonym: 4,
  metadata: 5,
  approx: 6,
};

export interface ItemHit {
  itemId: string;
  type: MatchType;
  /** Manje je bolje; razlikuje rezultate unutar istog tipa. */
  score: number;
}
export interface LocationHit {
  locationId: string;
  score: number;
}
export interface SearchResult {
  /** Točna, prefiksna, djelomična, sinonimna i metapodatkovna podudaranja (poredano). */
  exact: ItemHit[];
  /** Tek zasebno označeni približni rezultati (tolerancija tipfelera). */
  approx: ItemHit[];
  places: LocationHit[];
}

interface ItemDoc {
  itemId: string;
  name: string; // normalizirano
  nameTokens: string[];
  aliases: string[]; // normalizirano
  aliasTokens: string[];
  metaTokens: string[]; // kategorija, bilješka, izvedene putanje
}
interface LocDoc {
  locationId: string;
  name: string;
  nameTokens: string[];
  pathTokens: string[];
}
export interface SearchIndex {
  items: ItemDoc[];
  locations: LocDoc[];
}

export const MAX_ITEM_RESULTS = 30;
export const MAX_PLACE_RESULTS = 8;

/**
 * Gradi lokalni indeks nad server-potvrđenim podacima (arhivirano se izostavlja). Putanje se izvode iz parentId,
 * pa se i pretraga po lokaciji ("spajza") pronalazi predmete koji su u njoj ili u njezinim podlokacijama.
 */
export function buildSearchIndex(data: InventoryData): SearchIndex {
  const locs = new Map(data.locations.filter((l) => !l.archived).map((l) => [l.id, l]));
  const pathNorm = new Map<string, string>();
  const pathOf = (id: string) => {
    let p = pathNorm.get(id);
    if (p === undefined) pathNorm.set(id, (p = normalize(buildPath(locs, id).slice(1).join(' '))));
    return p;
  };
  const placedIn = new Map<string, string[]>();
  for (const p of data.placements) {
    if (p.archived || !locs.has(p.locationId)) continue;
    (placedIn.get(p.itemId) ?? placedIn.set(p.itemId, []).get(p.itemId)!).push(p.locationId);
  }
  const items: ItemDoc[] = [];
  for (const it of data.items) {
    if (it.archived) continue;
    const name = normalize(it.name);
    const aliases = it.aliases.map(normalize).filter(Boolean);
    items.push({
      itemId: it.id,
      name,
      nameTokens: tokenize(name),
      aliases,
      aliasTokens: aliases.flatMap(tokenize),
      metaTokens: tokenize(
        normalize(
          [it.category, it.note, ...(placedIn.get(it.id) ?? []).map((l) => pathOf(l))].join(' '),
        ),
      ),
    });
  }
  const locations: LocDoc[] = [];
  for (const l of locs.values()) {
    if (l.parentId === null) continue; // root "Kuća" nije odredište pretrage
    const name = normalize(l.name);
    locations.push({
      locationId: l.id,
      name,
      nameTokens: tokenize(name),
      pathTokens: tokenize(pathOf(l.id)),
    });
  }
  return { items, locations };
}

const isPrefixOfAny = (q: string, tokens: string[]) => tokens.some((t) => t.startsWith(q));

/** Svaka riječ upita mora imati POSEBNU riječ izvora koju pokriva `match` (nema lažnih pogodaka za višerječne upite). */
function coverAll(q: string[], src: string[], match: (qt: string, st: string) => number | null) {
  const used = new Set<number>();
  let total = 0;
  for (const qt of q) {
    let best = -1;
    let bestCost = Infinity;
    for (let j = 0; j < src.length; j++) {
      if (used.has(j)) continue;
      const c = match(qt, src[j]!);
      if (c !== null && c < bestCost) {
        best = j;
        bestCost = c;
      }
    }
    if (best < 0) return null;
    used.add(best);
    total += bestCost;
  }
  return total;
}

const prefixCost = (qt: string, st: string) => (st === qt ? 0 : st.startsWith(qt) ? 0.1 : null);
const synonymCost = (qt: string, st: string) => {
  const m = prefixCost(qt, st);
  if (m !== null) return m;
  if (synonymsOf(qt).has(st)) return 0.5;
  for (const s of synonymsOf(qt)) if (st.startsWith(s)) return 0.6;
  return null;
};
/** Tipfeler: cijela riječ (Damerau–Levenshtein) ili prefiks izvora iste duljine za dulje, još nedovršene riječi. */
function typoCost(qt: string, st: string): number | null {
  const budget = typoBudget(qt.length);
  const exact = prefixCost(qt, st);
  if (exact !== null) return exact;
  if (budget === 0) return null;
  const d = editDistance(qt, st, budget);
  if (d <= budget) return d;
  if (qt.length >= 5 && st.length > qt.length) {
    const dp = editDistance(qt, st.slice(0, qt.length), budget);
    if (dp <= budget) return dp + 0.2;
  }
  return null;
}

function classify(
  q: string,
  qTokens: string[],
  d: ItemDoc,
): { type: MatchType; score: number } | null {
  if (d.name === q) return { type: 'name', score: 0 };
  if (d.aliases.includes(q)) return { type: 'alias', score: 0 };
  if (d.name.startsWith(q)) return { type: 'prefix', score: d.name.length / 1000 };
  if (d.aliases.some((a) => a.startsWith(q))) return { type: 'prefix', score: 0.5 };
  const own = [...d.nameTokens, ...d.aliasTokens];
  // djelomično: svaka riječ upita je početak POSEBNE riječi naziva/sinonima (npr. "aku bus" -> "Aku bušilica")
  const part = coverAll(qTokens, own, prefixCost);
  if (part !== null) return { type: 'partial', score: part };
  if (d.name.includes(q) || d.aliases.some((a) => a.includes(q)))
    return { type: 'partial', score: 5 };
  const syn = coverAll(qTokens, own, synonymCost);
  if (syn !== null) return { type: 'synonym', score: syn };
  // metapodaci: sve riječi pokrivene nazivom/sinonimima/kategorijom/bilješkom/putanjom (barem jedna izvan naziva)
  const meta = coverAll(qTokens, [...own, ...d.metaTokens], prefixCost);
  if (meta !== null) return { type: 'metadata', score: meta };
  const typo = coverAll(qTokens, own, typoCost);
  if (typo !== null && typo > 0) return { type: 'approx', score: typo };
  return null;
}

export function search(index: SearchIndex, rawQuery: string): SearchResult {
  const q = normalize(rawQuery);
  if (!q) return { exact: [], approx: [], places: [] };
  const qTokens = tokenize(q);
  const hits: ItemHit[] = [];
  for (const d of index.items) {
    const m = classify(q, qTokens, d);
    if (m) hits.push({ itemId: d.itemId, ...m });
  }
  const nameOf = new Map(index.items.map((d) => [d.itemId, d.name]));
  hits.sort(
    (a, b) =>
      RANK[a.type] - RANK[b.type] ||
      a.score - b.score ||
      (nameOf.get(a.itemId) ?? '').localeCompare(nameOf.get(b.itemId) ?? '', 'hr'),
  );
  const places: LocationHit[] = [];
  for (const l of index.locations) {
    let score: number | null = null;
    if (l.name === q) score = 0;
    else if (l.name.startsWith(q)) score = 1;
    else {
      const c = coverAll(qTokens, l.nameTokens, prefixCost);
      if (c !== null) score = 2 + c;
      else if (qTokens.every((t) => isPrefixOfAny(t, l.pathTokens))) score = 4;
    }
    if (score !== null) places.push({ locationId: l.locationId, score });
  }
  places.sort((a, b) => a.score - b.score);
  const limited = hits.slice(0, MAX_ITEM_RESULTS);
  return {
    exact: limited.filter((h) => h.type !== 'approx'),
    approx: limited.filter((h) => h.type === 'approx'),
    places: places.slice(0, MAX_PLACE_RESULTS),
  };
}
