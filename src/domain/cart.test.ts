import { describe, expect, it } from 'vitest';
import { centsToUsd, dollarsToCents, totalCartCents } from './cart';
import { isValidPlayedNumber, normalizePlayedInput } from './played-number';

describe('draft cart money helpers', () => {
  it('parses dollar input as exact integer cents', () => {
    expect(dollarsToCents('0.25')).toBe('25');
    expect(dollarsToCents('2')).toBe('200');
    expect(dollarsToCents('2.5')).toBe('250');
    expect(dollarsToCents('1.001')).toBeNull();
  });

  it('formats cents without floating point rounding', () => {
    expect(centsToUsd('100')).toBe('$1.00');
    expect(centsToUsd('99999999999')).toBe('$999,999,999.99');
  });

  it('sums cart draft amounts with bigint', () => {
    const lines = [{ amountCents: '25' }, { amountCents: '75' }];
    expect(totalCartCents(lines)).toBe(100n);
  });
});

describe('played numbers stay text', () => {
  it('preserves leading zeroes and exact modality length', () => {
    expect(normalizePlayedInput('0a7', 2)).toBe('07');
    expect(isValidPlayedNumber('07', 2)).toBe(true);
    expect(isValidPlayedNumber('7', 2)).toBe(false);
    expect(isValidPlayedNumber('007', 3)).toBe(true);
  });
});
