import { readDb, writeDb } from '../data/repository.js';
import { normalizeName } from '../utils/normalize.js';

function normalizeSetor(value) {
  return normalizeName(value);
}

export function listProducts(filters = {}) {
  const db = readDb();
  let items = [...db.produtos];

  if (filters.setor) {
    const setor = normalizeSetor(filters.setor);
    items = items.filter((item) => normalizeSetor(item.setor) === setor);
  }

  if (filters.promocao === 'true') {
    items = items.filter((item) => item.promocao);
  }

  if (filters.destaque === 'true') {
    items = items.filter((item) => item.destaque);
  }

  if (filters.q) {
    const search = normalizeName(filters.q);
    items = items.filter((item) => normalizeName(item.nome).includes(search));
  }

  return items;
}

export function getProductById(id) {
  const db = readDb();
  return db.produtos.find((item) => item.id === id) || null;
}

export function getProductByName(nome) {
  const db = readDb();
  const target = normalizeName(nome);
  return db.produtos.find((item) => normalizeName(item.nome) === target) || null;
}

export function createProduct(payload) {
  const db = readDb();
  const id = `p${String(Date.now()).slice(-8)}`;

  const produto = {
    id,
    nome: payload.nome,
    setor: payload.setor,
    preco: Number(payload.preco),
    unidade: payload.unidade,
    estoque: Number(payload.estoque || 0),
    caixasQtd: Number(payload.caixasQtd || 0),
    pesoPorCaixa: Number(payload.pesoPorCaixa || 0),
    pesoCaixaMin: Number(payload.pesoCaixaMin || 0),
    pesoCaixaMax: Number(payload.pesoCaixaMax || 0),
    pesoMedioUnidade: Number(payload.pesoMedioUnidade || 0),
    unidadesPorCaixa: Number(payload.unidadesPorCaixa || 0),
    imagem: payload.imagem || '',
    descricaoCurta: payload.descricaoCurta || '',
    selo: payload.selo || '',
    promocao: Boolean(payload.promocao),
    destaque: Boolean(payload.destaque)
  };

  db.produtos.push(produto);
  writeDb(db);
  return produto;
}

export function updateProduct(id, payload) {
  const db = readDb();
  const index = db.produtos.findIndex((item) => item.id === id);

  if (index === -1) {
    return null;
  }

  const current = db.produtos[index];
  db.produtos[index] = {
    ...current,
    ...payload,
    preco: payload.preco !== undefined ? Number(payload.preco) : current.preco,
    estoque: payload.estoque !== undefined ? Number(payload.estoque) : current.estoque,
    caixasQtd: payload.caixasQtd !== undefined ? Number(payload.caixasQtd) : current.caixasQtd,
    pesoPorCaixa: payload.pesoPorCaixa !== undefined ? Number(payload.pesoPorCaixa) : current.pesoPorCaixa,
    pesoCaixaMin: payload.pesoCaixaMin !== undefined ? Number(payload.pesoCaixaMin) : current.pesoCaixaMin,
    pesoCaixaMax: payload.pesoCaixaMax !== undefined ? Number(payload.pesoCaixaMax) : current.pesoCaixaMax,
    pesoMedioUnidade: payload.pesoMedioUnidade !== undefined ? Number(payload.pesoMedioUnidade) : current.pesoMedioUnidade,
    unidadesPorCaixa: payload.unidadesPorCaixa !== undefined ? Number(payload.unidadesPorCaixa) : current.unidadesPorCaixa,
    promocao: payload.promocao !== undefined ? Boolean(payload.promocao) : current.promocao,
    destaque: payload.destaque !== undefined ? Boolean(payload.destaque) : current.destaque
  };

  writeDb(db);
  return db.produtos[index];
}

export function deleteProduct(id) {
  const db = readDb();
  const before = db.produtos.length;
  db.produtos = db.produtos.filter((item) => item.id !== id);

  if (db.produtos.length === before) {
    return false;
  }

  writeDb(db);
  return true;
}
