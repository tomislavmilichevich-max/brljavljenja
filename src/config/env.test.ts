import { describe, expect, it } from 'vitest';
import { readFirebaseConfig } from './env';

const full = {
  VITE_FIREBASE_API_KEY: 'k',
  VITE_FIREBASE_AUTH_DOMAIN: 'x.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'x',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1',
  VITE_FIREBASE_APP_ID: '1:1:web:1',
  VITE_HOUSEHOLD_ID: 'h1',
};

describe('readFirebaseConfig', () => {
  it('prazan env: sve obavezne varijable navedene kao nedostajuće', () => {
    const r = readFirebaseConfig({});
    expect(r.status).toBe('missing');
    if (r.status === 'missing') expect(r.missing).toHaveLength(6);
  });
  it('prazni stringovi i razmaci računaju se kao nedostajući', () => {
    const r = readFirebaseConfig({ ...full, VITE_FIREBASE_API_KEY: '  ' });
    expect(r).toEqual({ status: 'missing', missing: ['VITE_FIREBASE_API_KEY'] });
  });
  it('potpun env bez storageBucket je valjan', () => {
    const r = readFirebaseConfig(full);
    expect(r.status).toBe('configured');
    if (r.status === 'configured') {
      expect(r.householdId).toBe('h1');
      expect(r.config.projectId).toBe('x');
    }
  });
});
