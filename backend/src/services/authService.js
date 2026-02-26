import { readDb, writeDb } from '../data/repository.js';
import { createToken, hashPassword } from '../utils/security.js';
import { normalizeName } from '../utils/normalize.js';

const sessions = new Map();
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

function sanitizeUser(user) {
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    role: user.role,
    cpf: user.cpf || ''
  };
}

function findUserByEmail(email) {
  const db = readDb();
  const target = normalizeName(email);
  return db.usuarios.find((u) => normalizeName(u.email) === target) || null;
}

function createSession(user) {
  const token = createToken();
  sessions.set(token, {
    user: sanitizeUser(user),
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return token;
}

export function registerUser(payload) {
  const { nome, email, senha, cpf } = payload;
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
    cpf: cpf || ''
  };

  db.usuarios.push(user);
  writeDb(db);

  const token = createSession(user);
  return { token, usuario: sanitizeUser(user) };
}

export function loginUser(payload) {
  const { email, senha } = payload;
  const user = findUserByEmail(email || '');

  if (!user || user.senhaHash !== hashPassword(senha || '')) {
    const err = new Error('Credenciais invalidas');
    err.status = 401;
    throw err;
  }

  const token = createSession(user);
  return { token, usuario: sanitizeUser(user) };
}

export function getUserByToken(token) {
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return session.user;
}
