// P2-B obveza: provjera integriteta stabla tek nad CJELOVITIM skupom lokacija (djelomičan snapshot ≠ oštećeno stablo).
import { describe, expect, it } from 'vitest';
import { fixture } from './helpers';
import { checkTreeIntegrity, findTreeProblems, type LocNode } from './ops';

const all: LocNode[] = fixture.locations.map((l) => ({ id: l.id, parentId: l.parentId }));

describe('checkTreeIntegrity: cjelovit vs djelomičan skup', () => {
  it('cjelovit zdrav skup (demo kuća) => ok', () => {
    expect(checkTreeIntegrity(all, { complete: true })).toEqual({ status: 'ok' });
  });
  it('DJELOMIČAN skup (stigao samo dio kolekcije) NE smije biti proglašen oštećenim — ishod je incomplete', () => {
    // simulacija prvog dijela snapshota: potomci stigli, roditelji još ne
    const partial = all.filter((l) => !['garage', 'garage-rack'].includes(l.id));
    expect(findTreeProblems(partial).some((p) => p.type === 'missing-parent')).toBe(true); // da je provjera pokrenuta, bila bi LAŽNA uzbuna
    expect(checkTreeIntegrity(partial, { complete: false })).toEqual({ status: 'incomplete' });
  });
  it('prazan i jednočlani početni skup dok se učitava => incomplete, ne "nema roota"', () => {
    expect(checkTreeIntegrity([], { complete: false })).toEqual({ status: 'incomplete' });
    expect(checkTreeIntegrity([{ id: 'kitchen', parentId: 'root' }], { complete: false })).toEqual({
      status: 'incomplete',
    });
  });
  it('isti nepotpuni podaci označeni kao cjeloviti JESU oštećeni (zato je `complete` odgovornost pozivatelja)', () => {
    const partial = all.filter((l) => l.id !== 'garage');
    const r = checkTreeIntegrity(partial, { complete: true });
    expect(r.status).toBe('corrupt');
  });
  it('stvarno oštećen cjelovit skup (ciklus) => corrupt', () => {
    const broken = all.map((l) => (l.id === 'garage-rack' ? { ...l, parentId: 'garage-box' } : l));
    const r = checkTreeIntegrity(broken, { complete: true });
    expect(r.status).toBe('corrupt');
    if (r.status === 'corrupt') expect(r.problems.some((p) => p.type === 'cycle')).toBe(true);
  });
});
