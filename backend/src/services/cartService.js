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

function normalizeBusinessProfile(value) {
  const clean = String(value || '').trim().toLowerCase();
  if (!clean) return 'mercado';
  if (clean.includes('pad')) return 'padaria';
  if (clean.includes('farm')) return 'farmacia';
  if (clean.includes('lanche') || clean.includes('bar')) return 'lanchonete';
  return 'mercado';
}

function buildOperationalProfileConfig(profile, baseConfig = {}) {
  const normalized = normalizeBusinessProfile(profile);
  switch (normalized) {
    case 'padaria':
      return {
        ...baseConfig,
        businessProfile: 'padaria',
        displayName: 'Operacao Padaria',
        serviceFlow: true,
        kitchenFlow: true,
        stockFlow: true,
        supportedRoutes: ['counter', 'kitchen', 'cold', 'stock'],
        productionStations: ['forno', 'confeitaria', 'preparo', 'balcao'],
        supportsComandas: true
      };
    case 'farmacia':
      return {
        ...baseConfig,
        businessProfile: 'farmacia',
        displayName: 'Operacao Farmacia',
        serviceFlow: false,
        kitchenFlow: false,
        stockFlow: true,
        supportedRoutes: ['counter', 'stock', 'cold'],
        productionStations: ['balcao', 'estoque'],
        supportsComandas: false
      };
    case 'lanchonete':
      return {
        ...baseConfig,
        businessProfile: 'lanchonete',
        displayName: 'Operacao Food Service',
        serviceFlow: true,
        kitchenFlow: true,
        stockFlow: true,
        supportedRoutes: ['counter', 'kitchen', 'bar', 'cold', 'stock'],
        productionStations: ['cozinha', 'bar', 'frio', 'balcao'],
        supportsComandas: true
      };
    default:
      return {
        ...baseConfig,
        businessProfile: 'mercado',
        displayName: 'Operacao Mercado',
        serviceFlow: true,
        kitchenFlow: false,
        stockFlow: true,
        supportedRoutes: ['counter', 'stock', 'cold'],
        productionStations: ['balcao', 'estoque', 'frio'],
        supportsComandas: false
      };
  }
}

