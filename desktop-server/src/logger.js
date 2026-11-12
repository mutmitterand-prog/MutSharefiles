import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, LOG_MAX_BYTES, LOG_KEEP_FILES } from './config.js';

const LOG_DIR = path.join(DATA_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');
let ready = false;

function ensureReady() {
  if (ready) return true;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    ready = true;
  } catch {
    // Le journal fichier est facultatif : on continue avec la console seule.
  }
  return ready;
}

function rotateIfNeeded() {
  try {
    const { size } = fs.statSync(LOG_FILE);
    if (size < LOG_MAX_BYTES) return;
  } catch {
    return;
  }
  try {
    for (let index = LOG_KEEP_FILES - 1; index >= 1; index -= 1) {
      const from = `${LOG_FILE}.${index}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${LOG_FILE}.${index + 1}`);
    }
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    fs.rmSync(`${LOG_FILE}.${LOG_KEEP_FILES + 1}`, { force: true });
  } catch {
    // Rotation impossible (fichier verrouillé sous Windows) : on réessaiera.
  }
}

/** Masque les secrets susceptibles d'apparaître dans une URL ou un message (texte brut). */
export function redact(text) {
  return String(text)
    .replace(/(\/api\/download\/)[^/?\s"'\\]+/g, '$1[masqué]')
    .replace(/([?&](?:pair|token)=)[^&\s"'\\]+/gi, '$1[masqué]')
    .replace(/(Bearer\s+)[A-Za-z0-9_-]+/g, '$1[masqué]');
}

/** Applique redact() à chaque texte d'un objet, sans jamais toucher à la structure JSON. */
function redactValue(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item)]));
  }
  return value;
}

function write(level, message, fields) {
  let line;
  try {
    line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message: redact(message),
    ...(fields ? redactValue(fields) : {}),
    });
  } catch {
    line = JSON.stringify({ time: new Date().toISOString(), level, message: 'Entrée de journal illisible' });
  }
  // Console : seulement les avertissements et erreurs ; tout est conservé dans logs/server.log.
  if (level === 'error' || level === 'warn') console.error(line);
  if (ensureReady()) {
    rotateIfNeeded();
    try {
      fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
    } catch {
      // Ignoré : ne jamais faire planter le serveur à cause du journal.
    }
  }
}

export const logger = {
  info: (message, fields) => write('info', message, fields),
  warn: (message, fields) => write('warn', message, fields),
  error: (message, fields) => write('error', message, fields),
};
