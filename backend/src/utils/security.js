import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { TOKEN_SECRET } from '../config/env.js';

const BCRYPT_ROUNDS = 10;
const DEFAULT_AUTH_TTL_MS = 1000 * 60 * 60 * 12;

function legacySha256(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

function base64urlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

function base64urlDecode(input) {
  return Buffer.from(String(input || ''), 'base64url').toString('utf8');
}

function sign(data) {
  return crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('base64url');
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

export function createAuthToken(payload = {}, ttlMs = DEFAULT_AUTH_TTL_MS) {
  const now = Date.now();
  const body = {
    ...payload,
    iat: now,
    exp: now + Number(ttlMs || DEFAULT_AUTH_TTL_MS)
  };
  const encoded = base64urlEncode(JSON.stringify(body));
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function verifyAuthToken(token) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [encoded, receivedSig] = parts;
  const expectedSig = sign(encoded);
  const a = Buffer.from(receivedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(encoded));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (Number(payload.exp || 0) < Date.now()) return null;
  return payload;
}
