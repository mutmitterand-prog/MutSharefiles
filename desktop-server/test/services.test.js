// Tests des services sans Express : ils s'exécutent avec Node.js seul.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transfert-svc-'));
const sharedDir = path.join(dataDir, 'partage');
process.env.TRANSFERT_DATA_DIR = dataDir;
process.env.TRANSFERT_DEVICE_TTL_DAYS = '30';

const { createFailureLimiter } = await import('../src/security/rateLimiter.js');
const pairing = await import('../src/services/pairingService.js');
const devices = await import('../src/services/deviceService.js');
const uploads = await import('../src/services/uploadService.js');
const { readJson, writeJsonAtomic } = await import('../src/services/jsonStore.js');
const { requireLocal } = await import('../src/middleware/auth.js');
const settings = await import('../src/services/settingsService.js');
const { redact } = await import('../src/logger.js');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

before(async () => {
  await fs.mkdir(sharedDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({
    computerName: 'PC-Test',
    sharedFolders: [{ id: 'partage', label: 'Partage', path: sharedDir }],
  }));
});
after(async () => { await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {}); });

async function pairDevice(name) {
  const { token } = pairing.renewPairing();
  const request = pairing.createPairingRequest({ token, deviceName: name, ip: '192.168.1.50' });
  await pairing.decidePairingRequest(request.id, true);
  return pairing.getPairingRequestStatus(request.id);
}

async function upload(actor, name, data, { policy = 'rename', chunk = 1024 } = {}) {
  const session = await uploads.createUpload({
    actor, kind: 'folder', name, size: data.length, sha256: sha(data), rootId: 'partage', folder: '', policy,
  });
  for (let offset = 0; offset < data.length; offset += chunk) {
    await uploads.appendChunk(session.id, actor, offset, (async function* () { yield data.subarray(offset, offset + chunk); })());
  }
  return session;
}

test('limiteur : blocage après N échecs puis déblocage', () => {
  let time = 1000;
  const limiter = createFailureLimiter({ max: 3, windowMs: 60000, blockMs: 120000, now: () => time });
  limiter.recordFailure('ip');
  limiter.recordFailure('ip');
  assert.equal(limiter.blockedFor('ip'), 0);
  limiter.recordFailure('ip');
  assert.ok(limiter.blockedFor('ip') > 0);
  assert.equal(limiter.blockedFor('autre'), 0);
  time += 121000;
  assert.equal(limiter.blockedFor('ip'), 0);
});

test('jumelage : le code est à usage unique', async () => {
  const { token } = pairing.renewPairing();
  const first = pairing.createPairingRequest({ token, deviceName: 'Tel A', ip: '10.0.0.5' });
  assert.ok(first.id);
  assert.equal(pairing.getCurrentPairing(), null);
  assert.throws(
    () => pairing.createPairingRequest({ token, deviceName: 'Tel B', ip: '10.0.0.6' }),
    (error) => error.code === 'INVALID_PAIRING_TOKEN',
  );
});

test('jumelage : un nom invalide ne consomme pas le code', () => {
  const { token } = pairing.renewPairing();
  assert.throws(() => pairing.createPairingRequest({ token, deviceName: '', ip: '10.0.0.7' }), (e) => e.code === 'INVALID_DEVICE_NAME');
  assert.ok(pairing.getCurrentPairing());
});

test('jumelage : blocage de l\'adresse IP après trop de codes erronés, même avec le bon code ensuite', () => {
  const { token } = pairing.renewPairing();
  const ip = '10.9.9.9';
  for (let i = 0; i < 8; i += 1) {
    assert.throws(() => pairing.createPairingRequest({ token: `faux-${i}`, deviceName: 'X', ip }), (e) => e.code === 'INVALID_PAIRING_TOKEN');
  }
  assert.throws(() => pairing.createPairingRequest({ token, deviceName: 'X', ip }), (e) => e.status === 429 && e.code === 'PAIRING_LOCKED');
  // une autre adresse n'est pas affectée
  assert.ok(pairing.createPairingRequest({ token, deviceName: 'Autre', ip: '10.9.9.10' }).id);
});

test('jumelage : un code expiré est refusé', () => {
  const { token } = pairing.renewPairing();
  const realNow = Date.now;
  Date.now = () => realNow() + 6 * 60 * 1000;
  try {
    assert.throws(() => pairing.createPairingRequest({ token, deviceName: 'Tel', ip: '10.1.1.1' }), (e) => e.code === 'INVALID_PAIRING_TOKEN');
  } finally {
    Date.now = realNow;
  }
});

