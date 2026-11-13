// Choix du port : une autre application sur le port préféré ne doit être ni gênée ni confondue avec TRANSFERT.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transfert-port-'));
process.env.TRANSFERT_DATA_DIR = dataDir;
delete process.env.TRANSFERT_PORT;

const config = await import('../src/config.js');
const ports = await import('../src/services/portService.js');

const servers = [];
const listen = (handler, port = 0) =>
  new Promise((resolve) => {
    const server = http.createServer(handler);
    servers.push(server);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
after(() => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))).then(() => fs.rm(dataDir, { recursive: true, force: true })));

test('une autre application qui répond 200 sur /api/info n\'est pas prise pour TRANSFERT', async () => {
  const other = await listen((req, res) => res.end(JSON.stringify({ appName: 'Telecommande' })));
  const html = await listen((req, res) => res.end('<html>ok</html>'));
  const mine = await listen((req, res) => res.end(JSON.stringify({ appName: 'TRANSFERT' })));
  assert.equal(await ports.isTransfertServer(other), false);
  assert.equal(await ports.isTransfertServer(html), false);
  assert.equal(await ports.isTransfertServer(mine), true);
  assert.equal(await ports.isTransfertServer(1), false); // rien n'écoute
});

test('plage stable 8787-8799 avant un port éphémère ; le port précédent de la plage passe en premier', async () => {
  assert.equal(config.PORT_FORCED, false);
  const range = Array.from({ length: config.PORT_FALLBACK_COUNT + 1 }, (_, i) => 8787 + i);
  assert.deepEqual(await ports.candidatePorts(), [...range, 0]);
  await ports.writePortFile(8790);
  const first = await ports.candidatePorts();
  assert.equal(first[0], 8790);
  assert.equal(new Set(first).size, first.length);
  await ports.writePortFile(49152); // ancien port éphémère : essayé après la plage
  const second = await ports.candidatePorts();
  assert.deepEqual(second, [...range, 49152, 0]);
  await ports.removePortFile();
  assert.equal(await ports.readSavedPort(), null);
});

test('un fichier de port illisible est ignoré', async () => {
  await fs.writeFile(config.PORT_FILE, 'abc');
  assert.equal(await ports.readSavedPort(), null);
  await ports.removePortFile();
});

test('findRunningInstance retrouve un serveur TRANSFERT déjà lancé', async () => {
  const mine = await listen((req, res) => res.end(JSON.stringify({ appName: 'TRANSFERT' })));
  await ports.writePortFile(mine);
  assert.equal(await ports.findRunningInstance(), mine);
  await ports.removePortFile();
});

test('setActivePort met à jour PORT pour les modules qui l\'importent', async () => {
  const before = config.PORT;
  config.setActivePort(9123);
  assert.equal(config.PORT, 9123);
  config.setActivePort(before);
});

test('EADDRINUSE : le port occupé par une autre application reste intact', async () => {
  const blocker = net.createServer();
  servers.push(blocker);
  const busy = await new Promise((resolve) => blocker.listen(0, '0.0.0.0', () => resolve(blocker.address().port)));
  const second = http.createServer();
  servers.push(second);
  const error = await new Promise((resolve) => { second.once('error', resolve); second.listen(busy, '0.0.0.0'); });
  assert.equal(error.code, 'EADDRINUSE');
});
