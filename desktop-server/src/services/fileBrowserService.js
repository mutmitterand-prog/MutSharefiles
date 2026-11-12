import fs from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from '../security/ApiError.js';
import { normalizeRelativePath, resolveExistingInside, sanitizeFileName } from '../security/paths.js';
import { findSharedFolder } from './settingsService.js';

const MAX_ENTRIES = 2000;

export function toPosixRelative(root, target) {
  return path.relative(root, target).split(path.sep).join('/');
}

export async function listFolder(rootId, relativePath = '') {
  const folder = await findSharedFolder(rootId);
  const dirPath = await resolveExistingInside(folder.path, relativePath);
  const currentRelative = normalizeRelativePath(relativePath);
  let stats;
  try {
    stats = await fs.lstat(dirPath);
  } catch {
    throw new ApiError(404, 'FOLDER_NOT_FOUND', 'Ce dossier n\'existe plus.');
  }
  if (!stats.isDirectory()) {
    throw new ApiError(400, 'NOT_A_FOLDER', 'Ce chemin n\'est pas un dossier.');
  }

  const dirents = await fs.readdir(dirPath, { withFileTypes: true });
  const visible = dirents.filter((entry) => !entry.isSymbolicLink()).slice(0, MAX_ENTRIES);
  const entries = [];
  for (const entry of visible) {
    const entryStats = await fs.lstat(path.join(dirPath, entry.name)).catch(() => null);
    if (!entryStats || (!entryStats.isDirectory() && !entryStats.isFile())) continue;
    const isFolder = entryStats.isDirectory();
    entries.push({
      name: entry.name,
      type: isFolder ? 'folder' : 'file',
      size: isFolder ? null : entryStats.size,
      modifiedAt: entryStats.mtime.toISOString(),
      path: currentRelative ? `${currentRelative}/${entry.name}` : entry.name,
    });
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
  });

  return {
    root: { id: folder.id, label: folder.label },
    path: currentRelative,
    truncated: dirents.length > MAX_ENTRIES,
    entries,
  };
}

export async function resolveFileInFolder(rootId, relativePath) {
  const folder = await findSharedFolder(rootId);
  const filePath = await resolveExistingInside(folder.path, relativePath);
  let stats;
  try {
    stats = await fs.lstat(filePath);
  } catch {
    throw new ApiError(404, 'FILE_NOT_FOUND', 'Ce fichier n\'existe plus.');
  }
  if (!stats.isFile()) {
    throw new ApiError(400, 'NOT_A_FILE', 'Ce chemin n\'est pas un fichier.');
  }
  return { filePath, name: path.basename(filePath), size: stats.size };
}

/** Recherche récursive bornée, sans suivre les liens symboliques. */
export async function searchFiles(rootId, query, maxResults = 500) {
  const folder = await findSharedFolder(rootId);
  const needle = String(query ?? '').trim().toLocaleLowerCase('fr');
  if (needle.length < 2) throw new ApiError(400, 'QUERY_TOO_SHORT', 'Saisissez au moins 2 caractères.');
  const results = [];
  const safeRoot = await resolveExistingInside(folder.path, '');
  const walk = async (absolute, relative) => {
    if (results.length >= maxResults) return;
    const entries = await fs.readdir(absolute, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (results.length >= maxResults) break;
      if (entry.isSymbolicLink()) continue;
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const childAbsolute = path.join(absolute, entry.name);
      if (entry.name.toLocaleLowerCase('fr').includes(needle)) {
        const stats = await fs.lstat(childAbsolute).catch(() => null);
        if (stats && (stats.isFile() || stats.isDirectory())) results.push({
          name: entry.name, path: childRelative, type: stats.isDirectory() ? 'folder' : 'file',
          size: stats.isFile() ? stats.size : null, modifiedAt: stats.mtime.toISOString(),
        });
      }
      if (entry.isDirectory()) await walk(childAbsolute, childRelative);
    }
  };
  await walk(safeRoot, '');
  return { items: results, truncated: results.length >= maxResults };
}

export async function mutateFile(rootId, operation, payload = {}) {
  const folder = await findSharedFolder(rootId);
  const source = await resolveExistingInside(folder.path, String(payload.path ?? ''));
  const sourceStats = await fs.lstat(source);
  if (!sourceStats.isFile() && !sourceStats.isDirectory()) throw new ApiError(400, 'INVALID_ENTRY', 'Type de fichier non pris en charge.');
  const parentRelative = normalizeRelativePath(path.posix.dirname(normalizeRelativePath(payload.path ?? '')) === '.' ? '' : path.posix.dirname(normalizeRelativePath(payload.path ?? '')));
  const parent = await resolveExistingInside(folder.path, parentRelative);
  if (operation === 'delete') {
    await fs.rm(source, { recursive: sourceStats.isDirectory(), force: false });
    return { ok: true };
  }
  if (operation === 'rename') {
    const newName = sanitizeFileName(payload.name);
    const destination = path.join(parent, newName);
    if (destination === source) return { ok: true };
    if (await fs.stat(destination).then(() => true).catch(() => false)) throw new ApiError(409, 'DESTINATION_EXISTS', 'Un élément porte déjà ce nom.');
    await fs.rename(source, destination);
    return { ok: true, name: newName };
  }
  if (operation === 'copy' || operation === 'move') {
    const destinationRelative = normalizeRelativePath(payload.destination ?? '');
    const destinationParent = await resolveExistingInside(folder.path, destinationRelative);
    const destination = path.join(destinationParent, path.basename(source));
    if (destination === source || destination.startsWith(source + path.sep)) throw new ApiError(400, 'INVALID_DESTINATION', 'Destination invalide.');
    if (await fs.stat(destination).then(() => true).catch(() => false)) throw new ApiError(409, 'DESTINATION_EXISTS', 'Un élément porte déjà ce nom à destination.');
    if (operation === 'copy') await fs.cp(source, destination, { recursive: true, errorOnExist: true, force: false });
    else await fs.rename(source, destination);
    return { ok: true };
  }
  if (operation === 'mkdir') {
    const relative = normalizeRelativePath(payload.path ?? '');
    const parentDir = await resolveExistingInside(folder.path, relative);
    const name = sanitizeFileName(payload.name);
    const destination = path.join(parentDir, name);
    await fs.mkdir(destination).catch((error) => {
      if (error.code === 'EEXIST') throw new ApiError(409, 'DESTINATION_EXISTS', 'Ce dossier existe déjà.');
      throw error;
    });
    return { ok: true, name };
  }
  throw new ApiError(400, 'INVALID_OPERATION', 'Opération de gestion inconnue.');
}

export async function getFileMetadata(rootId, relativePath) {
  const { filePath, name, size } = await resolveFileInFolder(rootId, relativePath);
  const stats = await fs.stat(filePath);
  return { name, size, extension: path.extname(name).toLowerCase(), modifiedAt: stats.mtime.toISOString(), createdAt: stats.birthtime.toISOString(), isFile: true };
}
