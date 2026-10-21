import { describe, expect, it } from 'vitest';
import { buildTicketPdf, type RgbImage, type TicketPdfData } from './ticket-pdf';

const image: RgbImage = { width: 2, height: 2, pixels: new Uint8Array(12).fill(255) };
const ticket: TicketPdfData = {
  code: 'ABCD2345', status: 'Válido', drawName: 'Sorteo de demostración', drawDate: '20 oct 2026',
  issuedAt: '20 oct 2026, 12:00', digits: 2, total: '$1.00', lines: [{ number: '42', amount: '$1.00' }],
};

describe('PDF de comprobantes de ticket', () => {
  it('genera un PDF de una página con marca, detalles y recursos gráficos QR/logo', async () => {
    const bytes = new Uint8Array(await buildTicketPdf(ticket, image, image).arrayBuffer());
    const pdf = new TextDecoder('latin1').decode(bytes);
    expect(pdf.slice(0, 8)).toBe('%PDF-1.4');
    expect(pdf).toContain('/Subtype /Image');
    expect(pdf).toContain('/Logo 6 0 R /QR 7 0 R');
    expect(pdf).toContain('COMPROBANTE DE TICKET');
    expect(pdf).toContain('%%EOF');
    const xrefStart = pdf.lastIndexOf('xref\n');
    expect(xrefStart).toBeGreaterThan(0);
    const xref = pdf.slice(xrefStart).split('\n');
    const objectCount = Number(xref[1].split(' ')[1]);
    for (let id = 1; id < objectCount; id += 1) {
      const offset = Number(xref[id + 2].slice(0, 10));
      expect(pdf.slice(offset).startsWith(`${id} 0 obj\n`)).toBe(true);
    }
  });
});