test('jumelage : la demande expire après 2 minutes et le jeton appareil n\'est remis qu\'une fois', async () => {
  const { token } = pairing.renewPairing();
  const request = pairing.createPairingRequest({ token, deviceName: 'Tel expiré', ip: '10.2.2.2' });
  const realNow = Date.now;
  Date.now = () => realNow() + 3 * 60 * 1000;
  try {
    await assert.rejects(pairing.decidePairingRequest(request.id, true), (e) => e.code === 'REQUEST_EXPIRED');
    assert.equal(pairing.getPairingRequestStatus(request.id).status, 'expired');
  } finally {
    Date.now = realNow;
  }
  const { token: second } = pairing.renewPairing();
  const accepted = pairing.createPairingRequest({ token: second, deviceName: 'Tel OK', ip: '10.2.2.3' });
  await pairing.decidePairingRequest(accepted.id, true);
  assert.ok(pairing.getPairingRequestStatus(accepted.id).deviceToken);
  assert.equal(pairing.getPairingRequestStatus(accepted.id).deviceToken, undefined);
});

test('appareils : authentification, révocation immédiate et expiration par inactivité', async () => {
  const paired = await pairDevice('Tel révoqué');
  assert.ok(await devices.authenticateDevice(paired.deviceToken));
  assert.equal(await devices.authenticateDevice('mauvais-jeton'), null);
  await devices.removeDevice(paired.device.id);
  assert.equal(await devices.authenticateDevice(paired.deviceToken), null);

  const old = await pairDevice('Tel inactif');
  const file = path.join(dataDir, 'devices.json');
  const list = await readJson(file, []);
  list.find((d) => d.id === old.device.id).lastSeen = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
  await writeJsonAtomic(file, list);
  assert.equal(await devices.authenticateDevice(old.deviceToken), null);
  assert.ok(!(await devices.listDevices()).some((d) => d.id === old.device.id));
});

test('plusieurs téléphones : envois simultanés du même nom sans écrasement', async () => {
  const phones = [];
  for (let i = 0; i < 4; i += 1) {
    const paired = await pairDevice(`Tel ${i}`);
    phones.push({ id: paired.device.id, name: paired.device.name });
  }
  const payloads = phones.map(() => crypto.randomBytes(200 * 1024));
  const sessions = await Promise.all(phones.map((actor, i) => upload(actor, 'photo.jpg', payloads[i])));
  const results = await Promise.all(sessions.map((s, i) => uploads.completeUpload(s.id, phones[i])));
  const names = results.map((r) => r.fileName);
  assert.equal(new Set(names).size, 4, `noms attendus distincts : ${names}`);
  for (const [i, result] of results.entries()) {
    const written = await fs.readFile(path.join(sharedDir, result.fileName));
    assert.equal(sha(written), sha(payloads[i]), `contenu de ${result.fileName}`);
  }
});

test('un autre appareil ne peut pas lire ni compléter la session d\'un tiers', async () => {
  const a = { id: 'a'.repeat(32), name: 'A' };
  const b = { id: 'b'.repeat(32), name: 'B' };
  const data = crypto.randomBytes(2048);
  const session = await upload(a, 'prive.bin', data);
  await assert.rejects(uploads.getUploadStatus(session.id, b), (e) => e.code === 'UPLOAD_NOT_FOUND');
  await assert.rejects(uploads.completeUpload(session.id, b), (e) => e.code === 'UPLOAD_NOT_FOUND');
  await assert.rejects(uploads.cancelUpload(session.id, b), (e) => e.code === 'UPLOAD_NOT_FOUND');
  await uploads.completeUpload(session.id, a);
});

test('finalisation simultanée du même transfert : une seule réussit, pas de fichier corrompu', async () => {
  const actor = { id: 'c'.repeat(32), name: 'C' };
  const data = crypto.randomBytes(300 * 1024);
  const session = await upload(actor, 'double.bin', data);
  const settled = await Promise.allSettled([uploads.completeUpload(session.id, actor), uploads.completeUpload(session.id, actor)]);
  assert.equal(settled.filter((r) => r.status === 'fulfilled').length, 1);
  const rejected = settled.find((r) => r.status === 'rejected');
  assert.equal(rejected.reason.code, 'UPLOAD_BUSY');
  assert.equal(sha(await fs.readFile(path.join(sharedDir, 'double.bin'))), sha(data));
});

