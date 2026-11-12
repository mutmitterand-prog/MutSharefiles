import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  sanitizeFileName,
  resolveInside,
  resolveExistingInside,
  ensureDirectoryInside,
} from '../src/security/paths.js';

test('sanitizeFileName conserve les noms ordinaires (majuscules, chiffres, lettres u et f)', () => {
  for (const name of [
    'vers-tel.pdf',
    'facture.pdf',
    'Rapport2024.PDF',
    'sous-menu.mp4',
    'IMG_0001.JPG',
    'Photo été 2024 (1).png',
    'lecture.txt',
  ]) {
    assert.equal(sanitizeFileName(name), name);
  }
});

test('sanitizeFileName remplace les caractères interdits sous Windows', () => {
  assert.equal(sanitizeFileName('a<b>c:d"e|f?g*h.txt'), 'a_b_c_d_e_f_g_h.txt');
  assert.equal(sanitizeFileName('x\u0001y\u001fz.txt'), 'x_y_z.txt');
  assert.equal(sanitizeFileName('nul\u0000.txt'), 'nul_.txt');
});

test('sanitizeFileName retire les chemins et les points/espaces finaux', () => {
  assert.equal(sanitizeFileName('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFileName('dossier/fichier.txt'), 'fichier.txt');
  assert.equal(sanitizeFileName('fichier.txt. . '), 'fichier.txt');
});

test('sanitizeFileName refuse les noms vides ou purement relatifs', () => {
  for (const bad of ['', '   ', '.', '..', '...', undefined, null]) {
    assert.throws(() => sanitizeFileName(bad), (error) => error.code === 'INVALID_NAME');
  }
});

test('sanitizeFileName préfixe les noms réservés Windows', () => {
  for (const name of ['CON', 'con.txt', 'COM1.txt', 'lpt9', 'NUL.png', 'aux']) {
    assert.ok(sanitizeFileName(name).startsWith('_'), name);
  }
  assert.equal(sanitizeFileName('console.txt'), 'console.txt');
  assert.equal(sanitizeFileName('com10.txt'), 'com10.txt');
});

test('sanitizeFileName limite la longueur à 200 caractères', () => {
  assert.equal(sanitizeFileName('a'.repeat(500) + '.txt').length, 200);
});

test('resolveInside refuse .., chemins absolus, lecteurs Windows et caractères de contrôle', () => {
  const root = path.join(os.tmpdir(), 'racine-test');
  for (const bad of ['..', '../x', 'a/../../x', 'a\\..\\x', '/etc', 'C:\\Windows', 'C:x', 'a\u0000b', 'a\nb']) {
    assert.throws(() => resolveInside(root, bad), (error) => error.status === 400 || error.status === 403, JSON.stringify(bad));
  }
  assert.equal(resolveInside(root, ''), path.resolve(root));
  assert.equal(resolveInside(root, 'a/b'), path.join(path.resolve(root), 'a', 'b'));
});

test('resolveExistingInside et ensureDirectoryInside refusent les liens symboliques', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'transfert-paths-'));
  const root = path.join(base, 'partage');
  const outside = path.join(base, 'dehors');
  await fs.mkdir(root);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
  await fs.mkdir(path.join(root, 'ok'));
  await fs.writeFile(path.join(root, 'ok', 'a.txt'), 'a');
  try {
    await fs.symlink(outside, path.join(root, 'lien'), 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip('Liens symboliques non autorisés sur cette plateforme');
      return;
    }
    throw error;
  }
  assert.equal(await resolveExistingInside(root, 'ok/a.txt'), path.join(await fs.realpath(root), 'ok', 'a.txt'));
  await assert.rejects(resolveExistingInside(root, 'lien'), (e) => e.code === 'SYMLINK_FORBIDDEN');
  await assert.rejects(resolveExistingInside(root, 'lien/secret.txt'), (e) => e.code === 'SYMLINK_FORBIDDEN');
  await assert.rejects(ensureDirectoryInside(root, 'lien/sous'), (e) => e.code === 'UNSAFE_DIRECTORY');
  await assert.rejects(resolveExistingInside(root, 'absent'), (e) => e.code === 'FILE_NOT_FOUND');
  await fs.rm(base, { recursive: true, force: true });
});
