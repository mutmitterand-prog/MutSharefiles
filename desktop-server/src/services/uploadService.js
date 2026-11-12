import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, MAX_CHUNK_BYTES, STALE_UPLOAD_MAX_AGE_MS } from '../config.js';
import { logger } from '../logger.js';
import { readJson, renameWithRetry, serialize, writeJsonAtomic } from './jsonStore.js';
import { ApiError } from '../security/ApiError.js';
import { resolveInside, ensureDirectoryInside, sanitizeFileName, normalizeRelativePath } from '../security/paths.js';
import { generateId } from '../security/tokens.js';
import { hashFile } from '../security/hash.js';
import { findSharedFolder } from './settingsService.js';
import { recordTransfer } from './historyService.js';
import { OUTBOX_DIR, outboxPaths } from './outboxService.js';

const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const POLICIES = ['ask', 'rename', 'overwrite'];
const busySessions = new Set();

function sessionPaths(id) {
  return {
    meta: path.join(SESSIONS_DIR, `${id}.json`),
    part: path.join(SESSIONS_DIR, `${id}.part`),
  };
}

async function loadSession(id, actor) {
  const meta = await readJson(sessionPaths(id).meta, null);
  if (!meta || meta.actorId !== actor.id) {
    throw new ApiError(404, 'UPLOAD_NOT_FOUND', 'Ce transfert n\'existe plus.');
  }
  return meta;
}

async function partSize(id) {
  try {
    return (await fs.stat(sessionPaths(id).part)).size;
  } catch {
    throw new ApiError(404, 'UPLOAD_NOT_FOUND', 'Ce transfert n\'existe plus.');
  }
}

async function uniqueFileName(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let index = 1; index < 10000; index += 1) {
    const candidate = path.join(dir, `${stem} (${index})${ext}`);
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new ApiError(409, 'NAME_UNAVAILABLE', 'Impossible de trouver un nom libre pour ce fichier.');
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function publicSession(meta, offset) {
  return {
    id: meta.id,
    name: meta.name,
    size: meta.size,
    offset,
    status: meta.status,
  };
}

async function assertEnoughSpace(size) {
  try {
    const stats = await fs.statfs(SESSIONS_DIR);
    const free = Number(stats.bavail) * Number(stats.bsize);
    if (Number.isFinite(free) && free < size + 64 * 1024 * 1024) {
      throw new ApiError(507, 'INSUFFICIENT_STORAGE', 'Espace disque insuffisant sur le PC pour recevoir ce fichier.');
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // statfs indisponible sur cette plateforme : on ne bloque pas le transfert.
  }
}

async function resolveTargetDirectory(meta) {
  const folder = await findSharedFolder(meta.rootId);
  const dir = await ensureDirectoryInside(folder.path, meta.folder);
  return { folder, dir };
}

export async function createUpload({ actor, kind, name, size, sha256, rootId, folder, policy = 'ask' }) {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new ApiError(400, 'INVALID_SIZE', 'La taille du fichier est invalide.');
  }
  if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) {
    throw new ApiError(400, 'INVALID_HASH', 'L\'empreinte SHA-256 est invalide.');
  }
  if (!POLICIES.includes(policy)) {
    throw new ApiError(400, 'INVALID_POLICY', 'Le choix pour les doublons est invalide.');
  }
  const safeName = sanitizeFileName(name);
  const id = generateId();
  const meta = {
    id,
    kind,
    actorId: actor.id,
    actorName: actor.name,
    name: safeName,
    size,
    sha256,
    policy,
    rootId: null,
    folder: '',
    status: 'uploading',
    createdAt: new Date().toISOString(),
  };

  if (kind === 'folder') {
    const shared = await findSharedFolder(rootId);
    const dir = await ensureDirectoryInside(shared.path, folder ?? '');
    meta.rootId = rootId;
    meta.folder = normalizeRelativePath(folder);
    if (policy === 'ask' && (await exists(path.join(dir, safeName)))) {
      throw new ApiError(409, 'DUPLICATE', 'Un fichier portant ce nom existe déjà à cet emplacement.', {
        fileName: safeName,
      });
    }
  }

  // Reprise automatique : si ce même appareil a déjà une session identique (même fichier, même
  // destination) interrompue, on la reprend à la position déjà reçue au lieu de tout recommencer.
  const resumable = await findResumableSession(meta);
  if (resumable) {
    logger.info('Transfert repris', { uploadId: resumable.meta.id, name: safeName, offset: resumable.offset });
    return publicSession(resumable.meta, resumable.offset);
  }

  await fs.mkdir(SESSIONS_DIR, { recursive: true });
  await assertEnoughSpace(size);
  await fs.writeFile(sessionPaths(id).part, Buffer.alloc(0));
  await writeJsonAtomic(sessionPaths(id).meta, meta);
  return publicSession(meta, 0);
}

