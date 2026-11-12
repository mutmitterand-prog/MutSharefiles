import QRCode from 'qrcode';
import { PORT } from '../config.js';
import { getLocalIPv4Addresses } from './networkService.js';

export async function buildPairingPayload(token, expiresAt) {
  const ip = getLocalIPv4Addresses()[0] ?? '127.0.0.1';
  const url = `http://${ip}:${PORT}/?pair=${encodeURIComponent(token)}`;
  const qrDataUrl = await QRCode.toDataURL(url, {
    margin: 1,
    width: 360,
    errorCorrectionLevel: 'M',
    color: { dark: '#0f172a', light: '#ffffff' },
  });
  return { url, ip, port: PORT, expiresAt, qrDataUrl };
}
