import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transfert-test-'));
const sharedDir = path.join(dataDir, 'shared');
let proc;

async function call(method, url, { token, body, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(BASE + url, {
    method,
    headers: h,
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* binaire */ }
  return { status: res.status, json, text, headers: res.headers };
}

before(async () => {
  await fs.mkdir(sharedDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({
    computerName: 'PC-Test',
    sharedFolders: [{ id: 'partage', label: 'Partage', path: sharedDir }],
  }));
  proc = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, TRANSFERT_DATA_DIR: dataDir, TRANSFERT_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Serveur non démarré')), 10000);
    proc.stdout.on('data', (d) => { if (String(d).includes('démarré')) { clearTimeout(timer); resolve(); } });
    proc.stderr.on('data', (d) => process.stderr.write(d));
  });
});

after(() => { proc?.kill(); });

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

test('jumelage par QR code, acceptation puis remise du jeton une seule fois', async () => {
  const info = await call('GET', '/api/info');
  assert.equal(info.json.computerName, 'PC-Test');

  const pairing = await call('POST', '/api/local/pairing/renew');
  assert.equal(pairing.status, 200);
  assert.match(pairing.json.url, /\?pair=/);
  assert.ok(pairing.json.qrDataUrl.startsWith('data:image/png'));
  const token = new URL(pairing.json.url).searchParams.get('pair');

  const bad = await call('POST', '/api/pairing/requests', { body: { token: 'faux', deviceName: 'X' } });
  assert.equal(bad.status, 401);

  const req = await call('POST', '/api/pairing/requests', { body: { token, deviceName: 'Samsung' } });
  assert.equal(req.status, 201);
  const pending = await call('GET', '/api/local/pairing/requests');
  assert.equal(pending.json.items[0].deviceName, 'Samsung');

  const decide = await call('POST', `/api/local/pairing/requests/${req.json.id}/decision`, { body: { accept: true } });
  assert.equal(decide.status, 200);
  const first = await call('GET', `/api/pairing/requests/${req.json.id}`);
  assert.equal(first.json.status, 'accepted');
  assert.ok(first.json.deviceToken);
  const second = await call('GET', `/api/pairing/requests/${req.json.id}`);
  assert.equal(second.json.deviceToken, undefined);

  globalThis.deviceToken = first.json.deviceToken;
  globalThis.deviceId = first.json.device.id;
});

test('jeton invalide refusé sur les routes appareil', async () => {
  const res = await call('GET', '/api/device/ping', { token: 'inconnu' });
  assert.equal(res.status, 401);
});

test('envoi téléphone vers PC par blocs, vérification SHA-256 et doublons', async () => {
  const token = globalThis.deviceToken;
  const data = crypto.randomBytes(300 * 1024 + 17);
  const meta = { name: 'photo test.jpg', size: data.length, sha256: sha(data), rootId: 'partage', folder: 'Sous/Dossier', policy: 'ask' };

  const created = await call('POST', '/api/device/uploads', { token, body: meta });
  assert.equal(created.status, 201);
  const id = created.json.id;

  const part = 128 * 1024;
  let offset = 0;
  while (offset < data.length) {
    const end = Math.min(offset + part, data.length);
    const res = await call('PATCH', `/api/device/uploads/${id}/chunk?offset=${offset}`, {
      token,
      raw: data.subarray(offset, end),
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    assert.equal(res.status, 200, res.text);
    offset = res.json.offset;
  }
  const done = await call('POST', `/api/device/uploads/${id}/complete`, { token });
  assert.equal(done.status, 200, done.text);
  const saved = await fs.readFile(path.join(sharedDir, 'Sous', 'Dossier', 'photo test.jpg'));
  assert.equal(sha(saved), sha(data));

  const dup = await call('POST', '/api/device/uploads', { token, body: meta });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error, 'DUPLICATE');

  const again = await call('POST', '/api/device/uploads', { token, body: { ...meta, policy: 'rename' } });
  assert.equal(again.status, 201);
  await call('PATCH', `/api/device/uploads/${again.json.id}/chunk?offset=0`, { token, raw: data, headers: { 'Content-Type': 'application/octet-stream' } });
  const renamed = await call('POST', `/api/device/uploads/${again.json.id}/complete`, { token });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.json.fileName, 'photo test (1).jpg');
});

test('intégrité : un fichier altéré est refusé', async () => {
  const token = globalThis.deviceToken;
  const data = Buffer.from('contenu original');
  const created = await call('POST', '/api/device/uploads', { token, body: { name: 'a.txt', size: data.length, sha256: sha(Buffer.from('autre')), rootId: 'partage', folder: '' } });
  await call('PATCH', `/api/device/uploads/${created.json.id}/chunk?offset=0`, { token, raw: data, headers: { 'Content-Type': 'application/octet-stream' } });
  const res = await call('POST', `/api/device/uploads/${created.json.id}/complete`, { token });
  assert.equal(res.status, 422);
  assert.equal(res.json.error, 'INTEGRITY_FAILED');
});

