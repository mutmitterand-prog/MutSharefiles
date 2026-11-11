import path from 'node:path';
import fs from 'node:fs/promises';
import { ApiError } from './ApiError.js';

// Caractères interdits dans un nom de fichier Windows, plus les caractères de contrôle (U+0000 à U+001F).
// eslint-disable-next-line no-control-regex
const FORBIDDEN_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f]/;

export function sanitizeFileName(rawName) {
  const base = path.basename(String(rawName ?? '')).replace(FORBIDDEN_NAME_CHARS, '_').trim();
  const cleaned = base.replace(/[. ]+$/, '');
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new ApiError(400, 'INVALID_NAME', 'Le nom du fichier est invalide.');
  }
  if (RESERVED_WINDOWS_NAMES.test(cleaned.split('.')[0])) {
    return `_${cleaned}`.slice(0, 200);
  }
  return cleaned.slice(0, 200);
}

/**
 * Vérification lexicale (traversée ../, chemins absolus et lecteurs Windows).
 * Cette fonction reste synchrone pour les validations de paramètres.
 */
export function resolveInside(root, relativePath = '') {
  const rel = String(relativePath ?? '');
  if (CONTROL_CHARS.test(rel)) {
    throw new ApiError(400, 'INVALID_PATH', 'Chemin invalide.', { reason: 'control-characters' });
  }
  const segments = rel.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw new ApiError(400, 'INVALID_PATH', 'Chemin invalide.', { reason: 'dot-segment' });
  }
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) {
    throw new ApiError(400, 'INVALID_PATH', 'Chemin invalide.', { reason: 'absolute-path' });
  }
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new ApiError(403, 'FORBIDDEN_PATH', 'Accès refusé à ce chemin.');
  }
  return target;
}

function isInside(root, target) {
  return target === root || target.startsWith(root + path.sep);
}

async function getRealRoot(root) {
  try {
    const realRoot = await fs.realpath(path.resolve(root));
    const stats = await fs.stat(realRoot);
    if (!stats.isDirectory()) throw new Error('not a directory');
    return realRoot;
  } catch {
    throw new ApiError(404, 'FOLDER_NOT_FOUND', 'Le dossier partagé est introuvable ou inaccessible.');
  }
}

/**
 * Résout un chemin existant en refusant tout lien symbolique/reparse point
 * rencontré dans le chemin. Chaque composant est contrôlé avec lstat().
 */
export async function resolveExistingInside(root, relativePath = '') {
  const lexical = resolveInside(root, relativePath);
  const realRoot = await getRealRoot(root);
  const segments = path.relative(path.resolve(root), lexical).split(path.sep).filter(Boolean);
  let current = realRoot;

  for (const segment of segments) {
    current = path.join(current, segment);
    if (!isInside(realRoot, current)) {
      throw new ApiError(403, 'FORBIDDEN_PATH', 'Accès refusé à ce chemin.');
    }
    let stats;
    try {
      stats = await fs.lstat(current);
    } catch {
      throw new ApiError(404, 'FILE_NOT_FOUND', 'Le chemin demandé n’existe plus.');
    }
    if (stats.isSymbolicLink()) {
      throw new ApiError(403, 'SYMLINK_FORBIDDEN', 'Les liens symboliques ne sont pas autorisés dans un dossier partagé.');
    }
  }
  return current;
}

/**
 * Crée un dossier composant par composant, sans suivre de lien symbolique.
 * Le dossier racine doit déjà exister.
 */
export async function ensureDirectoryInside(root, relativePath = '') {
  resolveInside(root, relativePath);
  const realRoot = await getRealRoot(root);
  const rel = String(relativePath ?? '');
  const segments = rel.split(/[\\/]+/).filter(Boolean);
  let current = realRoot;

  for (const segment of segments) {
    current = path.join(current, segment);
    if (!isInside(realRoot, current)) {
      throw new ApiError(403, 'FORBIDDEN_PATH', 'Accès refusé à ce chemin.');
    }
    try {
      let stats;
      try {
        stats = await fs.lstat(current);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        await fs.mkdir(current);
        stats = await fs.lstat(current);
      }
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new ApiError(403, 'UNSAFE_DIRECTORY', 'Le dossier de destination contient un élément non autorisé.');
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(403, 'UNSAFE_DIRECTORY', 'Impossible de sécuriser le dossier de destination.');
    }
  }
  return current;
}
