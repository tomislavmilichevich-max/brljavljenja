import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import { ERROR_MESSAGES, messageFor } from './messages';

describe('poruke grešaka', () => {
  it('svaki kod ima poruku; nitko ne tvrdi uspjeh', () => {
    for (const msg of Object.values(ERROR_MESSAGES)) {
      expect(msg.length).toBeGreaterThan(5);
      expect(msg.toLowerCase()).not.toContain('spremljeno na serveru');
    }
  });
  it('offline: sigurno NIJE spremljeno i neće se poslati naknadno', () => {
    expect(messageFor(new DomainError('offline'))).toMatch(
      /NIJE spremljena.*neće se poslati naknadno/,
    );
  });
  it('outcome-unknown: ne tvrdi "nije spremljena" nego da je ishod NEPOZNAT', () => {
    const m = messageFor(new DomainError('outcome-unknown'));
    expect(m).toContain('NEPOZNAT');
    expect(m).not.toContain('NIJE spremljena');
  });
  it('invalid-input prikazuje konkretnu poruku; nepoznata greška daje generičku poruku bez sirovih detalja', () => {
    expect(messageFor(new DomainError('invalid-input', 'Naziv je obavezan.'))).toBe(
      'Naziv je obavezan.',
    );
    expect(messageFor(new Error('INTERNAL: stack trace'))).toBe(ERROR_MESSAGES.unknown);
  });
});