test('reprise : décalage de bloc refusé avec la position attendue', async () => {
  const token = globalThis.deviceToken;
  const data = Buffer.alloc(1000, 1);
  const created = await call('POST', '/api/device/uploads', { token, body: { name: 'reprise.bin', size: 1000, sha256: sha(data), rootId: 'partage', folder: '' } });
  await call('PATCH', `/api/device/uploads/${created.json.id}/chunk?offset=0`, { token, raw: data.subarray(0, 400), headers: { 'Content-Type': 'application/octet-stream' } });
  const wrong = await call('PATCH', `/api/device/uploads/${created.json.id}/chunk?offset=100`, { token, raw: data.subarray(100), headers: { 'Content-Type': 'application/octet-stream' } });
  assert.equal(wrong.status, 409);
  assert.equal(wrong.json.offset, 400);
  const status = await call('GET', `/api/device/uploads/${created.json.id}`, { token });
  assert.equal(status.json.offset, 400);
});

test('traversée de répertoires refusée', async () => {
  const token = globalThis.deviceToken;
  const res = await call('GET', '/api/device/files?root=partage&path=..%2F..', { token });
  assert.equal(res.status, 400);
  const up = await call('POST', '/api/device/uploads', { token, body: { name: 'x', size: 1, sha256: 'a'.repeat(64), rootId: 'partage', folder: '../../' } });
  assert.equal(up.status, 400);
});

test('les liens symboliques sortant du dossier partagé sont refusés', async (t) => {
  const token = globalThis.deviceToken;
  const outside = path.join(dataDir, 'secret-outside.txt');
  await fs.writeFile(outside, 'secret');
  const link = path.join(sharedDir, 'lien-externe');
  try {
    await fs.symlink(outside, link, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip('Création de liens symboliques non autorisée sur cette plateforme');
      return;
    }
    throw error;
  }

  const read = await call('GET', '/api/device/downloads', { token });
  // L’endpoint de téléchargement exige un ticket POST ; la tentative sur le
  // fichier lié doit être rejetée par le résolveur sécurisé.
  const ticket = await call('POST', '/api/device/downloads', {
    token,
    body: { source: 'folder', root: 'partage', path: 'lien-externe' },
  });
  assert.ok([400, 403, 404].includes(ticket.status), read.text);
  assert.notEqual(ticket.status, 201);
  const listing = await call('GET', '/api/device/files?root=partage&path=', { token });
  assert.equal(listing.status, 200);
  assert.ok(!listing.json.entries.some((entry) => entry.name === 'lien-externe'));
});

