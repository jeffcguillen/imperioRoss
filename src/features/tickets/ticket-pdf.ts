export interface TicketPdfLine {
  number: string;
  amount: string;
}

export interface TicketPdfData {
  code: string;
  status: string;
  drawName: string;
  drawDate: string;
  issuedAt: string;
  digits: number;
  total: string;
  lines: TicketPdfLine[];
}

export interface RgbImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

const ascii = (value: string) => Uint8Array.from(value, (char) => char.charCodeAt(0));
const concat = (chunks: Uint8Array[]) => {
  const result = new Uint8Array(chunks.reduce((length, item) => length + item.length, 0));
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
};

function pdfString(value: string) {
  const escaped = value.replace(/[\\()]/g, '\\$&').replace(/[\r\n]+/g, ' ');
  const encoded: number[] = [];
  for (const char of escaped) {
    const code = char.codePointAt(0) ?? 63;
    encoded.push(code <= 255 ? code : 63);
  }
  return Uint8Array.from(encoded);
}

const literal = (value: string) => concat([ascii('('), pdfString(value), ascii(')')]);

function text(content: Uint8Array[], value: string, x: number, top: number, size: number, font: 'F1' | 'F2', color: string) {
  content.push(ascii(`${color} rg BT /${font} ${size} Tf 1 0 0 1 ${x} ${top} Tm `), literal(value), ascii(' Tj ET\n'));
}

function drawImage(content: Uint8Array[], name: string, x: number, top: number, width: number, height: number, pageHeight: number) {
  content.push(ascii(`q ${width} 0 0 ${height} ${x} ${pageHeight - top - height} cm /${name} Do Q\n`));
}

function makeContent(ticket: TicketPdfData, logo: RgbImage) {
  const pageWidth = 300;
  const qrTop = 315 + ticket.lines.length * 23;
  const pageHeight = qrTop + 157;
  const content: Uint8Array[] = [];
  content.push(ascii('1 1 1 rg 0 0 300 ' + pageHeight + ' re f\n'));
  content.push(ascii('0.69 0.56 0.29 RG 1.2 w 10 10 280 ' + (pageHeight - 20) + ' re S\n'));
  const logoWidth = Math.min(220, 42 * logo.width / logo.height);
  drawImage(content, 'Logo', 24, 20, logoWidth, logoWidth * logo.height / logo.width, pageHeight);
  content.push(ascii('0.69 0.56 0.29 RG 0.8 w 24 ' + (pageHeight - 72) + ' m 276 ' + (pageHeight - 72) + ' l S\n'));
  text(content, 'COMPROBANTE DE TICKET', 24, pageHeight - 93, 10, 'F2', '0.35 0.28 0.12');
  text(content, ticket.code, 24, pageHeight - 124, 24, 'F2', '0.08 0.10 0.08');
  text(content, `Estado: ${ticket.status}`, 24, pageHeight - 145, 10, 'F2', ticket.status === 'Anulado' ? '0.55 0.15 0.12' : '0.12 0.35 0.18');

  const drawName = ticket.drawName.length > 42 ? `${ticket.drawName.slice(0, 39)}…` : ticket.drawName;
  text(content, drawName, 24, pageHeight - 178, 13, 'F2', '0.08 0.10 0.08');
  text(content, `Fecha del sorteo: ${ticket.drawDate}`, 24, pageHeight - 197, 9, 'F1', '0.27 0.30 0.27');
  text(content, `Emitido: ${ticket.issuedAt}`, 24, pageHeight - 213, 9, 'F1', '0.27 0.30 0.27');
  text(content, `Modalidad: ${ticket.digits} cifras`, 24, pageHeight - 229, 9, 'F1', '0.27 0.30 0.27');

  const tableTop = 260;
  content.push(ascii(`0.95 0.94 0.90 rg 20 ${pageHeight - tableTop - 24} 260 24 re f\n`));
  text(content, 'NÚMERO JUGADO', 28, pageHeight - tableTop - 17, 8, 'F2', '0.30 0.27 0.20');
  text(content, 'VALOR', 220, pageHeight - tableTop - 17, 8, 'F2', '0.30 0.27 0.20');
  let rowTop = tableTop + 24;
  for (const line of ticket.lines) {
    content.push(ascii(`0.84 0.83 0.78 RG 0.5 w 24 ${pageHeight - rowTop - 4} m 276 ${pageHeight - rowTop - 4} l S\n`));
    text(content, line.number, 28, pageHeight - rowTop - 17, 12, 'F2', '0.10 0.13 0.10');
    text(content, line.amount, 220, pageHeight - rowTop - 17, 10, 'F1', '0.10 0.13 0.10');
    rowTop += 23;
  }
  content.push(ascii(`0.95 0.94 0.90 rg 20 ${pageHeight - rowTop - 17} 260 27 re f\n`));
  text(content, 'TOTAL', 28, pageHeight - rowTop - 9, 10, 'F2', '0.30 0.27 0.20');
  text(content, ticket.total, 220, pageHeight - rowTop - 9, 12, 'F2', '0.08 0.10 0.08');

  const qrSize = 104;
  drawImage(content, 'QR', (pageWidth - qrSize) / 2, qrTop, qrSize, qrSize, pageHeight);
  text(content, 'ESCANEA PARA VERIFICAR ESTE TICKET', 46, pageHeight - qrTop - 123, 8, 'F2', '0.30 0.27 0.20');
  text(content, 'El Imperio de Ross · Consulta pública de autenticidad', 29, pageHeight - qrTop - 139, 7, 'F1', '0.38 0.40 0.37');

  return { bytes: concat(content), pageWidth, pageHeight };
}

