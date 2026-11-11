import path from 'node:path';
import { DATA_DIR, HISTORY_LIMIT } from '../config.js';
import { readJson, serialize, writeJsonAtomic } from './jsonStore.js';
import { generateId } from '../security/tokens.js';

const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

export async function listHistory() {
  return readJson(HISTORY_FILE, []);
}

export function recordTransfer(entry) {
  return serialize(HISTORY_FILE, async () => {
    const history = await listHistory();
    const endedAt = new Date();
    const startedAt = new Date(entry.startedAt ?? endedAt);
    const record = {
      id: generateId(),
      direction: entry.direction,
      fileName: entry.fileName,
      size: entry.size,
      deviceId: entry.deviceId ?? null,
      deviceName: entry.deviceName,
      status: entry.status,
      error: entry.error ?? null,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: Math.max(0, endedAt - startedAt),
    };
    history.unshift(record);
    await writeJsonAtomic(HISTORY_FILE, history.slice(0, HISTORY_LIMIT));
    return record;
  });
}