test('intégrité : contenu altéré refusé et fichier incomplet jamais publié', async () => {
  const actor = { id: 'd'.repeat(32), name: 'D' };
  const data = crypto.randomBytes(5000);
  const session = await uploads.createUpload({ actor, kind: 'folder', name: 'corrompu.bin', size: data.length, sha256: sha(data), rootId: 'partage', folder: '', policy: 'rename' });
  const altered = Buffer.from(data); altered[10] ^= 0xff;
  await uploads.appendChunk(session.id, actor, 0, (async function* () { yield altered.subarray(0, 3000); })());
  await assert.rejects(uploads.completeUpload(session.id, actor), (e) => e.code === 'INCOMPLETE');
  await assert.rejects(fs.access(path.join(sharedDir, 'corrompu.bin')));
  await uploads.appendChunk(session.id, actor, 3000, (async function* () { yield altered.subarray(3000); })());
  await assert.rejects(uploads.completeUpload(session.id, actor), (e) => e.code === 'INTEGRITY_FAILED');
  await assert.rejects(fs.access(path.join(sharedDir, 'corrompu.bin')));
  await assert.rejects(uploads.getUploadStatus(session.id, actor), (e) => e.code === 'UPLOAD_NOT_FOUND');
});

test('interruption pendant un bloc puis reprise à la position confirmée', async () => {
  const actor = { id: 'e'.repeat(32), name: 'E' };
  const data = crypto.randomBytes(100 * 1024);
  const session = await uploads.createUpload({ actor, kind: 'folder', name: 'coupure.bin', size: data.length, sha256: sha(data), rootId: 'partage', folder: '', policy: 'rename' });
  await assert.rejects(
    uploads.appendChunk(session.id, actor, 0, (async function* () {
      yield data.subarray(0, 40 * 1024);
      throw new Error('aborted');
    })()),
    /aborted/,
  );
  const status = await uploads.getUploadStatus(session.id, actor);
  assert.equal(status.offset, 40 * 1024);
  await uploads.appendChunk(session.id, actor, status.offset, (async function* () { yield data.subarray(status.offset); })());
  await uploads.completeUpload(session.id, actor);
  assert.equal(sha(await fs.readFile(path.join(sharedDir, 'coupure.bin'))), sha(data));
});

test('redémarrage du serveur : une session persistée sur disque reste reprenable', async () => {
  const actor = { id: 'f'.repeat(32), name: 'F' };
  const data = crypto.randomBytes(64 * 1024);
  const session = await uploads.createUpload({ actor, kind: 'folder', name: 'reprise.bin', size: data.length, sha256: sha(data), rootId: 'partage', folder: '', policy: 'rename' });
  await uploads.appendChunk(session.id, actor, 0, (async function* () { yield data.subarray(0, 10000); })());
  // L'état d'un transfert vit uniquement sur disque (meta + .part) : un nouveau processus le retrouve tel quel.
  const meta = JSON.parse(await fs.readFile(path.join(dataDir, 'sessions', `${session.id}.json`), 'utf8'));
  assert.equal(meta.status, 'uploading');
  assert.equal((await fs.stat(path.join(dataDir, 'sessions', `${session.id}.part`))).size, 10000);
  assert.equal((await uploads.getUploadStatus(session.id, actor)).offset, 10000);
  await uploads.appendChunk(session.id, actor, 10000, (async function* () { yield data.subarray(10000); })());
  await uploads.completeUpload(session.id, actor);
});

test('nettoyage : sessions abandonnées et fichiers .part orphelins supprimés, sessions récentes conservées', async () => {
  const actor = { id: '1'.repeat(32), name: 'G' };
  const fresh = await uploads.createUpload({ actor, kind: 'folder', name: 'recent.bin', size: 10, sha256: 'a'.repeat(64), rootId: 'partage', folder: '', policy: 'rename' });
  const stale = await uploads.createUpload({ actor, kind: 'folder', name: 'vieux.bin', size: 10, sha256: 'a'.repeat(64), rootId: 'partage', folder: '', policy: 'rename' });
  const old = new Date(Date.now() - 48 * 3600 * 1000);
  for (const ext of ['json', 'part']) await fs.utimes(path.join(dataDir, 'sessions', `${stale.id}.${ext}`), old, old);
  const orphanId = crypto.randomBytes(16).toString('hex');
  const orphan = path.join(dataDir, 'sessions', `${orphanId}.part`);
  await fs.writeFile(orphan, 'x');
  await fs.utimes(orphan, old, old);
  const removed = await uploads.cleanupStaleSessions();
  assert.equal(removed, 2);
  assert.ok(await uploads.getUploadStatus(fresh.id, actor));
  await assert.rejects(uploads.getUploadStatus(stale.id, actor), (e) => e.code === 'UPLOAD_NOT_FOUND');
  await assert.rejects(fs.access(orphan));
  await uploads.cancelUpload(fresh.id, actor);
});

