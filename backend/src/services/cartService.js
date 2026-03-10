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

function resolveChannelFromCartId(cartId) {
  const id = String(resolveCartId(cartId)).toLowerCase();
  if (/(caixa|pdv|balcao|fisic|sessao|session|mesa|comanda)/i.test(id)) {
    return 'fisico';
  }
  return 'online';
}

function resolveOrderChannel(order = {}) {
  if (order && typeof order.canal === 'string' && order.canal.trim()) {
    const canal = order.canal.trim().toLowerCase();
    return canal === 'fisico' ? 'fisico' : 'online';
  }
  return resolveChannelFromCartId(order?.cartId || '');
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

function getReservedQtyForProduct(db, produtoId, options = {}) {
  ensureCollections(db);
  const { exceptCartId = '', exceptOrderId = '' } = options;
  const exceptCart = resolveCartId(exceptCartId);
  const exceptOrder = String(exceptOrderId || '').trim();
  let reserved = 0;

  for (const [cartId, items] of Object.entries(db.carrinhos || {})) {
    if (!Array.isArray(items)) continue;
    if (exceptCartId && resolveCartId(cartId) === exceptCart) continue;

    for (const item of items) {
      if (String(item?.produtoId || '') === String(produtoId || '')) {
        reserved += Number(item?.quantidade || 0);
      }
    }
  }

  for (const order of db.pedidos || []) {
    if (!order || isCancelledStatus(order.status) || !isPendingStatus(order.status)) continue;
    if (exceptOrder && String(order.id || '') === exceptOrder) continue;

    for (const item of aggregateItemsByProduct(order.itens || [])) {
      if (String(item?.produtoId || '') === String(produtoId || '')) {
        reserved += Number(item?.quantidade || 0);
      }
    }
  }

  return Number(reserved.toFixed(2));
}

function getCartItemQty(cart, produtoId) {
  return Number(
    (cart || [])
      .filter((item) => String(item?.produtoId || '') === String(produtoId || ''))
      .reduce((sum, item) => sum + Number(item?.quantidade || 0), 0)
      .toFixed(2)
  );
}

function normalizeOrder(pedido) {
  const channel = resolveOrderChannel(pedido);
  return {
    ...pedido,
    cartId: pedido?.cartId || null,
    canal: channel,
    status: pedido.status || 'Finalizado'
  };
}

function aggregateItemsByProduct(items = []) {
  const map = new Map();

  for (const rawItem of items || []) {
    const produtoId = String(rawItem?.produtoId || '').trim();
    const quantidade = Number(rawItem?.quantidade || 0);
    if (!produtoId || !Number.isFinite(quantidade) || quantidade <= 0) continue;

    const current = map.get(produtoId) || {
      produtoId,
      produto: rawItem.produto,
      unidade: rawItem.unidade,
      preco: Number(rawItem.preco || 0),
      quantidade: 0
    };

    current.quantidade = Number((current.quantidade + quantidade).toFixed(2));
    map.set(produtoId, current);
  }

  return Array.from(map.values());
}

function ensureStockAvailability(db, items, options = {}) {
  const { exceptCartId = '', exceptOrderId = '' } = options;
  const aggregated = aggregateItemsByProduct(items);

  for (const item of aggregated) {
    const prod = (db.produtos || []).find((p) => String(p.id) === String(item.produtoId));
    if (!prod) continue;

    const reservedOutside = getReservedQtyForProduct(db, item.produtoId, { exceptCartId, exceptOrderId });
    const available = Number(prod.estoque || 0) - reservedOutside;
    if (available + 1e-9 < Number(item.quantidade || 0)) {
      const err = new Error(`Estoque insuficiente para ${prod.nome}. Disponivel: ${Math.max(0, available).toFixed(2)}`);
      err.status = 400;
      throw err;
    }
  }
}

function applyStockDeduction(db, items) {
  const aggregated = aggregateItemsByProduct(items);

  for (const item of aggregated) {
    const prod = (db.produtos || []).find((p) => String(p.id) === String(item.produtoId));
    if (!prod) continue;

    const novoEstoque = Number(prod.estoque || 0) - Number(item.quantidade || 0);
    if (novoEstoque < -1e-9) {
      const err = new Error(`Estoque insuficiente para ${prod.nome}`);
      err.status = 400;
      throw err;
    }

    prod.estoque = Number(Math.max(0, novoEstoque).toFixed(2));
  }
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

function isPendingStatus(status = '') {
  const s = String(status || '').toLowerCase();
  return s.includes('aguardando') || s.includes('pendente') || s.includes('preparo') || s.includes('entrega');
}

function isCancelledStatus(status = '') {
  return String(status || '').toLowerCase().includes('cancel');
}

function isToday(isoDate) {
  if (!isoDate) return false;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function resolvePaymentMethod(method = '') {
  const raw = String(method || '').trim().toLowerCase();
  if (!raw) return 'mercadopago';
  if (raw.includes('maquin')) return 'maquininha';
  return 'mercadopago';
}

function resolvePendingStatusByMethod(paymentMethod = 'mercadopago') {
  return paymentMethod === 'maquininha'
    ? 'Aguardando pagamento na maquininha'
    : 'Aguardando pagamento';
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

export function listOrdersAll(filters = {}) {
  const db = readDb();
  const {
    status = '',
    cpf = '',
    dataInicio = '',
    dataFim = '',
    minTotal = '',
    canal = ''
  } = filters;

  let list = (db.pedidos || []).map(normalizeOrder);
  if (status) {
    list = list.filter((p) => String(p.status || '') === status);
  }
  if (canal) {
    const canalNorm = String(canal).toLowerCase();
    list = list.filter((p) => resolveOrderChannel(p) === canalNorm);
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
  const cartKey = resolveCartId(cartId);
  const cart = getCartFromDb(db, cartKey);
  const qtd = Number(quantidade);
  if ((!produtoId && !produto) || Number.isNaN(qtd) || qtd <= 0) {
    const err = new Error('Dados invalidos para o carrinho');
    err.status = 400;
    throw err;
  }

  const produtoRef = produtoId ? getProductById(produtoId) : getProductByName(produto);
  if (!produtoRef) {
    const err = new Error('Produto nao encontrado');
    err.status = 404;
    throw err;
  }

  const reservedOutside = getReservedQtyForProduct(db, produtoRef.id, { exceptCartId: cartKey });
  const currentQty = getCartItemQty(cart, produtoRef.id);
  const availableToAdd = Number(produtoRef.estoque || 0) - reservedOutside - currentQty;
  if (availableToAdd + 1e-9 < qtd) {
    const err = new Error(`Estoque insuficiente para este item. Disponivel: ${Math.max(0, availableToAdd).toFixed(2)}`);
    err.status = 400;
    throw err;
  }

  const existing = cart.find((item) => String(item.produtoId) === String(produtoRef.id));
  if (existing) {
    existing.quantidade = Number((Number(existing.quantidade || 0) + qtd).toFixed(2));
  } else {
    cart.push({
      produtoId: produtoRef.id,
      produto: produtoRef.nome,
      unidade: produtoRef.unidade,
      preco: produtoRef.preco,
      quantidade: qtd
    });
  }

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

  const totalBase = Math.max(0, subtotal - desconto);
  return {
    itens: cart,
    subtotal,
    desconto,
    totalBase,
    frete: calculateFrete(totalBase),
    total: totalBase + calculateFrete(totalBase),
    cupomAplicado,
    cartId: resolveCartId(cartId),
    canal: resolveChannelFromCartId(cartId)
  };
}

export function createPendingOrder({
  cpf = '',
  nomeCliente = '',
  cupom = '',
  cartId = '',
  metodoPagamento = 'mercadopago'
} = {}) {
  const db = readDb();
  const cartKey = resolveCartId(cartId);
  const cart = getCartFromDb(db, cartKey);
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
  const channel = resolveChannelFromCartId(cartKey);
  const paymentMethod = resolvePaymentMethod(metodoPagamento);

  const order = {
    id: `ped_${Date.now()}`,
    createdAt: new Date().toISOString(),
    cartId: cartKey,
    canal: channel,
    itens: aggregateItemsByProduct(cart),
    subtotal,
    desconto,
    total,
    totalBase,
    frete,
    cupomAplicado,
    cpf: normalizeCpf(cpf) || null,
    nomeCliente: nomeCliente || null,
    status: resolvePendingStatusByMethod(paymentMethod),
    payment: {
      status: 'pending',
      method: paymentMethod
    }
  };

  db.pedidos.push(order);
  db.carrinhos[cartKey] = [];
  writeDb(db);

  return normalizeOrder(order);
}

export function confirmMachinePayment(orderId, paymentInfo = {}) {
  const db = readDb();
  const order = getOrderById(db, orderId);
  if (!order) {
    const err = new Error('Pedido nao encontrado');
    err.status = 404;
    throw err;
  }

  if (isCancelledStatus(order.status)) {
    const err = new Error('Pedido cancelado nao pode ser confirmado');
    err.status = 400;
    throw err;
  }

  if (resolveOrderChannel(order) !== 'fisico') {
    const err = new Error('Pagamento na maquininha permitido apenas para canal fisico');
    err.status = 400;
    throw err;
  }

  const paymentMethod = resolvePaymentMethod(order?.payment?.method || 'maquininha');
  if (paymentMethod !== 'maquininha') {
    const err = new Error('Pedido nao esta marcado para maquininha');
    err.status = 400;
    throw err;
  }

  const transactionId = String(paymentInfo?.nsu || paymentInfo?.autorizacao || '').trim() || ('maq_' + Date.now());
  return finalizePaidOrder(orderId, {
    status: 'approved',
    id: transactionId,
    method: 'maquininha'
  });
}

export function finalizePaidOrder(orderId, paymentInfo = {}) {
  const db = readDb();
  const order = getOrderById(db, orderId);
  if (!order) {
    const err = new Error('Pedido nao encontrado');
    err.status = 404;
    throw err;
  }

  if (order.status === 'Pago' || order.status === 'Finalizado') {
    return normalizeOrder(order);
  }

  const items = aggregateItemsByProduct(order.itens || []);
  ensureStockAvailability(db, items, { exceptOrderId: order.id });
  applyStockDeduction(db, items);

  if (order.cupomAplicado) {
    registerCouponUse(order.cupomAplicado);
  }

  const fidelidade = applyLoyalty(order.cpf, order.nomeCliente, order.total);

  order.itens = items;
  order.canal = resolveOrderChannel(order);
  order.cartId = order.cartId || null;
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
  const cartKey = resolveCartId(cartId);
  const cart = getCartFromDb(db, cartKey);
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

  const items = aggregateItemsByProduct(cart);
  ensureStockAvailability(db, items, { exceptCartId: cartKey });
  applyStockDeduction(db, items);

  const channel = resolveChannelFromCartId(cartKey);

  db.pedidos.push({
    id: `ped_${Date.now()}`,
    createdAt: new Date().toISOString(),
    cartId: cartKey,
    canal: channel,
    itens: items,
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

  db.carrinhos[cartKey] = [];
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
    fidelidade,
    canal: channel,
    cartId: cartKey
  };
}

export function getUnifiedOperationSummary() {
  const db = readDb();
  ensureCollections(db);

  const orders = (db.pedidos || []).map(normalizeOrder);
  const activeCarts = Object.entries(db.carrinhos || {})
    .filter(([, items]) => Array.isArray(items) && items.length > 0)
    .map(([cartId, items]) => ({
      cartId,
      canal: resolveChannelFromCartId(cartId),
      linhas: items.length,
      itens: Number(items.reduce((sum, item) => sum + Number(item.quantidade || 0), 0).toFixed(2)),
      subtotal: Number(cartSubtotal(items).toFixed(2))
    }))
    .sort((a, b) => b.subtotal - a.subtotal);

  const channelStats = (channel) => {
    const list = orders.filter((o) => resolveOrderChannel(o) === channel);
    const paidOrFinished = list.filter((o) => !isPendingStatus(o.status) && !isCancelledStatus(o.status));
    const pending = list.filter((o) => isPendingStatus(o.status));
    const faturamento = Number(paidOrFinished.reduce((sum, o) => sum + Number(o.total || 0), 0).toFixed(2));
    return {
      pedidosTotal: list.length,
      pedidosPendentes: pending.length,
      pedidosHoje: list.filter((o) => isToday(o.createdAt)).length,
      faturamento,
      ticketMedio: paidOrFinished.length ? Number((faturamento / paidOrFinished.length).toFixed(2)) : 0
    };
  };

  const pendingOrders = orders
    .filter((o) => isPendingStatus(o.status))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 30)
    .map((o) => ({
      id: o.id,
      createdAt: o.createdAt,
      canal: resolveOrderChannel(o),
      cartId: o.cartId || null,
      status: o.status,
      total: Number(o.total || 0),
      itens: Array.isArray(o.itens) ? o.itens.length : 0,
      cpf: o.cpf || null,
      nomeCliente: o.nomeCliente || null
    }));

  const stockAlerts = (db.produtos || [])
    .map((produto) => {
      const reservado = getReservedQtyForProduct(db, produto.id, {});
      const estoque = Number(produto.estoque || 0);
      const disponivel = Number((estoque - reservado).toFixed(2));
      return {
        produtoId: produto.id,
        nome: produto.nome,
        estoque,
        reservado,
        disponivel
      };
    })
    .filter((item) => item.reservado > 0 || item.disponivel <= 10)
    .sort((a, b) => a.disponivel - b.disponivel)
    .slice(0, 30);

  return {
    generatedAt: new Date().toISOString(),
    canais: {
      online: channelStats('online'),
      fisico: channelStats('fisico')
    },
    carrinhosAtivos: activeCarts,
    pedidosPendentes: pendingOrders,
    alertasEstoque: stockAlerts
  };
}