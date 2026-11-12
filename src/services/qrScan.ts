import jsQR from 'jsqr';

export async function readPairingUrlFromImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Impossible de lire la photo.');
    context.drawImage(bitmap, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    const code = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
    if (!code) throw new Error('Aucun QR code détecté. Reprenez la photo bien centrée et nette.');
    return code.data;
  } finally {
    bitmap.close();
  }
}

export function parsePairingUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Ce QR code n\'est pas celui de TRANSFERT.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Ce QR code n\'est pas celui de TRANSFERT.');
  }
  if (!url.searchParams.get('pair')) {
    throw new Error('Ce QR code n\'est pas celui de TRANSFERT.');
  }
  return url;
}