test('doublons : la politique « ask » refuse, « overwrite » remplace, « rename » numérote', async () => {
  const actor = { id: '2'.repeat(32), name: 'H' };
  await fs.writeFile(path.join(sharedDir, 'dup.txt'), 'ancien');
  await assert.rejects(
    uploads.createUpload({ actor, kind: 'folder', name: 'dup.txt', size: 1, sha256: 'a'.repeat(64), rootId: 'partage', folder: '', policy: 'ask' }),
    (e) => e.code === 'DUPLICATE',
  );
  const data = Buffer.from('nouveau');
  const renamed = await uploads.completeUpload((await upload(actor, 'dup.txt', data, { policy: 'rename' })).id, actor);
  assert.equal(renamed.fileName, 'dup (1).txt');
  await uploads.completeUpload((await upload(actor, 'dup.txt', data, { policy: 'overwrite' })).id, actor);
  assert.equal(await fs.readFile(path.join(sharedDir, 'dup.txt'), 'utf8'), 'nouveau');
});

test('débordement et taille incohérente refusés', async () => {
  const actor = { id: '3'.repeat(32), name: 'I' };
  const session = await uploads.createUpload({ actor, kind: 'folder', name: 'petit.bin', size: 10, sha256: 'a'.repeat(64), rootId: 'partage', folder: '', policy: 'rename' });
  await assert.rejects(
    uploads.appendChunk(session.id, actor, 0, (async function* () { yield Buffer.alloc(11); })()),
    (e) => e.code === 'DATA_OVERFLOW',
  );
  await assert.rejects(
    uploads.createUpload({ actor, kind: 'folder', name: 'x', size: -1, sha256: 'a'.repeat(64), rootId: 'partage', folder: '' }),
    (e) => e.code === 'INVALID_SIZE',
  );
  await assert.rejects(
    uploads.createUpload({ actor, kind: 'folder', name: 'x', size: 1, sha256: 'xyz', rootId: 'partage', folder: '' }),
    (e) => e.code === 'INVALID_HASH',
  );
});

test('dossier extérieur au dossier partagé : refusé à la création et pour un racine inconnue', async () => {
  const actor = { id: '4'.repeat(32), name: 'J' };
  for (const folder of ['../dehors', '..', 'a/../../x', '/etc', 'C:\\Windows']) {
    await assert.rejects(
      uploads.createUpload({ actor, kind: 'folder', name: 'x.txt', size: 1, sha256: 'a'.repeat(64), rootId: 'partage', folder }),
      (e) => e.status === 400 || e.status === 403,
      folder,
    );
  }
  await assert.rejects(
    uploads.createUpload({ actor, kind: 'folder', name: 'x.txt', size: 1, sha256: 'a'.repeat(64), rootId: 'inconnu', folder: '' }),
    (e) => e.code === 'FOLDER_NOT_FOUND',
  );
  await assert.rejects(fs.access(path.join(dataDir, 'dehors')));
});

test('partage : le dossier de données ne peut pas être partagé', async () => {
  await assert.rejects(settings.addSharedFolder({ label: 'Données', folderPath: dataDir }), (e) => e.code === 'FORBIDDEN_FOLDER');
  await assert.rejects(settings.addSharedFolder({ label: 'Parent', folderPath: path.dirname(dataDir) }), (e) => e.code === 'FORBIDDEN_FOLDER');
  await assert.rejects(settings.addSharedFolder({ label: 'Sous', folderPath: path.join(dataDir, 'sessions') }), (e) => e.code === 'FORBIDDEN_FOLDER');
});

