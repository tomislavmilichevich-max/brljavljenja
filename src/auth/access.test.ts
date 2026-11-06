import { describe, expect, it } from 'vitest';
import { evaluateAccess } from './access';

describe('evaluateAccess', () => {
  it('postojeći household -> member s nazivom', async () => {
    expect(await evaluateAccess(async () => ({ exists: true, name: 'Dom' }))).toEqual({
      status: 'member',
      householdName: 'Dom',
    });
  });
  it('REGRESIJA P1-REV-01: čitanje uspije, ali household ne postoji -> NIJE member', async () => {
    const r = await evaluateAccess(async () => ({ exists: false, name: null }));
    expect(r).toEqual({ status: 'error', kind: 'household-missing' });
    expect(r.status).not.toBe('member');
  });
  it('permission-denied -> denied', async () => {
    expect(await evaluateAccess(() => Promise.reject({ code: 'permission-denied' }))).toEqual({
      status: 'denied',
    });
  });
  it('unavailable -> offline; nepoznata greška -> unknown (nikad member)', async () => {
    expect(await evaluateAccess(() => Promise.reject({ code: 'unavailable' }))).toEqual({
      status: 'error',
      kind: 'offline',
    });
    expect(await evaluateAccess(() => Promise.reject(new Error('x')))).toEqual({
      status: 'error',
      kind: 'unknown',
    });
  });
});
