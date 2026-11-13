import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_ROOT = path.resolve(here, '..');
export const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..');
export const DATA_DIR = process.env.TRANSFERT_DATA_DIR
  ? path.resolve(process.env.TRANSFERT_DATA_DIR)
  : path.join(SERVER_ROOT, 'data');
export const WEB_DIST_DIR = path.join(PROJECT_ROOT, 'dist');
export const PID_FILE = path.join(DATA_DIR, 'server.pid');
// Port réellement utilisé par le serveur (écrit au démarrage, supprimé à l'arrêt).
export const PORT_FILE = path.join(DATA_DIR, 'server.port');

export const APP_NAME = 'TRANSFERT';
export const APP_VERSION = '1.0.1';
export const HOST = '0.0.0.0';
// Port préféré pour conserver la compatibilité avec les appareils déjà associés.
// Si ce port est occupé, le serveur essaie automatiquement un port éphémère libre.
export const DEFAULT_PORT = 8787;
// Une surcharge explicite reste possible pour les installations administrées.
const requestedPort = Number(process.env.TRANSFERT_PORT);
export const PORT_FORCED = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65536;
export const PREFERRED_PORT = PORT_FORCED ? requestedPort : DEFAULT_PORT;
// Ports voisins essayés avant un port éphémère : 8787 à 8799. Ils restent stables d'un lancement à l'autre
// et peuvent être autorisés d'un seul bloc dans le pare-feu Windows.
export const PORT_FALLBACK_COUNT = 12;
// Port réel du serveur : défini au démarrage par setActivePort() (liaison « live » pour les autres modules).
export let PORT = PREFERRED_PORT;
export function setActivePort(port) {
  PORT = port;
}

export const PAIRING_TOKEN_TTL_MS = 5 * 60 * 1000;
export const PAIRING_REQUEST_TTL_MS = 2 * 60 * 1000;
export const MAX_PENDING_PAIRING_REQUESTS = 5;
export const DOWNLOAD_TICKET_TTL_MS = 10 * 60 * 1000;
// Taille maximale d'un bloc accepté (1 à 64 Mo, 16 Mo par défaut) : TRANSFERT_MAX_CHUNK_MB.
const requestedChunkMb = Number(process.env.TRANSFERT_MAX_CHUNK_MB);
export const MAX_CHUNK_BYTES =
  (Number.isFinite(requestedChunkMb) && requestedChunkMb >= 1 ? Math.min(Math.floor(requestedChunkMb), 64) : 16) * 1024 * 1024;
// Taille de bloc conseillée aux clients pour démarrer (ils l'adaptent ensuite à la vitesse du réseau).
export const DEFAULT_CHUNK_BYTES = Math.min(4 * 1024 * 1024, MAX_CHUNK_BYTES);

export const DEFAULT_SHARED_FOLDER = {
  id: 'recus',
  label: 'Reçus',
  path: path.join(os.homedir(), 'Downloads', 'TRANSFERT'),
};

export const HISTORY_LIMIT = 1000;

// Appareils jumelés : expiration après une longue inactivité (30 jours par défaut).
export const DEVICE_INACTIVITY_TTL_MS = (Number(process.env.TRANSFERT_DEVICE_TTL_DAYS) || 30) * 24 * 60 * 60 * 1000;
// Transferts abandonnés (fichiers .part) supprimés après 24 h sans activité.
export const STALE_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
// Jumelage : 8 codes erronés en 5 minutes bloquent l'adresse IP pendant 10 minutes.
export const PAIRING_MAX_FAILURES = 8;
export const PAIRING_FAILURE_WINDOW_MS = 5 * 60 * 1000;
export const PAIRING_BLOCK_MS = 10 * 60 * 1000;
// Journal du serveur.
export const LOG_MAX_BYTES = 2 * 1024 * 1024;
export const LOG_KEEP_FILES = 3;
