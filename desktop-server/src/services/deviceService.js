import path from 'node:path';
import { DATA_DIR, DEVICE_INACTIVITY_TTL_MS } from '../config.js';
import { logger } from '../logger.js';
import { readJson, serialize, writeJsonAtomic } from './jsonStore.js';
import { ApiError } from '../security/ApiError.js';
import { generateId, generateToken, hashToken, tokensMatch } from '../security/tokens.js';

const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');
const LAST_SEEN_WRITE_INTERVAL_MS = 30 * 1000;

function loadDevices() {
  return readJson(DEVICES_FILE, []);
}

export function publicDevice(device) {
  return {
    id: device.id,
    name: device.name,
    ip: device.ip,
    createdAt: device.createdAt,
    lastSeen: device.lastSeen,
  };
}

export async function listDevices() {
  const devices = await loadDevices();
  return devices.map(publicDevice);
}

export function createDevice({ name, ip }) {
  return serialize(DEVICES_FILE, async () => {
    const devices = await loadDevices();
    const token = generateToken(32);
    const now = new Date().toISOString();
    const device = {
      id: generateId(),
      name,
      ip,
      tokenHash: hashToken(token),
      createdAt: now,
      lastSeen: now,
    };
    devices.push(device);
    await writeJsonAtomic(DEVICES_FILE, devices);
    return { device: publicDevice(device), token };
  });
}

export async function authenticateDevice(token) {
  if (!token) return null;
  const candidate = hashToken(token);
  const devices = await loadDevices();
  const device = devices.find((item) => tokensMatch(candidate, item.tokenHash));
  if (!device) return null;
  const idleMs = Date.now() - new Date(device.lastSeen).getTime();
  if (idleMs > DEVICE_INACTIVITY_TTL_MS) {
    logger.warn('Appareil expiré (inactivité), accès refusé', { deviceId: device.id });
    await removeDevice(device.id).catch(() => {});
    return null;
  }
  if (Date.now() - new Date(device.lastSeen).getTime() > LAST_SEEN_WRITE_INTERVAL_MS) {
    await serialize(DEVICES_FILE, async () => {
      const current = await loadDevices();
      const target = current.find((item) => item.id === device.id);
      if (target) {
        target.lastSeen = new Date().toISOString();
        await writeJsonAtomic(DEVICES_FILE, current);
      }
    });
  }
  return publicDevice(device);
}

export function removeDevice(deviceId) {
  return serialize(DEVICES_FILE, async () => {
    const devices = await loadDevices();
    const remaining = devices.filter((item) => item.id !== deviceId);
    if (remaining.length === devices.length) {
      throw new ApiError(404, 'DEVICE_NOT_FOUND', 'Cet appareil n\'est pas associé.');
    }
    await writeJsonAtomic(DEVICES_FILE, remaining);
  });
}

/** Supprime les appareils inactifs depuis trop longtemps. Retourne le nombre supprimé. */
export function purgeExpiredDevices(ttlMs = DEVICE_INACTIVITY_TTL_MS) {
  return serialize(DEVICES_FILE, async () => {
    const devices = await loadDevices();
    const remaining = devices.filter((item) => Date.now() - new Date(item.lastSeen).getTime() <= ttlMs);
    if (remaining.length !== devices.length) await writeJsonAtomic(DEVICES_FILE, remaining);
    return devices.length - remaining.length;
  });
}
