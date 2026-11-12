import fs from 'node:fs/promises';
import { hashFile } from '../security/hash.js';

const MAX_ENTRIES = 200;
const cache = new Map(); // clé : chemin|taille|date de modification -> Promise<sha256>

/**
 * SHA-256 d'un fichier du PC, mis en cache tant que le fichier n'a pas changé
 * (taille et date de modification). Évite de relire un fichier de plusieurs Go à
 * chaque téléchargement et regroupe les calculs simultanés du même fichier.
 */
export async function getCachedSha256(filePath) {
  const stats = await fs.stat(filePath);
  const key = `${filePath}|${stats.size}|${Math.round(stats.mtimeMs)}`;
  const known = cache.get(key);
  if (known) {
    cache.delete(key);
    cache.set(key, known); // récent = en fin de liste
    return known;
  }
  const pending = hashFile(filePath);
  cache.set(key, pending);
  pending.catch(() => cache.delete(key));
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
  return pending;
}

export function clearHashCacheForTests() {
  cache.clear();
}