function pdfImage(image: RgbImage) {
  return concat([
    ascii(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${image.pixels.length} >>\nstream\n`),
    image.pixels,
    ascii('\nendstream'),
  ]);
}

export function buildTicketPdf(ticket: TicketPdfData, logo: RgbImage, qr: RgbImage) {
  const content = makeContent(ticket, logo);
  const objects = [
    ascii('<< /Type /Catalog /Pages 2 0 R >>'),
    ascii('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${content.pageWidth} ${content.pageHeight}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /Logo 6 0 R /QR 7 0 R >> >> /Contents 8 0 R >>`),
    ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
    pdfImage(logo),
    pdfImage(qr),
    concat([ascii(`<< /Length ${content.bytes.length} >>\nstream\n`), content.bytes, ascii('endstream')]),
  ];
  const parts: Uint8Array[] = [ascii('%PDF-1.4\n%ROSS\n')];
  const offsets = [0];
  let offset = parts[0].length;
  objects.forEach((body, index) => {
    const object = concat([ascii(`${index + 1} 0 obj\n`), body, ascii('\nendobj\n')]);
    offsets.push(offset); offset += object.length; parts.push(object);
  });
  const xrefOffset = offset;
  parts.push(ascii(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`));
  for (const itemOffset of offsets.slice(1)) parts.push(ascii(`${String(itemOffset).padStart(10, '0')} 00000 n \n`));
  parts.push(ascii(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
  return new Blob([concat(parts)], { type: 'application/pdf' });
}

async function rasterizePng(source: string): Promise<RgbImage> {
  const image = new Image();
  image.src = source;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('No se pudo cargar una imagen del comprobante.'));
  });
  const scale = Math.min(1, 900 / image.naturalWidth, 300 / image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('El navegador no permite preparar las imágenes del PDF.');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const pixels = new Uint8Array(canvas.width * canvas.height * 3);
  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < rgba.length; sourceIndex += 4, targetIndex += 3) {
    pixels[targetIndex] = rgba[sourceIndex]; pixels[targetIndex + 1] = rgba[sourceIndex + 1]; pixels[targetIndex + 2] = rgba[sourceIndex + 2];
  }
  return { width: canvas.width, height: canvas.height, pixels };
}

export async function createTicketPdf(ticket: TicketPdfData, qrDataUrl: string, logoUrl = '/brand/logo-horizontal.png') {
  const [qr, logo] = await Promise.all([rasterizePng(qrDataUrl), rasterizePng(logoUrl)]);
  return buildTicketPdf(ticket, logo, qr);
}
