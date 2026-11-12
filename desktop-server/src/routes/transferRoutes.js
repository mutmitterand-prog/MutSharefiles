import { Router } from 'express';
import { ApiError } from '../security/ApiError.js';
import {
  appendChunk,
  cancelUpload,
  completeUpload,
  createUpload,
  getUploadStatus,
} from '../services/uploadService.js';

export function createUploadRouter(kind) {
  const router = Router();

  router.post('/uploads', async (req, res) => {
    const body = req.body ?? {};
    const session = await createUpload({
      actor: req.actor,
      kind,
      name: body.name,
      size: body.size,
      sha256: body.sha256,
      rootId: body.rootId,
      folder: body.folder,
      policy: body.policy,
    });
    res.status(201).json(session);
  });

  router.get('/uploads/:id', async (req, res) => {
    res.json(await getUploadStatus(req.params.id, req.actor));
  });

  router.patch('/uploads/:id/chunk', async (req, res) => {
    const offset = Number(req.query.offset);
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new ApiError(400, 'INVALID_OFFSET', 'La position du bloc est invalide.');
    }
    res.json(await appendChunk(req.params.id, req.actor, offset, req));
  });

  router.post('/uploads/:id/complete', async (req, res) => {
    res.json(await completeUpload(req.params.id, req.actor));
  });

  router.delete('/uploads/:id', async (req, res) => {
    await cancelUpload(req.params.id, req.actor);
    res.json({ status: 'cancelled' });
  });

  return router;
}