async function findResumableSession(wanted) {
  let names;
  try {
    names = await fs.readdir(SESSIONS_DIR);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!/^[a-f0-9]{32}\.json$/.test(name)) continue;
    const candidate = await readJson(path.join(SESSIONS_DIR, name), null);
    if (
      candidate &&
      candidate.status === 'uploading' &&
      candidate.kind === wanted.kind &&
      candidate.actorId === wanted.actorId &&
      candidate.name === wanted.name &&
      candidate.size === wanted.size &&
      candidate.sha256 === wanted.sha256 &&
      candidate.rootId === wanted.rootId &&
      candidate.folder === wanted.folder
    ) {
      const offset = await partSize(candidate.id).catch(() => null);
      if (offset !== null) return { meta: candidate, offset };
    }
  }
  return null;
}

export async function getUploadStatus(id, actor) {
  const meta = await loadSession(id, actor);
  return publicSession(meta, await partSize(id));
}

export async function appendChunk(id, actor, offset, stream) {
  if (busySessions.has(id)) {
    throw new ApiError(409, 'UPLOAD_BUSY', 'Un bloc est déjà en cours d\'envoi pour ce transfert.');
  }
  busySessions.add(id);
  try {
    const meta = await loadSession(id, actor);
    if (meta.status !== 'uploading') {
      throw new ApiError(409, 'UPLOAD_CLOSED', 'Ce transfert est déjà terminé.');
    }
    const current = await partSize(id);
    if (offset !== current) {
      throw new ApiError(409, 'OFFSET_MISMATCH', 'Le bloc ne correspond pas à la position attendue.', {
        offset: current,
      });
    }
    const handle = await fs.open(sessionPaths(id).part, 'r+');
    let written = 0;
    try {
      for await (const chunk of stream) {
        written += chunk.length;
        if (written > MAX_CHUNK_BYTES) {
          throw new ApiError(413, 'CHUNK_TOO_LARGE', 'Le bloc envoyé est trop grand.');
        }
        if (current + written > meta.size) {
          throw new ApiError(400, 'DATA_OVERFLOW', 'Le fichier envoyé est plus grand que prévu.');
        }
        await handle.write(chunk, 0, chunk.length, current + written - chunk.length);
      }
    } finally {
      await handle.close();
    }
    return { offset: current + written };
  } finally {
    busySessions.delete(id);
  }
}

async function discardSession(id) {
  await fs.rm(sessionPaths(id).part, { force: true });
  await fs.rm(sessionPaths(id).meta, { force: true });
}

export async function completeUpload(id, actor) {
  if (busySessions.has(id)) {
    throw new ApiError(409, 'UPLOAD_BUSY', 'Un bloc ou une finalisation est déjà en cours pour ce transfert.');
  }
  busySessions.add(id);
  try {
    return await finalizeUpload(id, actor);
  } finally {
    busySessions.delete(id);
  }
}

async function recordFailure(meta, error) {
  await recordTransfer({
    direction: 'android_to_pc',
    fileName: meta.name,
    size: meta.size,
    deviceId: meta.actorId,
    deviceName: meta.actorName,
    status: 'failed',
    error,
    startedAt: meta.createdAt,
  });
}

