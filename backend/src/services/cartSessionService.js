import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readDb, writeDb } from '../data/repository.js';

const sessionLifetimeMs = 24 * 60 * 60 * 1000;
const maxSessions = 10000;

export function isSessionCartId(cartId) {
  return cartId.toLowerCase().startsWith('v2_');
}

export function isCartSessionActive(session, now = Date.now()) {
  return Boolean(session && !session.revokedAt && Number.isFinite(session.expiresAt) && session.expiresAt > now);
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function createOnlineCartSession() {
  const db = readDb();
  db.cartSessions ??= {};
  const now = Date.now();

  for (const [cartId, session] of Object.entries(db.cartSessions)) {
    if (!isCartSessionActive(session, now)) {
      delete db.cartSessions[cartId];
      if (db.carrinhos) delete db.carrinhos[cartId];
    }
  }

  if (Object.keys(db.cartSessions).length >= maxSessions) {
    const error = new Error('Não foi possível iniciar seu carrinho agora. Tente novamente mais tarde.');
    error.status = 503;
    throw error;
  }

  const cartId = `v2_${randomUUID()}`;
  const cartToken = randomBytes(32).toString('base64url');
  const expiresAt = now + sessionLifetimeMs;
  db.cartSessions[cartId] = {
    tokenHash: tokenHash(cartToken),
    channel: 'online',
    createdAt: now,
    expiresAt
  };
  writeDb(db);

  return { cartId, cartToken, expiresAt: new Date(expiresAt).toISOString() };
}

export function validateCartSession(cartId, token) {
  if (!/^v2_[a-f0-9-]{36}$/.test(cartId) || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return false;
  }
  const session = readDb().cartSessions?.[cartId];
  if (!isCartSessionActive(session) || !/^[a-f0-9]{64}$/.test(session.tokenHash)) {
    return false;
  }

  return timingSafeEqual(Buffer.from(session.tokenHash, 'hex'), Buffer.from(tokenHash(token), 'hex'));
}
