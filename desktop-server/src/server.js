import fs from 'node:fs/promises';
import { createApp } from './app.js';
import { APP_VERSION, CLEANUP_INTERVAL_MS, DATA_DIR, HOST, PID_FILE, PORT } from './config.js';
import { logger } from './logger.js';
import { cleanupStaleSessions } from './services/uploadService.js';
import { purgeExpiredDevices } from './services/deviceService.js';
import { ensureDefaultFolders } from './services/settingsService.js';
import { getLocalIPv4Addresses } from './services/networkService.js';

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const settings = await ensureDefaultFolders();

  let server;
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    console.log('Arrêt du serveur TRANSFERT...');
    server.close(() => {
      fs.rm(PID_FILE, { force: true }).finally(() => process.exit(0));
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
  server = app.listen(PORT, HOST, () => {
    logger.info('Serveur démarré', { version: APP_VERSION, computerName: settings.computerName, port: PORT });
    console.log(`TRANSFERT ${APP_VERSION} - "${settings.computerName}" démarré.`);
    console.log(`Sur cet ordinateur : http://localhost:${PORT}`);
    for (const ip of getLocalIPv4Addresses()) {
      console.log(`Sur le réseau Wi-Fi : http://${ip}:${PORT}`);
    }
  });
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Le port ${PORT} est déjà utilisé. Fermez l'autre application ou changez TRANSFERT_PORT.`);
    } else {
      console.error('Impossible de démarrer le serveur :', error);
    }
    process.exit(1);
  });

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
