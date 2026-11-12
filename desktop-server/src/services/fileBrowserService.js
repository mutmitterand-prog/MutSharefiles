import fs from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from '../security/ApiError.js';
import { normalizeRelativePath, resolveExistingInside } from '../security/paths.js';
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
