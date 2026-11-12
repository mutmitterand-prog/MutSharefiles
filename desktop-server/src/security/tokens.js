import crypto from 'node:crypto';

export function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function tokensMatch(candidateHash, storedHash) {
  const a = Buffer.from(candidateHash, 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
