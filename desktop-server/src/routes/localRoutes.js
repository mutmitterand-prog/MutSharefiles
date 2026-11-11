import { Router } from 'express';
import { ApiError } from '../security/ApiError.js';
import { requireLocal } from '../middleware/auth.js';
import { getLocalIPv4Addresses } from '../services/networkService.js';
import {
  decidePairingRequest,
  getCurrentPairing,
  listPendingRequests,
  renewPairing,
} from '../services/pairingService.js';
import { buildPairingPayload } from '../services/pairingPresenter.js';
import { listDevices, removeDevice } from '../services/deviceService.js';
import {
  addSharedFolder,
  getSettings,
  removeSharedFolder,
  updateComputerName,
} from '../services/settingsService.js';
import { listFolder } from '../services/fileBrowserService.js';
import { deleteOutboxItem, listOutbox } from '../services/outboxService.js';
import { listHistory } from '../services/historyService.js';
import { getDiskSpace } from '../services/diskService.js';
import { createUploadRouter } from './transferRoutes.js';
import { PORT } from '../config.js';

export function createLocalRouter({ onShutdown }) {
  const router = Router();
  router.use(requireLocal);

  router.get('/overview', async (req, res) => {
    const settings = await getSettings();
    const devices = await listDevices();
    const pairing = getCurrentPairing() ?? renewPairing();
    const pairingPayload = pairing ? await buildPairingPayload(pairing.token, pairing.expiresAt) : null;
    const outbox = await listOutbox();
    res.json({
      computerName: settings.computerName,
      port: PORT,
      ips: getLocalIPv4Addresses(),
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      serverStatus: 'running',
      devicesCount: devices.length,
      pendingRequests: listPendingRequests().length,
      outboxCount: outbox.length,
      pairing: pairingPayload,
      disks: await getDiskSpace(settings.sharedFolders),
    });
  });

  router.post('/pairing/renew', async (req, res) => {
    const pairing = renewPairing();
    res.json(await buildPairingPayload(pairing.token, pairing.expiresAt));
  });

  router.get('/pairing/requests', (req, res) => {
    res.json({ items: listPendingRequests() });
  });

  router.post('/pairing/requests/:id/decision', async (req, res) => {
    if (typeof req.body?.accept !== 'boolean') {
      throw new ApiError(400, 'INVALID_DECISION', 'Décision invalide.');
    }
    await decidePairingRequest(req.params.id, req.body.accept);
    res.json({ ok: true });
  });

  router.get('/devices', async (req, res) => {
    res.json({ items: await listDevices() });
  });

  router.delete('/devices/:id', async (req, res) => {
    await removeDevice(req.params.id);
    res.json({ ok: true });
  });

  router.get('/settings', async (req, res) => {
    const settings = await getSettings();
    res.json({ computerName: settings.computerName, port: PORT, sharedFolders: settings.sharedFolders });
  });

  router.put('/settings/computer-name', async (req, res) => {
    await updateComputerName(req.body?.computerName);
    res.json({ ok: true });
  });

  router.post('/settings/shared-folders', async (req, res) => {
    await addSharedFolder({ label: req.body?.label, folderPath: req.body?.path });
    res.status(201).json({ ok: true });
  });

  router.delete('/settings/shared-folders/:id', async (req, res) => {
    await removeSharedFolder(req.params.id);
    res.json({ ok: true });
  });

  router.get('/files', async (req, res) => {
    res.json(await listFolder(String(req.query.root ?? ''), String(req.query.path ?? '')));
  });

  router.get('/outbox', async (req, res) => {
    res.json({ items: await listOutbox() });
  });

  router.delete('/outbox/:id', async (req, res) => {
    await deleteOutboxItem(req.params.id);
    res.json({ ok: true });
  });

  router.get('/history', async (req, res) => {
    res.json({ items: (await listHistory()).slice(0, 500) });
  });

  router.post('/shutdown', (req, res) => {
    res.json({ ok: true });
    setTimeout(() => onShutdown(), 200);
  });

  router.use(createUploadRouter('outbox'));

  return router;
}