function ensureOperationalConfig(db, profileOverride = '') {
  db.operacaoConfig = db.operacaoConfig || {
    businessProfile: 'mercado',
    displayName: 'Operacao Flexivel',
    serviceFlow: true,
    kitchenFlow: true,
    stockFlow: true,
    supportedRoutes: ['counter', 'stock', 'cold', 'kitchen', 'bar'],
    productionStations: ['forno', 'confeitaria', 'preparo', 'balcao'],
    supportsComandas: true
  };
  const profile = normalizeBusinessProfile(profileOverride || db.operacaoConfig.businessProfile);
  const normalized = buildOperationalProfileConfig(profile, db.operacaoConfig);
  normalized.supportedRoutes = Array.isArray(normalized.supportedRoutes)
    ? normalized.supportedRoutes
    : ['counter', 'stock', 'cold'];
  normalized.productionStations = Array.isArray(normalized.productionStations)
    ? normalized.productionStations
    : ['balcao', 'estoque'];
  if (!profileOverride) {
    db.operacaoConfig = normalized;
  }
  return normalized;
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

function roundCurrency(value) {
  return Number(Number(value || 0).toFixed(2));
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

function buildOrderTotals({ subtotal, desconto, channel = 'online' }) {
  const totalBase = Math.max(0, subtotal - desconto);
  const frete = channel === 'fisico' ? 0 : calculateFrete(totalBase);
  const total = totalBase + frete;
  return { totalBase, frete, total };
}

function getOrderById(db, orderId) {
  return (db.pedidos || []).find((p) => p.id === orderId);
}

function isPendingStatus(status = '') {
  const s = String(status || '').toLowerCase();
  return (
    s.includes('aguardando') ||
    s.includes('pendente') ||
    s.includes('recebido') ||
    s.includes('preparo') ||
    s.includes('pronto') ||
    s.includes('entrega')
  );
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
  if (raw.includes('dinhe') || raw === 'cash') return 'cash';
  if (raw === 'pix') return 'pix';
  if (raw.includes('debit') || raw.includes('debito')) return 'debit';
  if (raw.includes('credit') || raw.includes('credito')) return 'credit';
  if (raw.includes('maquin')) return 'maquininha';
  return 'mercadopago';
}

function normalizeCheckoutPayments(payments = [], fallbackMethod = '', defaultAmount = 0) {
  const list = Array.isArray(payments) ? payments : [];
  const normalized = list
    .map((entry, index) => {
      const method = resolvePaymentMethod(entry?.method || fallbackMethod);
      const amount = roundCurrency(entry?.amount);
      if (!method || amount <= 0) {
        return null;
      }

      const amountReceivedRaw = Number(entry?.amountReceived);
      const changeAmountRaw = Number(entry?.changeAmount);
      const isCash = method === 'cash';
      const amountReceived = isCash
        ? roundCurrency(
            Number.isFinite(amountReceivedRaw) && amountReceivedRaw > 0 ? amountReceivedRaw : amount
          )
        : null;
      const changeAmount = isCash
        ? roundCurrency(
            Number.isFinite(changeAmountRaw) ? changeAmountRaw : Math.max(0, (amountReceived || amount) - amount)
          )
        : null;
      const cardBrand = String(entry?.cardBrand || '').trim() || null;
      const installmentsValue = Number(entry?.installments);
      const transactionReference = String(entry?.transactionReference || '').trim() || null;
      const note = String(entry?.note || '').trim() || null;

      return {
        id: `pay_${Date.now()}_${index + 1}`,
        method,
        amount,
        amountReceived,
        changeAmount,
        cardBrand,
        installments: Number.isFinite(installmentsValue) && installmentsValue > 0
          ? Math.trunc(installmentsValue)
          : null,
        transactionReference,
        note
      };
    })
    .filter(Boolean);

  if (normalized.length > 0) {
    return normalized;
  }

  const resolvedMethod = resolvePaymentMethod(fallbackMethod);
  const roundedAmount = roundCurrency(defaultAmount);
  if (!resolvedMethod || resolvedMethod === 'mercadopago' || roundedAmount <= 0) {
    return [];
  }

  return [
    {
      id: `pay_${Date.now()}_1`,
      method: resolvedMethod,
      amount: roundedAmount,
      amountReceived: resolvedMethod === 'cash' ? roundedAmount : null,
      changeAmount: resolvedMethod === 'cash' ? 0 : null,
      cardBrand: null,
      installments: null,
      transactionReference: null,
      note: null
    }
  ];
}

function resolvePaymentSummaryMethod(payments = [], fallbackMethod = null) {
  if (payments.length === 1) {
    return payments[0]?.method || fallbackMethod || null;
  }
  if (payments.length > 1) {
    return 'multiple';
  }
  return fallbackMethod || null;
}

function applyPhysicalCheckoutSettlement(order, payments = [], note = '') {
  if (!Array.isArray(payments) || payments.length === 0) {
    order.status = 'Finalizado';
    order.observacaoFechamento = String(note || '').trim() || null;
    return order;
  }

  const totalPaid = roundCurrency(
    payments.reduce((sum, item) => sum + Number(item?.amount || 0), 0)
  );
  const totalDue = roundCurrency(order.total || 0);
  if (Math.abs(totalPaid - totalDue) > 0.05) {
    const err = new Error(
      `Total pago divergente. Esperado ${totalDue.toFixed(2)} e recebido ${totalPaid.toFixed(2)}.`
    );
    err.status = 400;
    throw err;
  }

  order.status = 'Pago';
  order.observacaoFechamento = String(note || '').trim() || null;
  order.payment = {
    ...(order.payment || {}),
    status: 'approved',
    method: resolvePaymentSummaryMethod(payments, order.payment?.method || null),
    totalPaid,
    entries: payments,
    updatedAt: new Date().toISOString()
  };
  return order;
}

function normalizeKitchenStage(status = '') {
  const raw = String(status || '').trim().toLowerCase();
  if (!raw) return 'received';
  if (raw.includes('prepar')) return 'preparing';
  if (raw.includes('ready') || raw.includes('pronto')) return 'ready';
  if (raw.includes('deliver') || raw.includes('entreg')) return 'delivered';
  return 'received';
}

function stageLabel(stage = 'received') {
  switch (normalizeKitchenStage(stage)) {
    case 'preparing':
      return 'Em preparo';
    case 'ready':
      return 'Pronto';
    case 'delivered':
      return 'Entregue';
    default:
      return 'Recebido';
  }
}

function resolveOperationalRoute(prod = {}, rawItem = {}) {
  const haystack = [
    rawItem.rotaOperacional,
    prod.rotaOperacional,
    prod.estacaoProducao,
    prod.setor,
    prod.nome
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (haystack.includes('estoque') || haystack.includes('deposito')) return 'stock';
  if (haystack.includes('frio') || haystack.includes('gelad') || haystack.includes('congel')) return 'cold';
  if (haystack.includes('bar') || haystack.includes('bebida') || haystack.includes('suco') || haystack.includes('cafe')) return 'bar';
  if (haystack.includes('forno') || haystack.includes('cozinha') || haystack.includes('padaria') || haystack.includes('confeitaria') || haystack.includes('produc')) return 'kitchen';
  return 'counter';
}

function buildOperationalItems(db, items = []) {
  return (items || [])
    .map((rawItem) => {
      const prod = (db.produtos || []).find((p) => String(p.id) === String(rawItem.produtoId || ''));
      if (!prod) return null;
      return {
        produtoId: prod.id,
        produto: prod.nome,
        unidade: prod.unidade,
        preco: Number(rawItem.preco ?? prod.preco ?? 0),
        quantidade: Number(rawItem.quantidade || 0),
        rotaOperacional: resolveOperationalRoute(prod, rawItem),
        observacao: String(rawItem.observacao || '').trim() || null,
        lote: prod.lote || null,
        validade: prod.validade || null,
        exigeReceita: Boolean(prod.exigeReceita),
        tempoProducaoMin: Number(prod.tempoProducaoMin || 0),
        estacaoProducao: String(prod.estacaoProducao || '').trim() || null,
        sobEncomenda: Boolean(prod.sobEncomenda)
      };
    })
    .filter(Boolean);
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
  const channel = resolveChannelFromCartId(cartId);
  let desconto = 0;
  let cupomAplicado = null;

  if (codigoCupom) {
    const cupom = validateCoupon(codigoCupom, subtotal);
    desconto = Math.min(calculateCouponDiscount(cupom, subtotal), subtotal);
    cupomAplicado = cupom.codigo;
  }

  const { totalBase, frete, total } = buildOrderTotals({ subtotal, desconto, channel });
  return {
    itens: cart,
    subtotal,
    desconto,
    totalBase,
    frete,
    total,
    cupomAplicado,
    cartId: resolveCartId(cartId),
    canal: channel
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

  const channel = resolveChannelFromCartId(cartKey);
  const { totalBase, frete, total } = buildOrderTotals({ subtotal, desconto, channel });
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

export function checkoutCart({
  cpf = '',
  nomeCliente = '',
  cupom = '',
  cartId = '',
  payments = [],
  metodoPagamento = '',
  discountAmount = 0,
  note = ''
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

  const manualDiscount = Math.max(0, Number(discountAmount || 0));
  desconto = Math.min(subtotal, desconto + manualDiscount);

  const channel = resolveChannelFromCartId(cartKey);
  const { totalBase, frete, total } = buildOrderTotals({ subtotal, desconto, channel });

  const items = aggregateItemsByProduct(cart);
  ensureStockAvailability(db, items, { exceptCartId: cartKey });
  applyStockDeduction(db, items);

  const order = {
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
  };
  if (channel === 'fisico') {
    const normalizedPayments = normalizeCheckoutPayments(payments, metodoPagamento, total);
    applyPhysicalCheckoutSettlement(order, normalizedPayments, note);
  }

  db.pedidos.push(order);

  db.carrinhos[cartKey] = [];
  if (cupomAplicado) {
    registerCouponUse(cupomAplicado);
  }
  writeDb(db);

  const fidelidade = applyLoyalty(cpf, nomeCliente, total);

  return {
    sucesso: true,
    mensagem: channel === 'fisico'
      ? (order.status === 'Pago'
          ? 'Venda fisica finalizada com pagamento registrado.'
          : 'Venda fisica finalizada sem conciliacao de pagamento.')
      : 'Compra finalizada!',
    subtotal,
    desconto,
    totalBase,
    frete,
    total,
    cupomAplicado,
    fidelidade,
    canal: channel,
    cartId: cartKey,
    orderId: order.id,
    status: order.status,
    payment: order.payment || null
  };
}

export function getUnifiedOperationSummary() {
  const db = readDb();
  ensureCollections(db);
  const operationalConfig = ensureOperationalConfig(db);

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
    operacao: operationalConfig,
    canais: {
      online: channelStats('online'),
      fisico: channelStats('fisico')
    },
    carrinhosAtivos: activeCarts,
    pedidosPendentes: pendingOrders,
    alertasEstoque: stockAlerts
  };
}

export function getOperationalConfig(profile = '') {
  const db = readDb();
  ensureCollections(db);
  return ensureOperationalConfig(db, profile);
}

export function createOperationalOrder({
  cartId = '',
  tableId = '',
  serviceChannel = 'dine_in',
  operator = '',
  note = '',
  businessProfile = '',
  items = []
} = {}) {
  const db = readDb();
  ensureCollections(db);
  const operationalConfig = ensureOperationalConfig(db, businessProfile);
  const enrichedItems = buildOperationalItems(db, items);
  if (!enrichedItems.length) {
    const err = new Error('Nenhum item valido foi enviado para a operacao.');
    err.status = 400;
    throw err;
  }

  ensureStockAvailability(db, enrichedItems, {});

  const subtotal = Number(
    enrichedItems.reduce((sum, item) => sum + Number(item.preco || 0) * Number(item.quantidade || 0), 0).toFixed(2)
  );
  const order = {
    id: `ped_${Date.now()}`,
    createdAt: new Date().toISOString(),
    cartId: resolveCartId(cartId || `operacao-${Date.now()}`),
    canal: 'fisico',
    origemOperacional: 'app',
    businessProfile: operationalConfig.businessProfile,
    serviceChannel: String(serviceChannel || 'dine_in').trim().toLowerCase() === 'pickup' ? 'pickup' : 'dine_in',
    mesa: String(tableId || '').trim() || null,
    operador: String(operator || '').trim() || null,
    observacao: String(note || '').trim() || null,
    kitchenStage: 'received',
    status: 'Recebido',
    itens: aggregateItemsByProduct(enrichedItems).map((item) => {
      const match = enrichedItems.find((row) => String(row.produtoId) === String(item.produtoId));
      return {
        ...item,
        rotaOperacional: match?.rotaOperacional || 'counter',
        observacao: match?.observacao || null,
        lote: match?.lote || null,
        validade: match?.validade || null,
        exigeReceita: Boolean(match?.exigeReceita),
        tempoProducaoMin: Number(match?.tempoProducaoMin || 0),
        estacaoProducao: match?.estacaoProducao || null,
        sobEncomenda: Boolean(match?.sobEncomenda)
      };
    }),
    subtotal,
    desconto: 0,
    totalBase: subtotal,
    frete: 0,
    total: subtotal,
    payment: {
      status: 'pending',
      method: null,
      entries: []
    }
  };

  db.pedidos.push(order);
  writeDb(db);
  return normalizeOrder(order);
}

export function listProductionQueue(filters = {}) {
  const db = readDb();
  ensureCollections(db);
  const routeFilter = String(filters.rota || filters.route || '').trim().toLowerCase();
  const profileFilter = normalizeBusinessProfile(filters.profile || filters.businessProfile || '');
  return (db.pedidos || [])
    .map(normalizeOrder)
    .filter((order) => resolveOrderChannel(order) === 'fisico')
    .filter((order) => {
      if (!String(filters.profile || filters.businessProfile || '').trim()) {
        return true;
      }
      return normalizeBusinessProfile(order.businessProfile || '') === profileFilter;
    })
    .filter((order) => isPendingStatus(order.status))
    .map((order) => ({
      ...order,
      kitchenStage: normalizeKitchenStage(order.kitchenStage || order.status),
      itens: (order.itens || []).filter((item) => {
        if (!routeFilter) return true;
        return String(item.rotaOperacional || '').trim().toLowerCase() === routeFilter;
      })
    }))
    .filter((order) => (order.itens || []).length > 0)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

export function updateProductionStatus(orderId, stage) {
  const db = readDb();
  ensureCollections(db);
  const order = getOrderById(db, orderId);
  if (!order) {
    const err = new Error('Pedido nao encontrado');
    err.status = 404;
    throw err;
  }
  const normalized = normalizeKitchenStage(stage);
  order.kitchenStage = normalized;
  order.status = stageLabel(normalized);
  writeDb(db);
  return normalizeOrder(order);
}

export function settleOperationalOrder(orderId, { payments = [], discountAmount = 0, note = '' } = {}) {
  const db = readDb();
  ensureCollections(db);
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

  const baseSubtotal = Number(order.subtotal || 0);
  const appliedDiscount = Math.max(0, Number(discountAmount || order.desconto || 0));
  const totalBase = Math.max(0, baseSubtotal - appliedDiscount);
  const totalPaid = Number(
    (payments || []).reduce((sum, item) => sum + Number(item?.amount || 0), 0).toFixed(2)
  );

  order.desconto = appliedDiscount;
  order.totalBase = totalBase;
  order.total = totalBase;
  order.frete = 0;
  order.status = 'Pago';
  order.kitchenStage = 'delivered';
  order.observacaoFechamento = String(note || '').trim() || null;
  order.payment = {
    ...(order.payment || {}),
    status: 'approved',
    method: payments.length === 1 ? payments[0]?.method || null : 'multiple',
    totalPaid,
    entries: payments,
    updatedAt: new Date().toISOString()
  };

  writeDb(db);
  return normalizeOrder(order);
}
