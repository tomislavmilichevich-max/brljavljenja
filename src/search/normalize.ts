/**
 * Normalizacija za pretragu: mala slova, bez dijakritika (č ć š ž), `đ` i `dj` izjednačeni (`đurđevak` = `durdjevak`),
 * sve što nije slovo/broj postaje razmak. Isti postupak primjenjuje se na upit i na podatke.
 */
export function normalize(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/dj/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export const tokenize = (norm: string): string[] => (norm ? norm.split(' ') : []);

/** Damerau–Levenshtein (zamjena susjednih slova = 1) s ranim prekidom iznad `max`; vraća max+1 ako je veće. */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, prev2[j - 2]! + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2.splice(0, prev2.length, ...prev);
    prev = cur;
  }
  return Math.min(prev[b.length]!, max + 1);
}

/** Dopušteni broj tipfelera po riječi upita: kratke riječi (<4) bez tolerancije, 4–6 znakova 1, dulje 2. */
export const typoBudget = (len: number): number => (len >= 7 ? 2 : len >= 4 ? 1 : 0);