async function finalizeUpload(id, actor) {
  const meta = await loadSession(id, actor);
  const current = await partSize(id);
  if (current !== meta.size) {
    throw new ApiError(409, 'INCOMPLETE', 'Le fichier n\'est pas encore entièrement reçu.', { offset: current });
  }

  const actualHash = await hashFile(sessionPaths(id).part);
  if (actualHash !== meta.sha256) {
    await discardSession(id);
    logger.error('Intégrité SHA-256 échouée, fichier supprimé', { uploadId: id, name: meta.name, deviceId: meta.actorId });
    if (meta.kind === 'folder') await recordFailure(meta, 'Vérification SHA-256 échouée');
    throw new ApiError(422, 'INTEGRITY_FAILED', 'La vérification SHA-256 a échoué. Le fichier a été supprimé, relancez le transfert.');
  }

  if (meta.kind === 'outbox') {
    await fs.mkdir(OUTBOX_DIR, { recursive: true });
    const paths = outboxPaths(id);
    await renameWithRetry(sessionPaths(id).part, paths.payload);
    await writeJsonAtomic(paths.meta, {
      id,
      name: meta.name,
      size: meta.size,
      sha256: meta.sha256,
      createdAt: new Date().toISOString(),
    });
    await fs.rm(sessionPaths(id).meta, { force: true });
    logger.info('Fichier ajouté à la liste d\'envoi vers les téléphones', { uploadId: id, name: meta.name, size: meta.size });
    return { status: 'completed', fileName: meta.name, sha256: meta.sha256 };
  }

  const { dir } = await resolveTargetDirectory(meta);
  // La recherche d'un nom libre et le déplacement du fichier forment une seule opération
  // par dossier : deux transferts simultanés du même nom ne peuvent plus s'écraser.
  const finalName = await serialize(`target:${dir}`, async () => {
    let target = path.join(dir, meta.name);
    try {
      const existing = await fs.lstat(target);
      if (existing.isSymbolicLink() || !existing.isFile()) {
        throw new ApiError(403, 'UNSAFE_TARGET', 'La destination existe mais n’est pas un fichier ordinaire.');
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error?.code !== 'ENOENT') throw error;
    }
    if (meta.policy !== 'overwrite' && (await exists(target))) {
      target = await uniqueFileName(dir, meta.name);
    }
    await renameWithRetry(sessionPaths(id).part, target);
    return path.basename(target);
  });
  await fs.rm(sessionPaths(id).meta, { force: true });
  await recordTransfer({
    direction: 'android_to_pc',
    fileName: finalName,
    size: meta.size,
    deviceId: meta.actorId,
    deviceName: meta.actorName,
    status: 'completed',
    startedAt: meta.createdAt,
  });
  logger.info('Fichier reçu', { uploadId: id, name: finalName, size: meta.size, deviceId: meta.actorId });
  return { status: 'completed', fileName: finalName, sha256: meta.sha256 };
}

/**
 * Supprime les transferts abandonnés : sessions sans activité depuis `maxAgeMs`
 * et fichiers .part ou .json orphelins. À appeler au démarrage puis périodiquement.
 */
export async function cleanupStaleSessions(maxAgeMs = STALE_UPLOAD_MAX_AGE_MS) {
  let names;
  try {
    names = await fs.readdir(SESSIONS_DIR);
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  const ids = new Set(names.map((name) => name.replace(/\.(json|part)$/, '')).filter((name) => /^[a-f0-9]{32}$/.test(name)));
  let removed = 0;
  for (const id of ids) {
    if (busySessions.has(id)) continue;
    const { meta, part } = sessionPaths(id);
    const stats = await Promise.all([fs.stat(meta).catch(() => null), fs.stat(part).catch(() => null)]);
    const lastActivity = Math.max(...stats.filter(Boolean).map((item) => item.mtimeMs));
    const age = Date.now() - lastActivity;
    // Un fichier orphelin récent peut être une session en cours de création : on attend 5 minutes.
    const orphan = (!stats[0] || !stats[1]) && age > 5 * 60 * 1000;
    if (orphan || age > maxAgeMs) {
      await discardSession(id);
      removed += 1;
    }
  }
  if (removed > 0) logger.info('Transferts abandonnés supprimés', { count: removed });
  return removed;
}

export function cancelUpload(id, actor) {
  if (busySessions.has(id)) {
    throw new ApiError(409, 'UPLOAD_BUSY', 'Un bloc est encore en cours d\'envoi.');
  }
  return serialize(sessionPaths(id).meta, async () => {
    const meta = await loadSession(id, actor);
    await discardSession(id);
    if (meta.kind === 'folder') {
      await recordTransfer({
        direction: 'android_to_pc',
        fileName: meta.name,
        size: meta.size,
        deviceId: meta.actorId,
        deviceName: meta.actorName,
        status: 'cancelled',
        startedAt: meta.createdAt,
      });
    }
  });
}
