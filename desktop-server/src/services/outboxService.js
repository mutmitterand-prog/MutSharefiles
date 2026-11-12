import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { readJson } from './jsonStore.js';
import { ApiError } from '../security/ApiError.js';

export const OUTBOX_DIR = path.join(DATA_DIR, 'outbox');
const ITEM_ID_PATTERN = /^[a-f0-9]{32}$/;

export function outboxPaths(id) {
  if (!ITEM_ID_PATTERN.test(String(id))) {
    throw new ApiError(404, 'OUTBOX_ITEM_NOT_FOUND', 'Ce fichier n\'est plus disponible.');
  }
  return {
    meta: path.join(OUTBOX_DIR, `${id}.json`),
    payload: path.join(OUTBOX_DIR, `${id}.bin`),
  };
}

export async function listOutbox() {
  let names;
  try {
    names = await fs.readdir(OUTBOX_DIR);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const items = [];
  for (const name of names.filter((item) => item.endsWith('.json'))) {
    const id = name.slice(0, -'.json'.length);
    if (!ITEM_ID_PATTERN.test(id)) continue;
    const meta = await readJson(outboxPaths(id).meta, null);
    if (meta) items.push({ id: meta.id, name: meta.name, size: meta.size, sha256: meta.sha256, createdAt: meta.createdAt });
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getOutboxItem(id) {
  const meta = await readJson(outboxPaths(id).meta, null);
  if (!meta) {
    throw new ApiError(404, 'OUTBOX_ITEM_NOT_FOUND', 'Ce fichier n\'est plus disponible.');
  }
  return { ...meta, filePath: outboxPaths(id).payload };
}

export async function deleteOutboxItem(id) {
  const paths = outboxPaths(id);
  const meta = await readJson(paths.meta, null);
  if (!meta) {
    throw new ApiError(404, 'OUTBOX_ITEM_NOT_FOUND', 'Ce fichier n\'est plus disponible.');
  }
  await fs.rm(paths.payload, { force: true });
  await fs.rm(paths.meta, { force: true });
}
