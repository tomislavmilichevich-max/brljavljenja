import { describe, expect, it } from 'vitest';
import { classifyAccessError, classifyAuthError, shouldFallBackToRedirect } from './errors';

describe('classifyAuthError', () => {
  it.each([
    ['auth/popup-closed-by-user', 'cancelled'],
    ['auth/network-request-failed', 'network'],
    ['auth/too-many-requests', 'too-many-requests'],
    ['auth/nešto-drugo', 'unknown'],
  ])('%s -> %s', (code, kind) => expect(classifyAuthError({ code })).toBe(kind));
  it('ne pada na neobičnim ulazima', () => {
    expect(classifyAuthError(null)).toBe('unknown');
    expect(classifyAuthError('x')).toBe('unknown');
  });
});

describe('shouldFallBackToRedirect', () => {
  it('samo za blokiran popup / nepodržano okruženje', () => {
    expect(shouldFallBackToRedirect({ code: 'auth/popup-blocked' })).toBe(true);
    expect(
      shouldFallBackToRedirect({ code: 'auth/operation-not-supported-in-this-environment' }),
    ).toBe(true);
    expect(shouldFallBackToRedirect({ code: 'auth/popup-closed-by-user' })).toBe(false);
  });
});

describe('classifyAccessError', () => {
  it('permission-denied je odbijen pristup, a ne greška', () => {
    expect(classifyAccessError({ code: 'permission-denied' })).toBe('denied');
  });
  it('unavailable je offline; ostalo nepoznato', () => {
    expect(classifyAccessError({ code: 'unavailable' })).toBe('offline');
    expect(classifyAccessError(new Error('x'))).toBe('unknown');
  });
});
