import { OAuth2Client } from 'google-auth-library';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  FACEBOOK_APP_ID,
  FACEBOOK_APP_SECRET,
  GOOGLE_CLIENT_ID
} from '../config/env.js';
import { readDb, writeDb } from '../data/repository.js';
import { createAuthToken, createToken, hashPassword, needsRehash, verifyAuthToken, verifyPassword } from '../utils/security.js';
import { normalizeName } from '../utils/normalize.js';

const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

function sanitizeUser(user) {
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    role: user.role,
    cpf: user.cpf || '',
    telefone: user.telefone || '',
    cep: user.cep || '',
    rua: user.rua || '',
    bairro: user.bairro || '',
    cidade: user.cidade || ''
  };
}

function findUserByEmail(email) {
  ensureAdminUser();
  const db = readDb();
  const target = normalizeName(email);
  return db.usuarios.find((u) => normalizeName(u.email) === target) || null;
}

function findUserByOauth(provider, sub) {
  if (!provider || !sub) return null;
  const db = readDb();
  return db.usuarios.find((u) => u.oauthProvider === provider && String(u.oauthSub || '') === String(sub)) || null;
}

function createSession(user) {
  return createAuthToken({ user: sanitizeUser(user) }, SESSION_TTL_MS);
}

function ensureAdminUser() {
  const db = readDb();
  db.usuarios = db.usuarios || [];
  const adminEmailNorm = normalizeName(ADMIN_EMAIL);
  const existing = db.usuarios.find((u) => normalizeName(u.email) === adminEmailNorm);

  if (!existing) {
    if (!ADMIN_PASSWORD) return;
    db.usuarios.push({
      id: `u_admin_${Date.now()}`,
      nome: 'Administrador',
      email: ADMIN_EMAIL,
      senhaHash: hashPassword(ADMIN_PASSWORD),
      role: 'admin',
      cpf: '00000000000'
    });
    writeDb(db);
    return;
  }

  if (ADMIN_PASSWORD && existing.role === 'admin') {
    const shouldUpdate = !verifyPassword(ADMIN_PASSWORD, existing.senhaHash);
    if (shouldUpdate) {
      existing.senhaHash = hashPassword(ADMIN_PASSWORD);
      writeDb(db);
    }
  }
}

export function registerUser(payload) {
  const { nome, email, senha, cpf, cep, rua, bairro, cidade, telefone } = payload;
  if (!nome || !email || !senha) {
    const err = new Error('Nome, email e senha sao obrigatorios');
    err.status = 400;
    throw err;
  }

  if (findUserByEmail(email)) {
    const err = new Error('Email ja cadastrado');
    err.status = 409;
    throw err;
  }

  const db = readDb();
  const user = {
    id: `u_${Date.now()}`,
    nome,
    email,
    senhaHash: hashPassword(senha),
    role: 'cliente',
    cpf: cpf || '',
    cep: cep || '',
    rua: rua || '',
    bairro: bairro || '',
    cidade: cidade || '',
    telefone: telefone || ''
  };

  db.usuarios.push(user);
  writeDb(db);

  const token = createSession(user);
  return { token, usuario: sanitizeUser(user) };
}

export function loginUser(payload) {
  const { email, senha } = payload;
  const user = findUserByEmail(email || '');

  if (!user || !verifyPassword(senha || '', user.senhaHash)) {
    const err = new Error('Credenciais invalidas');
    err.status = 401;
    throw err;
  }

  if (needsRehash(user.senhaHash)) {
    const db = readDb();
    const idx = db.usuarios.findIndex((u) => u.id === user.id);
    if (idx >= 0) {
      db.usuarios[idx].senhaHash = hashPassword(senha || '');
      writeDb(db);
    }
  }

  const token = createSession(user);
  return { token, usuario: sanitizeUser(user) };
}

export function getGoogleAuthConfig() {
  return {
    enabled: Boolean(GOOGLE_CLIENT_ID),
    clientId: GOOGLE_CLIENT_ID || ''
  };
}

export function getFacebookAuthConfig() {
  return {
    enabled: Boolean(FACEBOOK_APP_ID && FACEBOOK_APP_SECRET),
    appId: FACEBOOK_APP_ID || ''
  };
}

export async function loginWithGoogleToken(payload) {
  const idToken = String(payload?.idToken || '').trim();
  if (!idToken) {
    const err = new Error('Token do Google nao informado.');
    err.status = 400;
    throw err;
  }
  if (!googleClient) {
    const err = new Error('Login Google nao configurado.');
    err.status = 500;
    throw err;
  }

  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID
  });
  const profile = ticket.getPayload() || {};
  const email = String(profile.email || '').trim();
  const nome = String(profile.name || '').trim() || 'Cliente Google';

  if (!email || profile.email_verified === false) {
    const err = new Error('Conta Google sem email valido.');
    err.status = 401;
    throw err;
  }

  let user = findUserByEmail(email);
  if (!user) {
    const db = readDb();
    user = {
      id: `u_${Date.now()}`,
      nome,
      email,
      senhaHash: hashPassword(createToken()),
      role: 'cliente',
      cpf: '',
      cep: '',
      rua: '',
      bairro: '',
      cidade: '',
      telefone: '',
      oauthProvider: 'google',
      oauthSub: String(profile.sub || '')
    };
    db.usuarios.push(user);
    writeDb(db);
  }

  const token = createSession(user);
  return { token, usuario: sanitizeUser(user) };
}

async function graphGet(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `https://graph.facebook.com${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const err = new Error(data?.error?.message || 'Falha ao consultar Graph API.');
    err.status = 401;
    throw err;
  }
  return data;
}

export async function loginWithFacebookToken(payload) {
  const accessToken = String(payload?.accessToken || '').trim();
  if (!accessToken) {
    const err = new Error('Token do Facebook nao informado.');
    err.status = 400;
    throw err;
  }
  if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
    const err = new Error('Login Facebook nao configurado.');
    err.status = 500;
    throw err;
  }

  const appAccessToken = `${FACEBOOK_APP_ID}|${FACEBOOK_APP_SECRET}`;
  const debug = await graphGet('/debug_token', {
    input_token: accessToken,
    access_token: appAccessToken
  });
  const tokenData = debug.data || {};
  if (!tokenData.is_valid || String(tokenData.app_id || '') !== String(FACEBOOK_APP_ID)) {
    const err = new Error('Token do Facebook invalido.');
    err.status = 401;
    throw err;
  }

  const profile = await graphGet('/me', {
    fields: 'id,name,email',
    access_token: accessToken
  });
  const sub = String(profile.id || '').trim();
  if (!sub) {
    const err = new Error('Conta Facebook invalida.');
    err.status = 401;
    throw err;
  }

  let user = profile.email ? findUserByEmail(profile.email) : null;
  if (!user) {
    user = findUserByOauth('facebook', sub);
  }

  if (!user) {
    const db = readDb();
    user = {
      id: `u_${Date.now()}`,
      nome: String(profile.name || 'Cliente Facebook'),
      email: String(profile.email || `facebook_${sub}@oauth.local`),
      senhaHash: hashPassword(createToken()),
      role: 'cliente',
      cpf: '',
      cep: '',
      rua: '',
      bairro: '',
      cidade: '',
      telefone: '',
      oauthProvider: 'facebook',
      oauthSub: sub
    };
    db.usuarios.push(user);
    writeDb(db);
  }

  const token = createSession(user);
  return { token, usuario: sanitizeUser(user) };
}

export function getUserByToken(token) {
  const payload = verifyAuthToken(token);
  if (!payload || !payload.user) return null;
  return payload.user;
}
