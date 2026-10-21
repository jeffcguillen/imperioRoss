export async function createTicketQr(verificationUrl: string): Promise<string> {
  const { default: QRCode } = await import('qrcode');
  return QRCode.toDataURL(verificationUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 220,
    color: { dark: '#101411', light: '#ffffff' },
  });
}
