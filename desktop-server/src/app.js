import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { WEB_DIST_DIR } from './config.js';
import { logger, redact } from './logger.js';
import { ApiError } from './security/ApiError.js';
import { createPublicRouter } from './routes/publicRoutes.js';
import { createLocalRouter } from './routes/localRoutes.js';
import { createDeviceRouter } from './routes/deviceRoutes.js';
import { createDownloadRouter } from './routes/downloadRoutes.js';

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.code, message: error.message, ...error.extra });
    return;
  }
  if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
    res.status(400).json({ error: 'BAD_REQUEST', message: 'Requête invalide.' });
    return;
  }
  if (error.code === 'ECONNRESET' || error.code === 'ERR_STREAM_PREMATURE_CLOSE' || error.message === 'aborted' || req.socket?.destroyed) {
    // Coupure réseau (Wi-Fi) pendant l'envoi d'un bloc : le client reprendra à la position confirmée.
    logger.warn('Connexion interrompue pendant la requête', { method: req.method, url: redact(req.originalUrl) });
    return;
  }
  if (error.code === 'ENOENT') {
    res.status(404).json({ error: 'FILE_NOT_FOUND', message: 'Ce fichier n\'existe plus.' });
    return;
  }
  logger.error('Erreur interne', { method: req.method, url: redact(req.originalUrl), stack: String(error?.stack ?? error) });
  res.status(500).json({ error: 'INTERNAL', message: 'Une erreur interne est survenue.' });
}

export function createApp({ onShutdown }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use('/api', (req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      if (req.method === 'GET' && res.statusCode < 400 && req.path.startsWith('/local/')) return;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      if (res.statusCode < 400 && /\/chunk$|\/ping$|\/overview$/.test(req.path)) return;
      logger[level]('Requête', {
        method: req.method,
        url: redact(req.originalUrl.split('?')[0]),
        status: res.statusCode,
        ms: Date.now() - started,
        ip: req.socket.remoteAddress,
      });
    });
    next();
  });

  const api = express.Router();
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use('/local', createLocalRouter({ onShutdown }));
  api.use('/device', createDeviceRouter());
  api.use(createPublicRouter());
  api.use(createDownloadRouter());
  api.use((req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Route introuvable.' });
  });
  app.use('/api', api);

  if (existsSync(WEB_DIST_DIR)) {
    app.use(express.static(WEB_DIST_DIR, { index: 'index.html', maxAge: 0 }));
    app.get('/{*splat}', (req, res) => {
      res.sendFile(path.join(WEB_DIST_DIR, 'index.html'));
    });
  } else {
    app.get('/', (req, res) => {
      res.type('text/plain; charset=utf-8').send('Interface non compilée. Exécutez scripts/install-windows.bat puis npm run build.');
    });
  }

  app.use(errorHandler);
  return app;
}
