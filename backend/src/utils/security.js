import crypto from 'crypto';

export function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

export function createToken() {
  return crypto.randomBytes(24).toString('hex');
}