test('PC vers téléphone : fichier en attente puis téléchargement vérifiable', async () => {
  const data = crypto.randomBytes(70 * 1024);
  const created = await call('POST', '/api/local/uploads', { body: { name: 'vers-tel.pdf', size: data.length, sha256: sha(data) } });
  assert.equal(created.status, 201);
  await call('PATCH', `/api/local/uploads/${created.json.id}/chunk?offset=0`, { raw: data, headers: { 'Content-Type': 'application/octet-stream' } });
  const done = await call('POST', `/api/local/uploads/${created.json.id}/complete`, {});
  assert.equal(done.status, 200, done.text);

  const token = globalThis.deviceToken;
  const outbox = await call('GET', '/api/device/outbox', { token });
  const item = outbox.json.items.find((entry) => entry.name === 'vers-tel.pdf');
  assert.ok(item);

  const ticket = await call('POST', '/api/device/downloads', { token, body: { source: 'outbox', id: item.id } });
  assert.equal(ticket.status, 201);
  const file = await fetch(BASE + ticket.json.url);
  const buf = Buffer.from(await file.arrayBuffer());
  assert.equal(sha(buf), sha(data));
  assert.equal(file.headers.get('x-content-sha256'), sha(data));

  // L'historique est enregistré juste après la fin de la réponse : on laisse jusqu'à 3 s au serveur.
  let recorded = false;
  for (let attempt = 0; attempt < 30 && !recorded; attempt += 1) {
    const history = await call('GET', '/api/device/history', { token });
    recorded = history.json.items.some((entry) => entry.direction === 'pc_to_android' && entry.status === 'completed');
    if (!recorded) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(recorded, 'téléchargement absent de l\'historique');
});

test('téléchargement d\'un fichier partagé et déconnexion de l\'appareil', async () => {
  const token = globalThis.deviceToken;
  await fs.writeFile(path.join(sharedDir, 'lecture.txt'), 'hello');
  const ticket = await call('POST', '/api/device/downloads', { token, body: { source: 'folder', root: 'partage', path: 'lecture.txt' } });
  const file = await fetch(BASE + ticket.json.url);
  assert.equal(await file.text(), 'hello');

  const disc = await call('POST', '/api/device/disconnect', { token });
  assert.equal(disc.status, 200);
  const after = await call('GET', '/api/device/ping', { token });
  assert.equal(after.status, 401);
});

// ---------------------------------------------------------------- Phase 1 : sécurité HTTP

// Le test précédent déconnecte volontairement le premier appareil : on en jumelle un second
// (avant les tests de blocage de jumelage, qui verrouillent ensuite l'adresse 127.0.0.1).
test('jumelage d\'un second appareil pour les tests suivants', async () => {
  const pairing = await call('POST', '/api/local/pairing/renew');
  const token = new URL(pairing.json.url).searchParams.get('pair');
  const request = await call('POST', '/api/pairing/requests', { body: { token, deviceName: 'Tel Deux' } });
  assert.equal(request.status, 201, request.text);
  const decision = await call('POST', `/api/local/pairing/requests/${request.json.id}/decision`, { body: { accept: true } });
  assert.equal(decision.status, 200, decision.text);
  const status = await call('GET', `/api/pairing/requests/${request.json.id}`);
  assert.ok(status.json.deviceToken);
  globalThis.deviceToken2 = status.json.deviceToken;
});


function rawGet(urlPath, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: 'GET', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('routes locales : refus d\'un Host étranger (DNS rebinding) et d\'une Origin étrangère (CSRF)', async () => {
  assert.equal(await rawGet('/api/local/overview', { Host: 'evil.example.com:8787' }), 403);
  assert.equal(await rawGet('/api/local/overview', { Origin: 'https://evil.example.com' }), 403);
  assert.equal(await rawGet('/api/local/overview', {}), 200);
});

test('noms de fichiers : majuscules, chiffres et extensions conservés de bout en bout', async () => {
  const token = globalThis.deviceToken2;
  const data = crypto.randomBytes(2048);
  const name = 'Rapport2024_Final.PDF';
  const created = await call('POST', '/api/device/uploads', { token, body: { name, size: data.length, sha256: sha(data), rootId: 'partage', folder: '', policy: 'rename' } });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.name, name);
  await call('PATCH', `/api/device/uploads/${created.json.id}/chunk?offset=0`, { token, raw: data, headers: { 'Content-Type': 'application/octet-stream' } });
  const done = await call('POST', `/api/device/uploads/${created.json.id}/complete`, { token, body: {} });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.json.fileName, name);
  assert.equal(sha(await fs.readFile(path.join(sharedDir, name))), sha(data));
});

test('jumelage : le code est à usage unique et les tentatives erronées sont limitées', async () => {
  const pairing = await call('POST', '/api/local/pairing/renew');
  const token = new URL(pairing.json.url).searchParams.get('pair');
  const first = await call('POST', '/api/pairing/requests', { body: { token, deviceName: 'Tel Un' } });
  assert.equal(first.status, 201);
  const reuse = await call('POST', '/api/pairing/requests', { body: { token, deviceName: 'Tel Deux' } });
  assert.equal(reuse.status, 401);
  let last;
  for (let i = 0; i < 10; i += 1) {
    last = await call('POST', '/api/pairing/requests', { body: { token: `faux-${i}`, deviceName: 'Pirate' } });
  }
  assert.equal(last.status, 429);
});

// ---------------------------------------------------------------- Phase 2 : reprise de téléchargement (Range)

test('téléchargement : reprise par plage (Range) et vérification SHA-256 du fichier reconstitué', async () => {
  const token = globalThis.deviceToken2;
  const data = crypto.randomBytes(3 * 1024 * 1024 + 123);
  await fs.writeFile(path.join(sharedDir, 'range-test.bin'), data);
  const ticket = await call('POST', '/api/device/downloads', { token, body: { source: 'folder', root: 'partage', path: 'range-test.bin' } });
  assert.equal(ticket.status, 201, ticket.text);
  assert.equal(ticket.json.sha256, sha(data));
  const cut = 1_000_000;
  const first = await fetch(`http://127.0.0.1:${PORT}${ticket.json.url}`, { headers: { Range: `bytes=0-${cut - 1}` } });
  assert.equal(first.status, 206);
  const part1 = Buffer.from(await first.arrayBuffer());
  const second = await fetch(`http://127.0.0.1:${PORT}${ticket.json.url}`, { headers: { Range: `bytes=${cut}-` } });
  assert.equal(second.status, 206);
  const part2 = Buffer.from(await second.arrayBuffer());
  assert.equal(sha(Buffer.concat([part1, part2])), ticket.json.sha256);
  assert.equal(second.headers.get('accept-ranges'), 'bytes');
});

test('info : le serveur annonce les tailles de bloc configurables', async () => {
  const info = await call('GET', '/api/info');
  assert.ok(info.json.maxChunkBytes >= 1024 * 1024);
  assert.ok(info.json.defaultChunkBytes <= info.json.maxChunkBytes);
});
