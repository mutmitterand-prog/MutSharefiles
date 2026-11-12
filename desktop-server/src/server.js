import fs from 'node:fs/promises';
import { createApp } from './app.js';
import { APP_VERSION, CLEANUP_INTERVAL_MS, DATA_DIR, HOST, PID_FILE, PORT_FORCED, setActivePort } from './config.js';
import { logger } from './logger.js';
import { cleanupStaleSessions } from './services/uploadService.js';
import { purgeExpiredDevices } from './services/deviceService.js';
import { ensureDefaultFolders } from './services/settingsService.js';
import { getLocalIPv4Addresses } from './services/networkService.js';
import { candidatePorts, findRunningInstance, removePortFile, writePortFile } from './services/portService.js';

/** Demande au système un port TCP libre : aucun port d'une autre application n'est interrompu. */
async function listenOnFreePort(app) {
  const ports = await candidatePorts();
  let lastError;
  for (const port of ports) {
    try {
      const server = await new Promise((resolve, reject) => {
        const candidate = app.listen(port, HOST);
        candidate.once('listening', () => resolve(candidate));
        candidate.once('error', reject);
      });
      return { server, port: server.address()?.port ?? port };
    } catch (error) {
      lastError = error;
      if (error.code !== 'EADDRINUSE' && error.code !== 'EACCES') throw error;
    }
  }
  throw lastError;
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const settings = await ensureDefaultFolders();

  const existing = await findRunningInstance();
  if (existing) {
    console.log(`TRANSFERT est déjà lancé : http://localhost:${existing}`);
    process.exit(0);
  }

  let server;
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    console.log('Arrêt du serveur TRANSFERT...');
    server.close(() => {
      Promise.all([fs.rm(PID_FILE, { force: true }), removePortFile()]).finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };

  const runMaintenance = () =>
    Promise.all([cleanupStaleSessions(), purgeExpiredDevices()]).catch((error) =>
      logger.error('Maintenance échouée', { stack: String(error?.stack ?? error) }),
    );
  await runMaintenance();
  setInterval(runMaintenance, CLEANUP_INTERVAL_MS).unref();

  const app = createApp({ onShutdown: shutdown });
  let port;
  try {
    ({ server, port } = await listenOnFreePort(app));
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      console.error(`Le port ${error.port ?? ''} demandé explicitement est indisponible. Retirez TRANSFERT_PORT pour laisser le système choisir un port libre.`);
    } else {
      console.error('Impossible de démarrer le serveur :', error);
    }
    process.exit(1);
  }
  setActivePort(port);
  // Garde le serveur en vie si une erreur survient après le démarrage.
  server.on('error', (error) => logger.error('Erreur du serveur', { stack: String(error?.stack ?? error) }));
  await writePortFile(port);
  logger.info('Serveur démarré', { version: APP_VERSION, computerName: settings.computerName, port });
  console.log(`TRANSFERT ${APP_VERSION} - "${settings.computerName}" démarré.`);
  console.log('Port attribué automatiquement par le système : aucune autre application n’est interrompue.');
  console.log(`Sur cet ordinateur : http://localhost:${port}`);
  for (const ip of getLocalIPv4Addresses()) {
    console.log(`Sur le réseau Wi-Fi : http://${ip}:${port}`);
  }

  await fs.writeFile(PID_FILE, String(process.pid), 'utf8');
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

process.on('unhandledRejection', (reason) => {
  logger.error('Promesse rejetée non gérée', { stack: String(reason?.stack ?? reason) });
});
process.on('uncaughtException', (error) => {
  logger.error('Exception non gérée', { stack: String(error?.stack ?? error) });
  process.exit(1);
});

main().catch((error) => {
  console.error('Échec du démarrage :', error);
  process.exit(1);
});
