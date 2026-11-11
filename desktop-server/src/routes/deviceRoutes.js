import { Router } from 'express';
import { ApiError } from '../security/ApiError.js';
import { getCachedSha256 } from '../services/hashCache.js';
import { requireDevice } from '../middleware/auth.js';
import { removeDevice } from '../services/deviceService.js';
import { getSettings, getSharedFolders } from '../services/settingsService.js';
import { listFolder, resolveFileInFolder } from '../services/fileBrowserService.js';
import { createDownloadTicket } from '../services/downloadTicketService.js';
import { getOutboxItem, listOutbox } from '../services/outboxService.js';
import { listHistory } from '../services/historyService.js';
import { createUploadRouter } from './transferRoutes.js';

export function createDeviceRouter() {
  const router = Router();
  router.use(requireDevice);

  router.get('/ping', async (req, res) => {
    const settings = await getSettings();
    res.json({ ok: true, computerName: settings.computerName, device: req.actor });
  });

  router.post('/disconnect', async (req, res) => {
    await removeDevice(req.actor.id);
    res.json({ ok: true });
  });

  router.get('/roots', async (req, res) => {
    const folders = await getSharedFolders();
    res.json({ items: folders.map((folder) => ({ id: folder.id, label: folder.label })) });
  });

  router.get('/files', async (req, res) => {
    const listing = await listFolder(String(req.query.root ?? ''), String(req.query.path ?? ''));
    res.json(listing);
  });

  router.get('/outbox', async (req, res) => {
    res.json({ items: await listOutbox() });
  });

  router.get('/history', async (req, res) => {
    const history = await listHistory();
    res.json({ items: history.filter((entry) => entry.deviceId === req.actor.id).slice(0, 200) });
  });

  router.post('/downloads', async (req, res) => {
    const body = req.body ?? {};
    let payload;
    if (body.source === 'outbox') {
      const item = await getOutboxItem(String(body.id ?? ''));
      payload = {
        filePath: item.filePath,
        fileName: item.name,
        size: item.size,
        sha256: item.sha256,
      };
    } else if (body.source === 'folder') {
      const file = await resolveFileInFolder(String(body.root ?? ''), String(body.path ?? ''));
      payload = {
        filePath: file.filePath,
        fileName: file.name,
        size: file.size,
        sha256: await getCachedSha256(file.filePath),
      };
    } else {
      throw new ApiError(400, 'INVALID_SOURCE', 'Source de téléchargement inconnue.');
    }
    const ticket = createDownloadTicket({
      ...payload,
      deviceId: req.actor.id,
      deviceName: req.actor.name,
    });
    res.status(201).json({
      url: `/api/download/${ticket.token}`,
      fileName: payload.fileName,
      size: payload.size,
      sha256: payload.sha256,
      expiresAt: ticket.expiresAt,
    });
  });

  router.use(createUploadRouter('folder'));

  return router;
}
