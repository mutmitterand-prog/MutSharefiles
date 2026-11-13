import QRCode from 'qrcode';
import { PORT } from '../config.js';
import { getLocalIPv4Candidates } from './networkService.js';

export async function buildPairingPayload(token, expiresAt) {
  const candidates = getLocalIPv4Candidates();
  const ip = candidates[0]?.address ?? '127.0.0.1';
  const base = `http://${ip}:${PORT}/?pair=${encodeURIComponent(token)}`;
  // Autres adresses du PC (autre carte réseau) : le téléphone les essaie si la première est injoignable.
  const alts = candidates.slice(1).filter((c) => !c.linkLocal && !c.virtual).map((c) => c.address).slice(0, 3);
  const qrUrl = alts.length > 0 ? `${base}&alt=${alts.join(',')}` : base;
  const qrDataUrl = await QRCode.toDataURL(qrUrl, {
    margin: 1,
    width: 360,
    errorCorrectionLevel: 'M',
    color: { dark: '#0f172a', light: '#ffffff' },
  });
  return { url: base, ip, port: PORT, alts, expiresAt, qrDataUrl };
}
