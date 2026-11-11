import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { logger } from '../logger.js';

/**
 * Lit un fichier JSON. Si le fichier est absent, retourne `fallback`.
 * Si le fichier est corrompu (coupure de courant, disque plein), il est mis de côté
 * en `.corrompu-<date>` et `fallback` est retourné : le serveur reste utilisable.
 */
export async function readJson(filePath, fallback) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const backup = `${filePath}.corrompu-${Date.now()}`;
    await fs.rename(filePath, backup).catch(() => {});
    logger.error('Fichier JSON corrompu, mis de côté', { file: path.basename(filePath), backup: path.basename(backup) });
    return fallback;
  }
}

const queues = new Map();

export function serialize(key, task) {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  const tail = next.catch(() => {});
  queues.set(key, tail);
  tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return next;
}

const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

async function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      // Sous Windows, un antivirus ou l'indexeur peut verrouiller brièvement le fichier.
      if (attempt >= 4 || !RETRYABLE_RENAME_CODES.has(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
}

export async function writeJsonAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await renameWithRetry(tmp, filePath);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}
