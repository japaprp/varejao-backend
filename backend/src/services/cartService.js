import { getProductById, getProductByName } from './catalogService.js';
import {
  calculateCouponDiscount,
  registerCouponUse,
  validateCoupon
} from './couponService.js';
import { applyLoyalty } from './loyaltyService.js';
import { readDb, writeDb } from '../data/repository.js';

function resolveCartId(cartId) {
  const raw = String(cartId || '').trim();
  return raw || 'default';
}

function normalizeCpf(value) {
  return String(value || '').replace(/\D/g, '');
}

function ensureCollections(db) {
  db.carrinhos = db.carrinhos || {};
  db.pedidos = db.pedidos || [];
}

function getCartFromDb(db, cartId) {
  ensureCollections(db);
  const id = resolveCartId(cartId);
  if (!Array.isArray(db.carrinhos[id])) {
    db.carrinhos[id] = [];
  }
  return db.carrinhos[id];
}

function cartSubtotal(cart) {
  return cart.reduce((sum, item) => sum + (Number(item.preco) * Number(item.quantidade)), 0);
}

function calculateFrete(totalBase) {
  if (Number(totalBase) <= 0) return 0;
  return totalBase >= 100 ? 0 : 30;
}

export function listCart(cartId) {
  const db = readDb();
  return getCartFromDb(db, cartId);
}

export function listOrdersByCpf(cpf) {
  const db = readDb();
  const target = normalizeCpf(cpf);
  if (!target) return [];
  return (db.pedidos || [])
    .filter((p) => normalizeCpf(p.cpf) === target)
    .map(normalizeOrder);
}

function normalizeOrder(pedido) {
  return {
    ...pedido,
    status: pedido.status || 'Finalizado'
  };
}

