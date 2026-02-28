import {
  createProduct,
  deleteProduct,
  listProducts,
  updateProduct
} from '../services/catalogService.js';
import {
  addCartItem,
  checkoutCart,
  createPendingOrder,
  finalizePaidOrder,
  getCheckoutPreview,
  listCart,
  listOrdersByCpf,
  listOrdersAll,
  updateOrderStatus
} from '../services/cartService.js';
import { getFidelidade, getInformacoes, getPromocoes } from '../services/contentService.js';
import { getLoyaltyByCpf } from '../services/loyaltyService.js';
import {
  getFacebookAuthConfig,
  getGoogleAuthConfig,
  loginUser,
  loginWithFacebookToken,
  loginWithGoogleToken,
  registerUser
} from '../services/authService.js';
import { validateCoupon } from '../services/couponService.js';
import { createSaida, deleteSaida, listSaidas } from '../services/financeService.js';
import {
  addStockEntry,
  addStockLoss,
  getStockTurnover,
  listLowStock,
  listStockEntries,
  listStockLosses
} from '../services/inventoryService.js';
import {
  getAnalyticsOverview,
  getAnalyticsSeries,
  getAnalyticsSummary,
  getTopProdutos
} from '../services/analyticsService.js';
import { createPreference, getPayment } from '../services/paymentService.js';

function getCartId(req) {
  return req.headers['x-cart-id'] || req.query.cartId || req.body?.cartId || '';
}

export function uploadImagemController(req, res) {
  if (!req.file) {
    return res.status(400).json({ erro: 'Imagem nao enviada' });
  }
  const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  return res.status(201).json({ url, arquivo: req.file.filename });
}

