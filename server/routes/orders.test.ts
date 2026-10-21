import { describe, expect, it } from 'vitest';
import { detectMime } from '../security/proofs.js';

describe('proof file signature validation', () => {
  it('recognizes supported formats from file bytes', () => {
    expect(detectMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectMime(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe('image/jpeg');
    expect(detectMime(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
  });

  it('rejects a spoofed extension without a supported signature', () => {
    expect(detectMime(Buffer.from('not a pdf'))).toBeNull();
  });
});
