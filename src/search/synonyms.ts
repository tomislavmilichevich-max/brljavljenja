import { normalize } from './normalize';

/**
 * Ugrađene skupine uobičajenih kućnih sinonima (već normalizirane pri učitavanju). Riječ iz skupine pronalazi
 * predmet koji sadrži BILO KOJU riječ iste skupine. Sinonimi pojedinog predmeta (`Item.aliases`) dolaze iz podataka.
 */
const GROUPS: string[][] = [
  ['šarafciger', 'odvijač'],
  ['kabel', 'kabl'],
  ['daljinski', 'daljinac'],
];

const map = new Map<string, Set<string>>();
for (const g of GROUPS) {
  const words = new Set(g.map(normalize));
  for (const w of words) {
    const s = map.get(w) ?? new Set<string>();
    for (const x of words) if (x !== w) s.add(x);
    map.set(w, s);
  }
}

/** Sinonimi (normalizirani) jedne normalizirane riječi; prazno ako ih nema. */
export const synonymsOf = (token: string): ReadonlySet<string> => map.get(token) ?? EMPTY;
const EMPTY: ReadonlySet<string> = new Set();
