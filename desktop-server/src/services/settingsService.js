import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DATA_DIR, DEFAULT_SHARED_FOLDER } from '../config.js';
import { readJson, writeJsonAtomic } from './jsonStore.js';
import { ApiError } from '../security/ApiError.js';
import { generateId } from '../security/tokens.js';

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const MAX_FOLDERS = 20;

function defaults() {
  return {
    computerName: os.hostname() || 'Mon PC',
    sharedFolders: [{ ...DEFAULT_SHARED_FOLDER }],
  };
}

export async function getSettings() {
  const stored = await readJson(SETTINGS_FILE, null);
  const settings = { ...defaults(), ...(stored ?? {}) };
  if (!Array.isArray(settings.sharedFolders) || settings.sharedFolders.length === 0) {
    settings.sharedFolders = defaults().sharedFolders;
  }
  return settings;
}

async function saveSettings(settings) {
  await writeJsonAtomic(SETTINGS_FILE, settings);
}

export async function ensureDefaultFolders() {
  const settings = await getSettings();
  await saveSettings(settings);
  for (const folder of settings.sharedFolders) {
    await fs.mkdir(folder.path, { recursive: true });
  }
  return settings;
}

export async function getSharedFolders() {
  const settings = await getSettings();
  return settings.sharedFolders;
}

export async function findSharedFolder(rootId) {
  const folders = await getSharedFolders();
  const folder = folders.find((item) => item.id === rootId);
  if (!folder) {
    throw new ApiError(404, 'FOLDER_NOT_FOUND', 'Ce dossier partagé n\'existe pas.');
  }
  return folder;
}

export async function updateComputerName(name) {
  const trimmed = String(name ?? '').trim();
  if (trimmed.length < 1 || trimmed.length > 60) {
    throw new ApiError(400, 'INVALID_NAME', 'Le nom de l\'ordinateur doit contenir entre 1 et 60 caractères.');
  }
  const settings = await getSettings();
  settings.computerName = trimmed;
  await saveSettings(settings);
  return settings;
}

export async function addSharedFolder({ label, folderPath }) {
  const resolved = path.resolve(String(folderPath ?? '').trim());
  if (!path.isAbsolute(resolved)) {
    throw new ApiError(400, 'INVALID_FOLDER', 'Indiquez le chemin complet du dossier.');
  }
  let stats;
  try {
    stats = await fs.stat(resolved);
  } catch {
    throw new ApiError(400, 'FOLDER_MISSING', 'Ce dossier n\'existe pas sur cet ordinateur.');
  }
  if (!stats.isDirectory()) {
    throw new ApiError(400, 'INVALID_FOLDER', 'Le chemin indiqué n\'est pas un dossier.');
  }
  const dataDir = path.resolve(DATA_DIR);
  const overlaps = (a, b) => a === b || a.startsWith(b + path.sep);
  if (overlaps(resolved, dataDir) || overlaps(dataDir, resolved)) {
    throw new ApiError(400, 'FORBIDDEN_FOLDER', 'Ce dossier contient les données internes de TRANSFERT (jetons des appareils) : il ne peut pas être partagé.');
  }
  const settings = await getSettings();
  if (settings.sharedFolders.some((folder) => path.resolve(folder.path) === resolved)) {
    throw new ApiError(409, 'FOLDER_EXISTS', 'Ce dossier est déjà partagé.');
  }
  if (settings.sharedFolders.length >= MAX_FOLDERS) {
    throw new ApiError(400, 'TOO_MANY_FOLDERS', 'Vous ne pouvez pas partager plus de 20 dossiers.');
  }
  const cleanLabel = String(label ?? '').trim().slice(0, 60) || path.basename(resolved) || resolved;
  settings.sharedFolders.push({ id: generateId().slice(0, 12), label: cleanLabel, path: resolved });
  await saveSettings(settings);
  return settings;
}

export async function removeSharedFolder(rootId) {
  const settings = await getSettings();
  const remaining = settings.sharedFolders.filter((folder) => folder.id !== rootId);
  if (remaining.length === settings.sharedFolders.length) {
    throw new ApiError(404, 'FOLDER_NOT_FOUND', 'Ce dossier partagé n\'existe pas.');
  }
  if (remaining.length === 0) {
    throw new ApiError(400, 'LAST_FOLDER', 'Il doit rester au moins un dossier partagé.');
  }
  settings.sharedFolders = remaining;
  await saveSettings(settings);
  return settings;
}
