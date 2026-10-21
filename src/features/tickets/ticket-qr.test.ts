import { describe, expect, it } from 'vitest';
import { createTicketQr } from './ticket-qr';

describe('ticket verification QR', () => {
  it('creates a scannable PNG data URL pointing to the public ticket verification page', async () => {
    const result = await createTicketQr('http://localhost:5173/verificar/ABCD2345');
    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(result.length).toBeGreaterThan(500);
  });
});