test('routes locales : refus hors boucle locale, mauvais Host (DNS rebinding) et mauvaise Origin (CSRF)', () => {
  const run = (req) => {
    let result;
    requireLocal({ headers: {}, ...req, socket: { remoteAddress: '127.0.0.1', ...(req.socket ?? {}) } }, {}, (error) => { result = error ?? 'ok'; });
    return result;
  };
  assert.equal(run({ headers: { host: 'localhost:8787' } }), 'ok');
  assert.equal(run({ headers: { host: '127.0.0.1:8787', origin: 'http://localhost:8787' } }), 'ok');
  assert.equal(run({ headers: { host: '[::1]:8787' }, socket: { remoteAddress: '::1' } }), 'ok');
  assert.equal(run({ headers: { host: 'localhost:8787' }, socket: { remoteAddress: '192.168.1.20' } }).code, 'LOCAL_ONLY');
  assert.equal(run({ headers: { host: 'evil.example.com:8787' } }).code, 'BAD_HOST');
  assert.equal(run({ headers: { host: 'localhost:8787', origin: 'https://evil.example.com' } }).code, 'BAD_ORIGIN');
  assert.equal(run({ headers: { host: 'localhost:8787', origin: 'null' } }).code, 'BAD_ORIGIN');
});

test('fichier JSON corrompu : mis de côté, le serveur continue avec la valeur par défaut', async () => {
  const file = path.join(dataDir, 'cassé.json');
  await fs.writeFile(file, '{"a": ');
  assert.deepEqual(await readJson(file, []), []);
  await assert.rejects(fs.access(file));
  assert.ok((await fs.readdir(dataDir)).some((n) => n.startsWith('cassé.json.corrompu-')));
});

test('journal : les jetons sont masqués', () => {
  assert.ok(!redact('GET /api/download/AbCdEf123456').includes('AbCdEf123456'));
  assert.ok(!redact('x?pair=secret123&y=1').includes('secret123'));
  assert.ok(!redact('Authorization: Bearer abc_DEF-123').includes('abc_DEF-123'));
});

// ---------------------------------------------------------------- Phase 2

const { getCachedSha256 } = await import('../src/services/hashCache.js');

test('reprise automatique : une session identique est reprise à la position déjà reçue', async () => {
  const actor = { id: '5'.repeat(32), name: 'K' };
  const data = crypto.randomBytes(300 * 1024);
  const args = { actor, kind: 'folder', name: 'gros.bin', size: data.length, sha256: sha(data), rootId: 'partage', folder: '', policy: 'rename' };
  const first = await uploads.createUpload(args);
  await uploads.appendChunk(first.id, actor, 0, (async function* () { yield data.subarray(0, 120 * 1024); })());
  // le téléphone perd sa connexion, l'application est relancée : même demande de création
  const again = await uploads.createUpload(args);
  assert.equal(again.id, first.id);
  assert.equal(again.offset, 120 * 1024);
  // un autre appareil, ou un autre contenu, n'hérite jamais de cette session
  const other = await uploads.createUpload({ ...args, actor: { id: '6'.repeat(32), name: 'L' } });
  assert.notEqual(other.id, first.id);
  assert.equal(other.offset, 0);
  await uploads.appendChunk(again.id, actor, again.offset, (async function* () { yield data.subarray(again.offset); })());
  const done = await uploads.completeUpload(again.id, actor);
  assert.equal(sha(await fs.readFile(path.join(sharedDir, done.fileName))), sha(data));
  await uploads.cancelUpload(other.id, { id: '6'.repeat(32), name: 'L' });
});

test('gros fichiers : 120 Mo envoyés par blocs de 4 Mo avec vérification SHA-256, mémoire maîtrisée', async () => {
  const actor = { id: '7'.repeat(32), name: 'M' };
  const total = 120 * 1024 * 1024;
  const chunk = 4 * 1024 * 1024;
  const source = path.join(dataDir, 'gros-source.bin');
  const handle = await fs.open(source, 'w');
  const hasher = crypto.createHash('sha256');
  for (let written = 0; written < total; written += chunk) {
    const block = crypto.randomBytes(chunk);
    hasher.update(block);
    await handle.write(block);
  }
  await handle.close();
  const session = await uploads.createUpload({ actor, kind: 'folder', name: 'cent-vingt-mo.bin', size: total, sha256: hasher.digest('hex'), rootId: 'partage', folder: '', policy: 'rename' });
  const before = process.memoryUsage().rss;
  const reader = await fs.open(source, 'r');
  for (let offset = 0; offset < total; offset += chunk) {
    const block = Buffer.alloc(chunk);
    await reader.read(block, 0, chunk, offset);
    await uploads.appendChunk(session.id, actor, offset, (async function* () { yield block; })());
  }
  await reader.close();
  const done = await uploads.completeUpload(session.id, actor);
  const grown = process.memoryUsage().rss - before;
  assert.equal((await fs.stat(path.join(sharedDir, done.fileName))).size, total);
  // Seuil large (le ramasse-miettes varie selon le système) : il détecte un fichier chargé en entier plusieurs fois.
  assert.ok(grown < 300 * 1024 * 1024, `la mémoire a augmenté de ${(grown / 1048576).toFixed(0)} Mo`);
  await fs.rm(source);
});

