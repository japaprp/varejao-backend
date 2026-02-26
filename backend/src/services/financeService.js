import { readDb, writeDb } from '../data/repository.js';

export function listSaidas() {
  const db = readDb();
  return db.saidas || [];
}

export function createSaida(payload) {
  const { descricao, valor, categoria = 'operacional', data = new Date().toISOString() } = payload || {};
  const parsed = Number(valor);

  if (!descricao || Number.isNaN(parsed) || parsed <= 0) {
    const err = new Error('Dados invalidos para saida');
    err.status = 400;
    throw err;
  }

  const db = readDb();
  db.saidas = db.saidas || [];
  const item = {
    id: `s_${Date.now()}`,
    descricao,
    valor: parsed,
    categoria,
    data
  };
  db.saidas.push(item);
  writeDb(db);
  return item;
}

export function deleteSaida(id) {
  const db = readDb();
  db.saidas = db.saidas || [];
  const before = db.saidas.length;
  db.saidas = db.saidas.filter((s) => s.id !== id);
  if (db.saidas.length === before) return false;
  writeDb(db);
  return true;
}
