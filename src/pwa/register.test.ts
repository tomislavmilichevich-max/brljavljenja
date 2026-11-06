import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './register';

describe('registerServiceWorker', () => {
  it('unsupported bez serviceWorker API-ja', async () => {
    expect(await registerServiceWorker(true, {})).toBe('unsupported');
  });
  it('dev-disabled izvan produkcije i ne registrira', async () => {
    const register = vi.fn();
    const nav = { serviceWorker: { register } } as unknown as Navigator;
    expect(await registerServiceWorker(false, nav)).toBe('dev-disabled');
    expect(register).not.toHaveBeenCalled();
  });
  it('registered u produkciji', async () => {
    const register = vi.fn().mockResolvedValue({});
    const nav = { serviceWorker: { register } } as unknown as Navigator;
    expect(await registerServiceWorker(true, nav)).toBe('registered');
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });
  it('error ako registracija ne uspije', async () => {
    const register = vi.fn().mockRejectedValue(new Error('x'));
    const nav = { serviceWorker: { register } } as unknown as Navigator;
    expect(await registerServiceWorker(true, nav)).toBe('error');
  });
});
