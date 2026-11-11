import {
  MAX_PENDING_PAIRING_REQUESTS,
  PAIRING_BLOCK_MS,
  PAIRING_FAILURE_WINDOW_MS,
  PAIRING_MAX_FAILURES,
  PAIRING_REQUEST_TTL_MS,
  PAIRING_TOKEN_TTL_MS,
} from '../config.js';
import { createFailureLimiter } from '../security/rateLimiter.js';
import { logger } from '../logger.js';
import { ApiError } from '../security/ApiError.js';
import { generateId, generateToken, hashToken, tokensMatch } from '../security/tokens.js';
import { createDevice, publicDevice } from './deviceService.js';

let currentPairing = null;
const requests = new Map();
const failureLimiter = createFailureLimiter({
  max: PAIRING_MAX_FAILURES,
  windowMs: PAIRING_FAILURE_WINDOW_MS,
  blockMs: PAIRING_BLOCK_MS,
});

function pruneRequests() {
  const cutoff = Date.now() - PAIRING_REQUEST_TTL_MS * 5;
  for (const [id, request] of requests) {
    if (request.createdAt < cutoff) requests.delete(id);
  }
}

function isRequestOpen(request) {
  return request.status === 'pending' && request.expiresAt > Date.now();
}

export function renewPairing() {
  const token = generateToken(18);
  currentPairing = {
    token,
    hash: hashToken(token),
    expiresAt: Date.now() + PAIRING_TOKEN_TTL_MS,
  };
  return { token, expiresAt: new Date(currentPairing.expiresAt).toISOString() };
}

export function getCurrentPairing() {
  if (!currentPairing || currentPairing.expiresAt <= Date.now()) return null;
  return { token: currentPairing.token, expiresAt: new Date(currentPairing.expiresAt).toISOString() };
}

export function createPairingRequest({ token, deviceName, ip }) {
  const blockedMs = failureLimiter.blockedFor(ip);
  if (blockedMs > 0) {
    throw new ApiError(429, 'PAIRING_LOCKED', 'Trop de tentatives de jumelage incorrectes. Réessayez dans quelques minutes.', {
      retryAfterSeconds: Math.ceil(blockedMs / 1000),
    });
  }
  const tokenOk =
    currentPairing &&
    currentPairing.expiresAt > Date.now() &&
    tokensMatch(hashToken(String(token ?? '')), currentPairing.hash);
  if (!tokenOk) {
    failureLimiter.recordFailure(ip);
    logger.warn('Jumelage refusé : code invalide ou expiré', { ip });
    throw new ApiError(401, 'INVALID_PAIRING_TOKEN', 'Le QR code est expiré ou invalide. Renouvelez-le sur le PC.');
  }
  const name = String(deviceName ?? '').trim();
  if (name.length < 1 || name.length > 60) {
    throw new ApiError(400, 'INVALID_DEVICE_NAME', 'Le nom de l\'appareil doit contenir entre 1 et 60 caractères.');
  }
  pruneRequests();
  const openCount = [...requests.values()].filter(isRequestOpen).length;
  if (openCount >= MAX_PENDING_PAIRING_REQUESTS) {
    throw new ApiError(429, 'TOO_MANY_REQUESTS', 'Trop de demandes de jumelage en attente. Réessayez dans un instant.');
  }
  // Le code est à usage unique : il est invalidé dès qu'une demande est créée.
  // Le PC en génère automatiquement un nouveau (voir /api/local/overview).
  currentPairing = null;
  failureLimiter.reset(ip);
  const request = {
    id: generateId(),
    deviceName: name,
    ip,
    status: 'pending',
    createdAt: Date.now(),
    expiresAt: Date.now() + PAIRING_REQUEST_TTL_MS,
    deviceToken: null,
    device: null,
  };
  requests.set(request.id, request);
  logger.info('Demande de jumelage reçue', { ip, deviceName: name });
  return { id: request.id };
}

export function listPendingRequests() {
  return [...requests.values()]
    .filter(isRequestOpen)
    .map((request) => ({
      id: request.id,
      deviceName: request.deviceName,
      ip: request.ip,
      createdAt: new Date(request.createdAt).toISOString(),
    }));
}

export async function decidePairingRequest(id, accept) {
  const request = requests.get(id);
  if (!request) {
    throw new ApiError(404, 'REQUEST_NOT_FOUND', 'Cette demande de jumelage n\'existe plus.');
  }
  if (!isRequestOpen(request)) {
    throw new ApiError(410, 'REQUEST_EXPIRED', 'Cette demande a expiré.');
  }
  if (!accept) {
    request.status = 'rejected';
    logger.info('Jumelage refusé par l\'utilisateur', { deviceName: request.deviceName });
    return;
  }
  request.status = 'accepted';
  try {
    const { device, token } = await createDevice({ name: request.deviceName, ip: request.ip });
    request.device = device;
    request.deviceToken = token;
    logger.info('Appareil jumelé', { deviceName: request.deviceName, deviceId: device.id });
  } catch (error) {
    request.status = 'pending';
    throw error;
  }
}

export function getPairingRequestStatus(id) {
  const request = requests.get(id);
  if (!request) {
    throw new ApiError(404, 'REQUEST_NOT_FOUND', 'Cette demande de jumelage n\'existe plus.');
  }
  if (request.status === 'pending' && request.expiresAt <= Date.now()) {
    request.status = 'expired';
  }
  if (request.status === 'accepted' && request.deviceToken) {
    const payload = { status: 'accepted', deviceToken: request.deviceToken, device: publicDevice(request.device) };
    request.deviceToken = null;
    return payload;
  }
  return { status: request.status };
}

/** Réservé aux tests : remet à zéro l'état en mémoire du jumelage. */
export function resetPairingStateForTests() {
  currentPairing = null;
  requests.clear();
}
