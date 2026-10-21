import { describe, expect, it } from 'vitest';
import { createSessionToken, hashSessionToken } from './session.js';
import { publicError } from './errors.js';

describe('opaque sessions', () => {
  it('stores a digest instead of the raw refresh token', () => {
    const session = createSessionToken();
    expect(session.token).not.toBe(session.tokenHash);
    expect(hashSessionToken(session.token)).toBe(session.tokenHash);
    expect(createSessionToken().token).not.toBe(session.token);
  });
});

describe('public database errors', () => {
  it('maps unique conflicts to a safe 409 without SQL text', () => {
    expect(publicError({ code: '23505', message: 'duplicate key value in users' })).toEqual({ status: 409, code: 'DUPLICATE', message: 'Ya existe una cuenta con esos datos.' });
  });

  it('maps unknown errors to a generic response', () => {
    expect(publicError(new Error('sensitive SQL detail'))).toEqual({ status: 500, code: 'INTERNAL_ERROR', message: 'No pudimos completar la solicitud. Intenta nuevamente.' });
  });
});
