import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 10;

function legacySha256(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

export function hashPassword(password) {
  return bcrypt.hashSync(String(password), BCRYPT_ROUNDS);
}

export function verifyPassword(password, storedHash) {
  const hash = String(storedHash || '');
  const raw = String(password || '');
  if (!hash) return false;
  if (hash.startsWith('$2')) {
    return bcrypt.compareSync(raw, hash);
  }
  return legacySha256(raw) === hash;
}

export function needsRehash(storedHash) {
  return !String(storedHash || '').startsWith('$2');
}

export function createToken() {
  return crypto.randomBytes(24).toString('hex');
}