export function register(req, res, next) {
  try {
    const result = registerUser(req.body || {});
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export function login(req, res, next) {
  try {
    const result = loginUser(req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export function getGoogleAuthConfigController(req, res) {
  res.json(getGoogleAuthConfig());
}

export async function loginGoogle(req, res, next) {
  try {
    const result = await loginWithGoogleToken(req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export function getFacebookAuthConfigController(req, res) {
  res.json(getFacebookAuthConfig());
}

export async function loginFacebook(req, res, next) {
  try {
    const result = await loginWithFacebookToken(req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export function me(req, res) {
  res.json(req.user);
}

export function getProdutos(req, res) {
  res.json(listProducts(req.query));
}

export function postProduto(req, res, next) {
  try {
    const required = ['nome', 'setor', 'preco', 'unidade'];
    for (const field of required) {
      if (!req.body[field] && req.body[field] !== 0) {
        const err = new Error(`Campo obrigatorio: ${field}`);
        err.status = 400;
        throw err;
      }
    }

    const created = createProduct(req.body);
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
}

export function putProduto(req, res, next) {
  try {
    const updated = updateProduct(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ erro: 'Produto não encontrado' });
    }
    return res.json(updated);
  } catch (error) {
    return next(error);
  }
}

export function removeProduto(req, res) {
  const ok = deleteProduct(req.params.id);
  if (!ok) {
    return res.status(404).json({ erro: 'Produto não encontrado' });
  }
  return res.json({ sucesso: true });
}

export function postCarrinho(req, res, next) {
  try {
    const result = addCartItem(req.body, getCartId(req));
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export function getCarrinho(req, res) {
  res.json(listCart(getCartId(req)));
}

export function getCheckout(req, res, next) {
  try {
    const cupom = req.query.cupom || '';
    res.json(getCheckoutPreview(cupom, getCartId(req)));
  } catch (error) {
    next(error);
  }
}

export function postFinalizar(req, res, next) {
  try {
    res.json(checkoutCart({ ...(req.body || {}), cartId: getCartId(req) }));
  } catch (error) {
    next(error);
  }
}

export async function postPagamentoPreferencia(req, res, next) {
  try {
    const order = createPendingOrder({ ...(req.body || {}), cartId: getCartId(req) });
    const preference = await createPreference({ order });
    res.status(201).json({
      preferenceId: preference.id,
      initPoint: preference.init_point,
      sandboxInitPoint: preference.sandbox_init_point || null,
      orderId: order.id
    });
  } catch (error) {
    next(error);
  }
}

export async function postPagamentoWebhook(req, res, next) {
  try {
    const paymentId = req.body?.data?.id || req.query?.data?.id || req.body?.id || req.query?.id;
    if (!paymentId) {
      return res.status(200).json({ recebido: true });
    }

    const payment = await getPayment(paymentId);
    const orderId = payment.external_reference;
    if (!orderId) {
      return res.status(200).json({ recebido: true });
    }

    if (payment.status === 'approved') {
      finalizePaidOrder(orderId, {
        status: payment.status,
        id: payment.id,
        method: payment.payment_method_id || payment.payment_type_id
      });
    } else {
      updateOrderStatus(orderId, payment.status === 'rejected' ? 'Pagamento recusado' : 'Pagamento pendente');
    }

    return res.status(200).json({ recebido: true });
  } catch (error) {
    next(error);
  }
}

export function getPedidosPorCpf(req, res) {
  const requestedCpf = String(req.query.cpf || '').replace(/\D/g, '');
  const userCpf = String(req.user?.cpf || '').replace(/\D/g, '');
  const role = String(req.user?.role || '').toLowerCase();
  const isPrivileged = role === 'admin' || role === 'operador';

  if (isPrivileged) {
    return res.json(listOrdersByCpf(requestedCpf));
  }

  const targetCpf = userCpf || requestedCpf;
  if (!targetCpf) {
    return res.status(400).json({ erro: 'CPF do usuario nao disponivel para consulta.' });
  }
  if (requestedCpf && requestedCpf !== userCpf) {
    return res.status(403).json({ erro: 'Acesso negado ao historico de outro CPF.' });
  }

  return res.json(listOrdersByCpf(targetCpf));
}

function csvEscape(value) {
  const raw = String(value ?? '');
  const needsQuote = raw.includes('"') || raw.includes(',') || raw.includes('\n');
  const safe = raw.replace(/"/g, '""');
  return needsQuote ? `"${safe}"` : safe;
}

export function getPedidosAdmin(req, res) {
  const { status = '', cpf = '', dataInicio = '', dataFim = '', minTotal = '' } = req.query || {};
  res.json(listOrdersAll({ status, cpf, dataInicio, dataFim, minTotal }));
}

export function putPedidoStatus(req, res) {
  const { status } = req.body || {};
  if (!status) {
    return res.status(400).json({ erro: 'Status obrigatório' });
  }
  const updated = updateOrderStatus(req.params.id, status);
  if (!updated) {
    return res.status(404).json({ erro: 'Pedido não encontrado' });
  }
  return res.json(updated);
}

export function exportPedidosCsv(req, res) {
  const { status = '', cpf = '', dataInicio = '', dataFim = '', minTotal = '' } = req.query || {};
  const rows = listOrdersAll({ status, cpf, dataInicio, dataFim, minTotal });
  const header = [
    'id',
    'data',
    'itens',
    'subtotal',
    'desconto',
    'frete',
    'total',
    'status',
    'cpf',
    'nomeCliente',
    'cupom'
  ];
  const lines = [header.join(',')];
  rows.forEach((p) => {
    const itensResumo = (p.itens || []).map((i) => `${i.produto} x${i.quantidade}`).join('; ');
    lines.push([
      csvEscape(p.id),
      csvEscape(p.createdAt),
      csvEscape(itensResumo),
      csvEscape(p.subtotal),
      csvEscape(p.desconto),
      csvEscape(p.frete),
      csvEscape(p.total),
      csvEscape(p.status || ''),
      csvEscape(p.cpf || ''),
      csvEscape(p.nomeCliente || ''),
      csvEscape(p.cupomAplicado || '')
    ].join(','));
  });

  const content = `\ufeff${lines.join('\n')}`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="pedidos.csv"');
  res.send(content);
}

export function exportSaidasCsv(req, res) {
  const rows = listSaidas();
  const header = ['id', 'data', 'descricao', 'categoria', 'valor'];
  const lines = [header.join(',')];
  rows.forEach((s) => {
    lines.push([
      csvEscape(s.id),
      csvEscape(s.data),
      csvEscape(s.descricao),
      csvEscape(s.categoria || ''),
      csvEscape(s.valor)
    ].join(','));
  });

  const content = `\ufeff${lines.join('\n')}`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="saidas.csv"');
  res.send(content);
}

export function validarCupomController(req, res, next) {
  try {
    const codigo = req.query.codigo || '';
    const subtotal = Number(req.query.subtotal || 0);
    const cupom = validateCoupon(codigo, subtotal);
    res.json({
      codigo: cupom.codigo,
      tipo: cupom.tipo,
      valor: cupom.valor,
      minSubtotal: cupom.minSubtotal,
      validade: cupom.validade
    });
  } catch (error) {
    next(error);
  }
}

export function getPromocoesController(req, res) {
  res.json(getPromocoes());
}

export function getInformacoesController(req, res) {
  res.json(getInformacoes());
}

export function getFidelidadeController(req, res) {
  res.json(getFidelidade());
}

export function getFidelidadeCpfController(req, res) {
  const requestedCpf = String(req.params.cpf || '').replace(/\D/g, '');
  const userCpf = String(req.user?.cpf || '').replace(/\D/g, '');
  const role = String(req.user?.role || '').toLowerCase();
  const isPrivileged = role === 'admin' || role === 'operador';
  const targetCpf = isPrivileged ? requestedCpf : userCpf;

  if (!targetCpf) {
    return res.status(400).json({ erro: 'CPF do usuario nao disponivel para consulta.' });
  }
  if (!isPrivileged && requestedCpf && requestedCpf !== userCpf) {
    return res.status(403).json({ erro: 'Acesso negado ao fidelidade de outro CPF.' });
  }

  const data = getLoyaltyByCpf(targetCpf);
  if (!data) {
    return res.status(404).json({ erro: 'CPF não encontrado no programa de fidelidade' });
  }
  return res.json(data);
}

export function getSaidasController(req, res) {
  res.json(listSaidas());
}

export function getEntradasEstoque(req, res) {
  res.json(listStockEntries());
}

export function postEntradaEstoque(req, res, next) {
  try {
    const entry = addStockEntry(req.body || {});
    res.status(201).json(entry);
  } catch (error) {
    next(error);
  }
}

export function getPerdasEstoque(req, res) {
  res.json(listStockLosses());
}

export function postPerdaEstoque(req, res, next) {
  try {
    const loss = addStockLoss(req.body || {});
    res.status(201).json(loss);
  } catch (error) {
    next(error);
  }
}

export function getGiroEstoque(req, res) {
  res.json(getStockTurnover());
}

export function getEstoqueBaixo(req, res) {
  const limite = Number(req.query.limite || 10);
  res.json(listLowStock(limite));
}

export function exportEstoqueBaixoCsv(req, res) {
  const limite = Number(req.query.limite || 10);
  const rows = listLowStock(limite);
  const header = ['produto', 'unidade', 'estoque'];
  const lines = [header.join(',')];
  rows.forEach((p) => {
    lines.push([
      csvEscape(p.nome),
      csvEscape(p.unidade || ''),
      csvEscape(p.estoque ?? 0)
    ].join(','));
  });
  const content = `\ufeff${lines.join('\n')}`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="estoque_baixo.csv"');
  res.send(content);
}

export function exportPerdasCsv(req, res) {
  const rows = listStockLosses();
  const header = ['id', 'data', 'produto', 'unidade', 'quantidade', 'motivo'];
  const lines = [header.join(',')];
  rows.forEach((p) => {
    lines.push([
      csvEscape(p.id),
      csvEscape(p.data),
      csvEscape(p.produto),
      csvEscape(p.unidade),
      csvEscape(p.quantidade),
      csvEscape(p.motivo)
    ].join(','));
  });
  const content = `\ufeff${lines.join('\n')}`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="perdas.csv"');
  res.send(content);
}

export function exportGiroCsv(req, res) {
  const rows = getStockTurnover();
  const header = ['produto', 'unidade', 'entrada', 'saidaVenda', 'perda', 'saidaTotal'];
  const lines = [header.join(',')];
  rows.forEach((p) => {
    lines.push([
      csvEscape(p.produto),
      csvEscape(p.unidade),
      csvEscape(p.entrada),
      csvEscape(p.saidaVenda),
      csvEscape(p.perda),
      csvEscape(p.saidaTotal)
    ].join(','));
  });
  const content = `\ufeff${lines.join('\n')}`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="giro.csv"');
  res.send(content);
}

export function postSaidaController(req, res, next) {
  try {
    const item = createSaida(req.body || {});
    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
}

export function deleteSaidaController(req, res) {
  const ok = deleteSaida(req.params.id);
  if (!ok) {
    return res.status(404).json({ erro: 'Saída não encontrada' });
  }
  return res.json({ sucesso: true });
}

export function getAnalyticsOverviewController(req, res) {
  res.json(getAnalyticsOverview());
}

export function getAnalyticsResumoController(req, res) {
  res.json(getAnalyticsSummary(req.query.periodo || 'mes'));
}

export function getAnalyticsSeriesController(req, res) {
  res.json(getAnalyticsSeries(req.query.periodo || 'mes'));
}

export function getAnalyticsTopProdutosController(req, res) {
  res.json(getTopProdutos(req.query.periodo || 'mes'));
}



