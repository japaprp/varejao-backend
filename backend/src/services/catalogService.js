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

function normalizeBusinessProfile(value, fallback = '') {
  const clean = normalizeName(value);
  if (!clean) return fallback;
  if (clean.includes('pad')) return 'padaria';
  if (clean.includes('farm')) return 'farmacia';
  if (
    clean.includes('lanche') ||
    clean.includes('restaur') ||
    clean.includes('bar')
  ) {
    return 'lanchonete';
  }
  return 'mercado';
}

function inferBusinessProfile(item = {}) {
  const explicit = normalizeBusinessProfile(
    item.businessProfile || item.profile || item.perfilNegocio || '',
    ''
  );
  if (explicit) return explicit;

  const setor = normalizeName(item.setor);
  if (
    item.exigeReceita === true ||
    setor.includes('farm') ||
    setor.includes('medic') ||
    setor.includes('suplement')
  ) {
    return 'farmacia';
  }
  if (
    setor.includes('padaria') ||
    setor.includes('forno') ||
    setor.includes('confeitaria') ||
    setor.includes('encomend')
  ) {
    return 'padaria';
  }
  return 'mercado';
}

function isValidFutureDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed.getTime() >= today.getTime();
}

function validateDomainRules(profile, data) {
  const route = normalizeCode(data.rotaOperacional).toLowerCase();
  const lote = normalizeCode(data.lote);
  const validade = normalizeCode(data.validade);
  const codigoInterno = normalizeCode(data.codigoInterno);
  const codigoBarras = normalizeCode(data.codigoBarras);
  const estacaoProducao = String(data.estacaoProducao || '').trim();
  const tempoProducaoMin = Number(data.tempoProducaoMin || 0);

  if (profile === 'farmacia') {
    if (!codigoInterno && !codigoBarras) {
      const err = new Error('Item da farmacia precisa de codigo interno ou codigo de barras.');
      err.status = 400;
      throw err;
    }
    if (!lote) {
      const err = new Error('Item da farmacia exige lote para rastreabilidade.');
      err.status = 400;
      throw err;
    }
    if (!validade) {
      const err = new Error('Item da farmacia exige validade.');
      err.status = 400;
      throw err;
    }
    if (!isValidFutureDate(validade)) {
      const err = new Error('Validade da farmacia precisa ser uma data valida e nao vencida.');
      err.status = 400;
      throw err;
    }
    if (route === 'kitchen' || route === 'bar') {
      const err = new Error('Farmacia nao pode usar rota operacional de cozinha ou bar.');
      err.status = 400;
      throw err;
    }
  }

  if (profile === 'padaria' && route === 'kitchen') {
    if (!estacaoProducao) {
      const err = new Error('Item da padaria enviado para producao precisa de estacao de producao.');
      err.status = 400;
      throw err;
    }
    if (!Number.isFinite(tempoProducaoMin) || tempoProducaoMin <= 0) {
      const err = new Error('Item da padaria em producao precisa de tempo de producao maior que zero.');
      err.status = 400;
      throw err;
    }
  }
}

function shouldUseStrictDomainValidation(payload = {}) {
  return payload.strictDomainValidation !== false;
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

  const profileFilter = normalizeBusinessProfile(
    filters.businessProfile || filters.profile || filters.perfilNegocio || '',
    ''
  );
  if (profileFilter) {
    items = items.filter((item) => inferBusinessProfile(item) === profileFilter);
  }

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
  const businessProfile = inferBusinessProfile(payload);

  const duplicate = findProductWithDuplicateCode(db, { codigoInterno, codigoBarras, qrCode });
  if (duplicate) {
    const err = new Error('Codigo interno, codigo de barras ou QR Code ja cadastrado em outro produto.');
    err.status = 409;
    throw err;
  }

  if (shouldUseStrictDomainValidation(payload)) {
    validateDomainRules(businessProfile, {
      ...payload,
      codigoInterno,
      codigoBarras,
      qrCode
    });
  }

  const produto = {
    id,
    businessProfile,
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
    rotaOperacional: normalizeCode(payload.rotaOperacional),
    lote: payload.lote || '',
    validade: payload.validade || '',
    exigeReceita: Boolean(payload.exigeReceita),
    tempoProducaoMin: Number(payload.tempoProducaoMin || 0),
    estacaoProducao: payload.estacaoProducao || '',
    sobEncomenda: Boolean(payload.sobEncomenda),
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
  const nextBusinessProfile = inferBusinessProfile({
    ...current,
    ...payload,
    codigoInterno: nextCodigoInterno,
    codigoBarras: nextCodigoBarras,
    qrCode: nextQrCode
  });

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

  if (shouldUseStrictDomainValidation(payload)) {
    validateDomainRules(nextBusinessProfile, {
      ...current,
      ...payload,
      codigoInterno: nextCodigoInterno,
      codigoBarras: nextCodigoBarras,
      qrCode: nextQrCode
    });
  }

  db.produtos[index] = {
    ...current,
    ...payload,
    businessProfile: nextBusinessProfile,
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
    rotaOperacional: payload.rotaOperacional !== undefined ? normalizeCode(payload.rotaOperacional) : current.rotaOperacional,
    lote: payload.lote !== undefined ? normalizeCode(payload.lote) : current.lote,
    validade: payload.validade !== undefined ? normalizeCode(payload.validade) : current.validade,
    exigeReceita: payload.exigeReceita !== undefined ? Boolean(payload.exigeReceita) : current.exigeReceita,
    tempoProducaoMin: payload.tempoProducaoMin !== undefined ? Number(payload.tempoProducaoMin) : current.tempoProducaoMin,
    estacaoProducao: payload.estacaoProducao !== undefined ? String(payload.estacaoProducao || '').trim() : current.estacaoProducao,
    sobEncomenda: payload.sobEncomenda !== undefined ? Boolean(payload.sobEncomenda) : current.sobEncomenda,
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
