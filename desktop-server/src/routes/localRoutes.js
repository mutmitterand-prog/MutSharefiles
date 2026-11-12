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
import { getFileMetadata, listFolder, mutateFile, searchFiles, resolveFileInFolder } from '../services/fileBrowserService.js';
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

  router.get('/files/search', async (req, res) => {
    res.json(await searchFiles(String(req.query.root ?? ''), String(req.query.q ?? '')));
  });

  router.post('/files/operations', async (req, res) => {
    const { rootId, operation, ...payload } = req.body ?? {};
    res.json(await mutateFile(String(rootId ?? ''), String(operation ?? ''), payload));
  });

  router.get('/files/info', async (req, res) => {
    res.json(await getFileMetadata(String(req.query.root ?? ''), String(req.query.path ?? '')));
  });

  router.get('/files/preview', async (req, res, next) => {
    try {
      const file = await resolveFileInFolder(String(req.query.root ?? ''), String(req.query.path ?? ''));
      const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
      const types = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' };
      res.setHeader('Content-Type', types[extension] ?? 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.sendFile(file.filePath, (error) => { if (error && !res.headersSent) next(error); });
    } catch (error) { next(error); }
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