export function listOrdersAll(filters = {}) {
  const db = readDb();
  const {
    status = '',
    cpf = '',
    dataInicio = '',
    dataFim = '',
    minTotal = ''
  } = filters;

  let list = (db.pedidos || []).map(normalizeOrder);
  if (status) {
    list = list.filter((p) => String(p.status || '') === status);
  }
  if (cpf) {
    list = list.filter((p) => String(p.cpf || '') === String(cpf));
  }
  if (dataInicio) {
    const start = new Date(dataInicio);
    list = list.filter((p) => new Date(p.createdAt) >= start);
  }
  if (dataFim) {
    const end = new Date(dataFim);
    end.setHours(23, 59, 59, 999);
    list = list.filter((p) => new Date(p.createdAt) <= end);
  }
  if (minTotal !== '') {
    const min = Number(minTotal || 0);
    list = list.filter((p) => Number(p.total || 0) >= min);
  }

  return list.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function updateOrderStatus(id, status) {
  const db = readDb();
  const idx = (db.pedidos || []).findIndex((p) => p.id === id);
  if (idx < 0) return null;
  db.pedidos[idx].status = status || 'Finalizado';
  writeDb(db);
  return normalizeOrder(db.pedidos[idx]);
}

export function addCartItem({ produtoId, produto, quantidade }, cartId) {
  const db = readDb();
  const cart = getCartFromDb(db, cartId);
  const qtd = Number(quantidade);
  if ((!produtoId && !produto) || Number.isNaN(qtd) || qtd <= 0) {
    const err = new Error('Dados invalidos para o carrinho');
    err.status = 400;
    throw err;
  }

  const produtoRef = produtoId ? getProductById(produtoId) : getProductByName(produto);
  if (!produtoRef) {
    const err = new Error('Produto não encontrado');
    err.status = 404;
    throw err;
  }
  if (Number(produtoRef.estoque || 0) < qtd) {
    const err = new Error('Estoque insuficiente para este item');
    err.status = 400;
    throw err;
  }

  cart.push({
    produtoId: produtoRef.id,
    produto: produtoRef.nome,
    unidade: produtoRef.unidade,
    preco: produtoRef.preco,
    quantidade: qtd
  });

  writeDb(db);
  return { sucesso: true };
}

export function getCheckoutPreview(codigoCupom = '', cartId = '') {
  const db = readDb();
  const cart = getCartFromDb(db, cartId);
  const subtotal = cartSubtotal(cart);
  let desconto = 0;
  let cupomAplicado = null;

  if (codigoCupom) {
    const cupom = validateCoupon(codigoCupom, subtotal);
    desconto = Math.min(calculateCouponDiscount(cupom, subtotal), subtotal);
    cupomAplicado = cupom.codigo;
  }

  return {
    itens: cart,
    subtotal,
    desconto,
    totalBase: Math.max(0, subtotal - desconto),
    frete: calculateFrete(Math.max(0, subtotal - desconto)),
    total: Math.max(0, subtotal - desconto) + calculateFrete(Math.max(0, subtotal - desconto)),
    cupomAplicado
  };
}

function buildOrderTotals({ subtotal, desconto }) {
  const totalBase = Math.max(0, subtotal - desconto);
  const frete = calculateFrete(totalBase);
  const total = totalBase + frete;
  return { totalBase, frete, total };
}

function getOrderById(db, orderId) {
  return (db.pedidos || []).find((p) => p.id === orderId);
}

export function createPendingOrder({ cpf = '', nomeCliente = '', cupom = '', cartId = '' } = {}) {
  const db = readDb();
  const cart = getCartFromDb(db, cartId);
  const subtotal = cartSubtotal(cart);
  if (subtotal <= 0) {
    const err = new Error('Carrinho vazio');
    err.status = 400;
    throw err;
  }

  let desconto = 0;
  let cupomAplicado = null;
  if (cupom) {
    const coupon = validateCoupon(cupom, subtotal);
    desconto = Math.min(calculateCouponDiscount(coupon, subtotal), subtotal);
    cupomAplicado = coupon.codigo;
  }

  const { totalBase, frete, total } = buildOrderTotals({ subtotal, desconto });

  const order = {
    id: `ped_${Date.now()}`,
    createdAt: new Date().toISOString(),
    itens: [...cart],
    subtotal,
    desconto,
    total,
    totalBase,
    frete,
    cupomAplicado,
    cpf: normalizeCpf(cpf) || null,
    nomeCliente: nomeCliente || null,
    status: 'Aguardando pagamento',
    payment: {
      status: 'pending'
    }
  };
  db.pedidos.push(order);
  db.carrinhos[resolveCartId(cartId)] = [];
  writeDb(db);

  return order;
}

export function finalizePaidOrder(orderId, paymentInfo = {}) {
  const db = readDb();
  const order = getOrderById(db, orderId);
  if (!order) {
    const err = new Error('Pedido não encontrado');
    err.status = 404;
    throw err;
  }

  if (order.status === 'Pago' || order.status === 'Finalizado') {
    return normalizeOrder(order);
  }

  for (const item of order.itens || []) {
    const prod = (db.produtos || []).find((p) => p.id === item.produtoId);
    if (!prod) continue;
    const novoEstoque = Number(prod.estoque || 0) - Number(item.quantidade || 0);
    if (novoEstoque < 0) {
      const err = new Error('Estoque insuficiente para confirmar o pagamento');
      err.status = 400;
      throw err;
    }
    prod.estoque = Number(novoEstoque.toFixed(2));
  }

  if (order.cupomAplicado) {
    registerCouponUse(order.cupomAplicado);
  }

  const fidelidade = applyLoyalty(order.cpf, order.nomeCliente, order.total);

  order.status = 'Pago';
  order.payment = {
    ...order.payment,
    status: paymentInfo.status || 'approved',
    id: paymentInfo.id || order.payment?.id || null,
    method: paymentInfo.method || order.payment?.method || null,
    updatedAt: new Date().toISOString()
  };
  writeDb(db);
  return { ...normalizeOrder(order), fidelidade };
}

export function checkoutCart({ cpf = '', nomeCliente = '', cupom = '', cartId = '' } = {}) {
  const db = readDb();
  const cart = getCartFromDb(db, cartId);
  const subtotal = cartSubtotal(cart);
  if (subtotal <= 0) {
    const err = new Error('Carrinho vazio');
    err.status = 400;
    throw err;
  }

  let desconto = 0;
  let cupomAplicado = null;

  if (cupom) {
    const coupon = validateCoupon(cupom, subtotal);
    desconto = Math.min(calculateCouponDiscount(coupon, subtotal), subtotal);
    registerCouponUse(coupon.codigo);
    cupomAplicado = coupon.codigo;
  }

  const totalBase = Math.max(0, subtotal - desconto);
  const frete = calculateFrete(totalBase);
  const total = totalBase + frete;

  // Atualiza estoque com base nos itens vendidos
  for (const item of cart) {
    const prod = (db.produtos || []).find((p) => p.id === item.produtoId);
    if (!prod) continue;
    const novoEstoque = Number(prod.estoque || 0) - Number(item.quantidade || 0);
    if (novoEstoque < 0) {
      const err = new Error('Estoque insuficiente para finalizar a compra');
      err.status = 400;
      throw err;
    }
    prod.estoque = Number(novoEstoque.toFixed(2));
  }
  db.pedidos.push({
    id: `ped_${Date.now()}`,
    createdAt: new Date().toISOString(),
    itens: [...cart],
    subtotal,
    desconto,
    total,
    totalBase,
    frete,
    cupomAplicado,
    cpf: normalizeCpf(cpf) || null,
    nomeCliente: nomeCliente || null,
    status: 'Finalizado'
  });
  db.carrinhos[resolveCartId(cartId)] = [];
  writeDb(db);

  const fidelidade = applyLoyalty(cpf, nomeCliente, total);

  return {
    sucesso: true,
    mensagem: 'Compra finalizada!',
    subtotal,
    desconto,
    totalBase,
    frete,
    total,
    cupomAplicado,
    fidelidade
  };
}