test('cache SHA-256 : réutilisé tant que le fichier ne change pas, recalculé après modification', async () => {
  const file = path.join(dataDir, 'cache.bin');
  await fs.writeFile(file, 'version 1');
  const first = await getCachedSha256(file);
  assert.equal(first, sha(Buffer.from('version 1')));
  assert.equal(await getCachedSha256(file), first);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await fs.writeFile(file, 'version 22');
  assert.equal(await getCachedSha256(file), sha(Buffer.from('version 22')));
});

test('journal : une URL de téléchargement ne casse jamais la ligne JSON (régression Windows)', async () => {
  const { logger } = await import('../src/logger.js');
  const logFile = path.join(dataDir, 'logs', 'server.log');
  logger.info('Requête', { method: 'GET', url: '/api/download/AbCdEf123456', status: 200, ms: 3, ip: '127.0.0.1' });
  logger.info('Chemin Windows', { stack: 'Error\n    at C:\\Users\\runner\\x.js:1:1', url: '/api/x?pair=SECRET&a=1' });
  const lines = (await fs.readFile(logFile, 'utf8')).trim().split('\n');
  const parsed = lines.slice(-2).map((line) => JSON.parse(line));
  assert.equal(parsed[0].url, '/api/download/[masqué]');
  assert.equal(parsed[0].status, 200);
  assert.equal(parsed[0].ip, '127.0.0.1');
  assert.ok(!JSON.stringify(parsed[1]).includes('SECRET'));
  assert.ok(parsed[1].stack.includes('C:\\Users'));
});

// ---------------------------------------------------------------- Régression Windows : dossier partagé accessible par un lien

test('dossier partagé accessible par un lien ou un nom court : envoi dans un sous-dossier et liste corrects', async (t) => {
  const { listFolder } = await import('../src/services/fileBrowserService.js');
  const real = path.join(dataDir, 'vrai-partage');
  const link = path.join(dataDir, 'lien-vers-partage');
  await fs.mkdir(real, { recursive: true });
  try {
    await fs.symlink(real, link, 'junction');
  } catch (error) {
    t.skip(`Lien impossible sur cette plateforme (${error.code})`);
    return;
  }
  const settingsFile = path.join(dataDir, 'settings.json');
  const original = await fs.readFile(settingsFile, 'utf8');
  const config = JSON.parse(original);
  config.sharedFolders.push({ id: 'lien', label: 'Lien', path: link });
  await fs.writeFile(settingsFile, JSON.stringify(config));
  try {
    const actor = { id: '8'.repeat(32), name: 'N' };
    const data = Buffer.from('contenu');
    const session = await uploads.createUpload({ actor, kind: 'folder', name: 'a.txt', size: data.length, sha256: sha(data), rootId: 'lien', folder: 'Sous/Dossier', policy: 'rename' });
    await uploads.appendChunk(session.id, actor, 0, (async function* () { yield data; })());
    const done = await uploads.completeUpload(session.id, actor);
    assert.equal(done.fileName, 'a.txt');
    assert.equal(await fs.readFile(path.join(real, 'Sous', 'Dossier', 'a.txt'), 'utf8'), 'contenu');
    const root = await listFolder('lien', '');
    assert.deepEqual(root.entries.map((e) => e.path), ['Sous']);
    assert.equal(root.path, '');
    const sub = await listFolder('lien', 'Sous/Dossier');
    assert.equal(sub.path, 'Sous/Dossier');
    assert.deepEqual(sub.entries.map((e) => e.path), ['Sous/Dossier/a.txt']);
  } finally {
    await fs.writeFile(settingsFile, original);
  }
});
