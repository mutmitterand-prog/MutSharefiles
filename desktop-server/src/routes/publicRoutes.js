import { Router } from 'express';
import { APP_NAME, APP_VERSION, DEFAULT_CHUNK_BYTES, MAX_CHUNK_BYTES } from '../config.js';
import { ApiError } from '../security/ApiError.js';
import { getSettings } from '../services/settingsService.js';
import { createPairingRequest, getPairingRequestStatus } from '../services/pairingService.js';

export function createPublicRouter() {
  const router = Router();

  router.get('/info', async (req, res) => {
    // Lecture seule et publique : permet à l'application Android de vérifier que le PC répond.
    res.setHeader('Access-Control-Allow-Origin', '*');
    const settings = await getSettings();
    res.json({
      appName: APP_NAME,
      version: APP_VERSION,
      computerName: settings.computerName,
      maxChunkBytes: MAX_CHUNK_BYTES,
      defaultChunkBytes: DEFAULT_CHUNK_BYTES,
    });
  });

  router.post('/pairing/requests', (req, res) => {
    const body = req.body ?? {};
    if (typeof body.token !== 'string' || body.token.length === 0 || body.token.length > 128) {
      throw new ApiError(400, 'INVALID_PAIRING_TOKEN', 'Le QR code est invalide.');
    }
    const ip = req.socket.remoteAddress?.replace('::ffff:', '') ?? 'inconnue';
    const result = createPairingRequest({ token: body.token, deviceName: body.deviceName, ip });
    res.status(201).json(result);
  });

  router.get('/pairing/requests/:id', (req, res) => {
    res.json(getPairingRequestStatus(req.params.id));
  });

  return router;
}
