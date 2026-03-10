import { readDb, writeDb } from '../data/repository.js';
import { normalizeName } from '../utils/normalize.js';

function normalizeSetor(value) {
  return normalizeName(value);
}

function normalizeCode(value) {
  return String(value || '').trim();
}

function normalizeCodeSearch(value) {
  return normalizeCode(value).toLowerCase();
}

function findProductWithDuplicateCode(db, { codigoInterno = '', codigoBarras = '', qrCode = '' }, ignoreId = '') {
  const nextCodes = [codigoInterno, codigoBarras, qrCode]
    .map(normalizeCode)
    .filter(Boolean);

  if (!nextCodes.length) return null;

  return (db.produtos || []).find((item) => {
    if (ignoreId && String(item.id) === String(ignoreId)) return false;

    const existingCodes = [
      normalizeCode(item.codigoInterno),
      normalizeCode(item.codigoBarras),
      normalizeCode(item.qrCode)
    ].filter(Boolean);

    return nextCodes.some((code) => existingCodes.includes(code));
  }) || null;
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

  const idFilter = normalizeCodeSearch(filters.id || '');
  if (idFilter) {
    items = items.filter((item) => normalizeCodeSearch(item.id) === idFilter);
  }

  const internalCodeFilter = normalizeCodeSearch(filters.codigoInterno || filters.codigo || filters.sku || '');
  if (internalCodeFilter) {
    items = items.filter((item) => normalizeCodeSearch(item.codigoInterno) === internalCodeFilter);
  }

  const barcodeFilter = normalizeCodeSearch(filters.barcode || filters.codigoBarras || '');
  if (barcodeFilter) {
    items = items.filter((item) => normalizeCodeSearch(item.codigoBarras) === barcodeFilter);
  }

  const qrFilter = normalizeCodeSearch(filters.qr || filters.qrCode || '');
  if (qrFilter) {
    items = items.filter((item) => normalizeCodeSearch(item.qrCode) === qrFilter);
  }

  if (filters.q) {
    const searchName = normalizeName(filters.q);
    const searchCode = normalizeCodeSearch(filters.q);
    items = items.filter((item) => {
      const nomeMatch = normalizeName(item.nome).includes(searchName);
      const idMatch = normalizeCodeSearch(item.id).includes(searchCode);
      const internalMatch = normalizeCodeSearch(item.codigoInterno).includes(searchCode);
      const barcodeMatch = normalizeCodeSearch(item.codigoBarras).includes(searchCode);
      const qrMatch = normalizeCodeSearch(item.qrCode).includes(searchCode);
      return nomeMatch || idMatch || internalMatch || barcodeMatch || qrMatch;
    });
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
  const codigoInterno = normalizeCode(payload.codigoInterno);
  const codigoBarras = normalizeCode(payload.codigoBarras);
  const qrCode = normalizeCode(payload.qrCode);

  const duplicate = findProductWithDuplicateCode(db, { codigoInterno, codigoBarras, qrCode });
  if (duplicate) {
    const err = new Error('Codigo interno, codigo de barras ou QR Code ja cadastrado em outro produto.');
    err.status = 409;
    throw err;
  }

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
    codigoInterno,
    codigoBarras,
    qrCode,
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
  const nextCodigoInterno = payload.codigoInterno !== undefined ? normalizeCode(payload.codigoInterno) : normalizeCode(current.codigoInterno);
  const nextCodigoBarras = payload.codigoBarras !== undefined ? normalizeCode(payload.codigoBarras) : normalizeCode(current.codigoBarras);
  const nextQrCode = payload.qrCode !== undefined ? normalizeCode(payload.qrCode) : normalizeCode(current.qrCode);

  const duplicate = findProductWithDuplicateCode(
    db,
    { codigoInterno: nextCodigoInterno, codigoBarras: nextCodigoBarras, qrCode: nextQrCode },
    id
  );

  if (duplicate) {
    const err = new Error('Codigo interno, codigo de barras ou QR Code ja cadastrado em outro produto.');
    err.status = 409;
    throw err;
  }

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
    codigoInterno: nextCodigoInterno,
    codigoBarras: nextCodigoBarras,
    qrCode: nextQrCode,
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
