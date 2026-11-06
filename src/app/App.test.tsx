import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App (P0 placeholder)', () => {
  it('prikazuje naslov i status konfiguracije', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Kućni inventar' })).toBeTruthy();
    expect(screen.getByTestId('firebase-config').textContent).toContain('nije postavljena');
  });
  it('prikazuje mrežni status', () => {
    render(<App />);
    expect(['online', 'offline']).toContain(screen.getByTestId('network').textContent);
  });
});
