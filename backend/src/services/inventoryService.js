import { readDb, writeDb } from '../data/repository.js';
import { getProductById } from './catalogService.js';

function calculateEntryQuantity(produto, payload) {
  const caixas = Number(payload.caixasQtd || 0);
  if (caixas <= 0) return 0;

  const unidade = payload.unidade || produto.unidade;
  const pesoCaixaMin = Number(payload.pesoCaixaMin || produto.pesoCaixaMin || 0);
  const pesoCaixaMax = Number(payload.pesoCaixaMax || produto.pesoCaixaMax || 0);
  const pesoPorCaixa = Number(payload.pesoPorCaixa || produto.pesoPorCaixa || 0);
  const unidadesPorCaixa = Number(payload.unidadesPorCaixa || produto.unidadesPorCaixa || 0);

  if (unidade === 'kg') {
    const pesoMedio = (pesoCaixaMin > 0 && pesoCaixaMax > 0)
      ? (pesoCaixaMin + pesoCaixaMax) / 2
      : pesoPorCaixa;
    return Number((caixas * (pesoMedio || 0)).toFixed(2));
  }

  return Number((caixas * unidadesPorCaixa).toFixed(2));
}

export function listStockEntries() {
  const db = readDb();
  return (db.entradasEstoque || []).slice().sort((a, b) => new Date(b.data) - new Date(a.data));
}

export function listStockLosses() {
  const db = readDb();
  return (db.perdasEstoque || []).slice().sort((a, b) => new Date(b.data) - new Date(a.data));
}

export function addStockEntry(payload) {
  const produto = getProductById(payload.produtoId);
  if (!produto) {
    const err = new Error('Produto nao encontrado');
    err.status = 404;
    throw err;
  }

  const quantidade = calculateEntryQuantity(produto, payload);
  if (quantidade <= 0) {
    const err = new Error('Quantidade de entrada invalida');
    err.status = 400;
    throw err;
  }

  const db = readDb();
  const entry = {
    id: `ent_${Date.now()}`,
    data: new Date().toISOString(),
    produtoId: produto.id,
    produto: produto.nome,
    unidade: produto.unidade,
    caixasQtd: Number(payload.caixasQtd || 0),
    quantidade,
    pesoCaixaMin: Number(payload.pesoCaixaMin || produto.pesoCaixaMin || 0),
    pesoCaixaMax: Number(payload.pesoCaixaMax || produto.pesoCaixaMax || 0),
    pesoMedioUnidade: Number(payload.pesoMedioUnidade || produto.pesoMedioUnidade || 0),
    unidadesPorCaixa: Number(payload.unidadesPorCaixa || produto.unidadesPorCaixa || 0)
  };

  const prod = (db.produtos || []).find((p) => p.id === produto.id);
  if (prod) {
    prod.estoque = Number((Number(prod.estoque || 0) + quantidade).toFixed(2));
    prod.caixasQtd = Number(payload.caixasQtd || prod.caixasQtd || 0);
    prod.pesoCaixaMin = entry.pesoCaixaMin;
    prod.pesoCaixaMax = entry.pesoCaixaMax;
    prod.pesoMedioUnidade = entry.pesoMedioUnidade;
    prod.unidadesPorCaixa = entry.unidadesPorCaixa;
  }

  db.entradasEstoque = db.entradasEstoque || [];
  db.entradasEstoque.push(entry);
  writeDb(db);

  return entry;
}

export function addStockLoss(payload) {
  const produto = getProductById(payload.produtoId);
  if (!produto) {
    const err = new Error('Produto nao encontrado');
    err.status = 404;
    throw err;
  }

  const quantidade = Number(payload.quantidade || 0);
  if (quantidade <= 0) {
    const err = new Error('Quantidade de perda invalida');
    err.status = 400;
    throw err;
  }

  const motivo = String(payload.motivo || 'quebra');
  const db = readDb();
  const prod = (db.produtos || []).find((p) => p.id === produto.id);
  if (!prod) {
    const err = new Error('Produto nao encontrado');
    err.status = 404;
    throw err;
  }

  const novoEstoque = Number(prod.estoque || 0) - quantidade;
  if (novoEstoque < 0) {
    const err = new Error('Estoque insuficiente para registrar perda');
    err.status = 400;
    throw err;
  }
  prod.estoque = Number(novoEstoque.toFixed(2));

  const loss = {
    id: `per_${Date.now()}`,
    data: new Date().toISOString(),
    produtoId: produto.id,
    produto: produto.nome,
    unidade: produto.unidade,
    quantidade,
    motivo
  };

  db.perdasEstoque = db.perdasEstoque || [];
  db.perdasEstoque.push(loss);
  writeDb(db);
  return loss;
}

export function getStockTurnover() {
  const db = readDb();
  const entries = db.entradasEstoque || [];
  const losses = db.perdasEstoque || [];
  const orders = db.pedidos || [];

  const map = new Map();

  const ensure = (produto, unidade) => {
    if (!map.has(produto)) {
      map.set(produto, {
        produto,
        unidade: unidade || '',
        entrada: 0,
        saidaVenda: 0,
        perda: 0
      });
    }
    return map.get(produto);
  };

  entries.forEach((e) => {
    const row = ensure(e.produto, e.unidade);
    row.entrada += Number(e.quantidade || 0);
  });

  losses.forEach((l) => {
    const row = ensure(l.produto, l.unidade);
    row.perda += Number(l.quantidade || 0);
  });

  orders.forEach((p) => {
    (p.itens || []).forEach((i) => {
      const row = ensure(i.produto, i.unidade);
      row.saidaVenda += Number(i.quantidade || 0);
    });
  });

  return Array.from(map.values())
    .map((r) => ({ ...r, saidaTotal: r.saidaVenda + r.perda }))
    .sort((a, b) => b.saidaTotal - a.saidaTotal);
}

export function listLowStock(threshold = 10) {
  const db = readDb();
  return (db.produtos || []).filter((p) => Number(p.estoque || 0) <= Number(threshold));
}
