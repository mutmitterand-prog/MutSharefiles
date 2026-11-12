import fs from 'node:fs/promises';
import http from 'node:http';
import { APP_NAME, PORT_FILE, PORT_FORCED, PREFERRED_PORT } from '../config.js';

/** Vrai si un serveur TRANSFERT répond sur ce port (et pas une autre application). */
export function isTransfertServer(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/info', method: 'GET', timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (body.length < 4096) body += chunk; });
      res.on('end', () => {
        try {
          resolve(res.statusCode === 200 && JSON.parse(body)?.appName === APP_NAME);
        } catch {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });
}

export async function readSavedPort() {
  try {
    const port = Number((await fs.readFile(PORT_FILE, 'utf8')).trim());
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

/**
 * Essaie d'abord le dernier port réellement utilisé, puis le port historique 8787
 * pour préserver les associations existantes. Si l'un est occupé, 0 demande au
 * système un port libre. Aucun processus tiers n'est arrêté ou modifié.
 */
export async function candidatePorts() {
  if (PORT_FORCED) return [PREFERRED_PORT];
  const saved = await readSavedPort();
  return [...new Set([saved, PREFERRED_PORT, 0].filter((port) => port !== null && port !== undefined))];
}

/** Retourne le port d'un serveur TRANSFERT déjà lancé avec ces données, sinon null. */
export async function findRunningInstance() {
  for (const port of await candidatePorts()) {
    if (port > 0 && await isTransfertServer(port)) return port;
  }
  return null;
}

export const writePortFile = (port) => fs.writeFile(PORT_FILE, String(port), 'utf8');
export const removePortFile = () => fs.rm(PORT_FILE, { force: true });
