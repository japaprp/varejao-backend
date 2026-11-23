import { Router } from 'express';
import {
  deleteCarrinho,
  deleteSaidaController,
  getAnalyticsOverviewController,
  getAnalyticsResumoController,
  getAnalyticsSeriesController,
  getAnalyticsTopProdutosController,
  getCarrinho,
  getCheckout,
  streamCheckout,
  streamAdminOperacao,
  postPagamentoPreferencia,
  postPagamentoMaquininhaIniciar,
  postPagamentoMaquininhaConfirmar,
  postPagamentoWebhook,
  getFidelidadeController,
  getFidelidadeCpfController,
  getInformacoesController,
  getProdutos,
  getPromocoesController,
  getSaidasController,
  getEntradasEstoque,
  getPerdasEstoque,
  getGiroEstoque,
  getEstoqueBaixo,
  postEntradaEstoque,
  postPerdaEstoque,
  exportPerdasCsv,
  exportGiroCsv,
  exportEstoqueBaixoCsv,
  forgotPasswordController,
  login,
  me,
  getOperationalUsers,
  postCartSession,
  postCarrinho,
  postFinalizar,
  postProduto,
  postSaidaController,
  putProduto,
  register,
  removeProduto,
  validarCupomController,
  getPedidosPorCpf,
  getPedidosAdmin,
  getOperacaoUnificadaController,
  exportPedidosCsv,
  exportSaidasCsv,
  getOperationalConfigController,
  getProductionQueueController,
  uploadImagemController,
  postOperationalOrderController,
  postOperationalSettlementController,
  putProductionStatusController,
  putPedidoStatus,
  getGoogleAuthConfigController,
  loginGoogle,
  getFacebookAuthConfigController,
  loginFacebook
} from '../controllers/storeController.js';
import { requireAdmin, requireAuth, requireRole } from '../middlewares/authMiddleware.js';
import { requireCartAccess } from '../middlewares/cartSessionMiddleware.js';
import { authLimiter, createRateLimiter, paymentLimiter } from '../middlewares/rateLimitMiddleware.js';
import { upload } from '../middlewares/uploadMiddleware.js';
import {
  validateForgotPasswordPayload,
  validateFacebookPayload,
  validateGooglePayload,
  validateLoginPayload,
  validateRegisterPayload
} from '../middlewares/validationMiddleware.js';

const router = Router();
const operationalRoles = ['admin', 'operador', 'gerente', 'manager', 'caixa', 'cashier', 'balcao', 'waiter', 'cozinha', 'kitchen', 'chef', 'producao'];
const managementRoles = ['admin', 'operador', 'gerente', 'manager'];
const settlementRoles = ['admin', 'operador', 'gerente', 'manager', 'caixa', 'cashier'];

function requireOperationalOrderId(req, res, next) {
  if (req.body?.clientOrderId === undefined) {
    return res.status(400).json({ erro: 'Informe o identificador do pedido operacional.' });
  }
  return next();
}

const cartSessionLimiter = createRateLimiter({
  keyPrefix: 'cart-session',
  windowMs: 5 * 60 * 1000,
  max: 20,
  message: 'Muitas sessões de carrinho. Tente novamente em instantes.'
});

router.post('/auth/register', authLimiter, validateRegisterPayload, register);
router.post('/auth/login', authLimiter, validateLoginPayload, login);
router.post('/auth/forgot-password', authLimiter, validateForgotPasswordPayload, forgotPasswordController);
router.get('/auth/google/config', getGoogleAuthConfigController);
router.post('/auth/google', authLimiter, validateGooglePayload, loginGoogle);
router.get('/auth/facebook/config', getFacebookAuthConfigController);
router.post('/auth/facebook', authLimiter, validateFacebookPayload, loginFacebook);
router.get('/auth/me', requireAuth, me);
router.get('/auth/operators', requireAuth, requireRole(managementRoles), getOperationalUsers);

router.get('/produtos', getProdutos);
router.post('/produtos', requireAuth, requireAdmin, postProduto);
router.put('/produtos/:id', requireAuth, requireAdmin, putProduto);
router.delete('/produtos/:id', requireAuth, requireAdmin, removeProduto);

router.get('/promocoes', getPromocoesController);
router.get('/informacoes', getInformacoesController);
router.get('/fidelidade', getFidelidadeController);
router.get('/fidelidade/:cpf', requireAuth, getFidelidadeCpfController);

router.get('/cupons/validar', validarCupomController);

router.post('/carrinho/sessao', cartSessionLimiter, postCartSession);
router.post('/carrinho', requireCartAccess, postCarrinho);
router.get('/carrinho', requireCartAccess, getCarrinho);
router.delete('/carrinho', requireCartAccess, deleteCarrinho);
router.get('/checkout', requireCartAccess, getCheckout);
router.get('/stream/checkout', requireCartAccess, streamCheckout);
router.get('/stream/admin/operacao', streamAdminOperacao);
router.post('/finalizar', postFinalizar);
router.get('/operacao/config', getOperationalConfigController);
router.post('/operacao/pedidos', requireAuth, requireRole(operationalRoles), postOperationalOrderController);
router.post('/operacao/pedidos/sincronizar', requireAuth, requireRole(operationalRoles), requireOperationalOrderId, postOperationalOrderController);
router.get('/operacao/producao', requireAuth, requireRole(operationalRoles), getProductionQueueController);
router.patch('/operacao/pedidos/:id/producao-status', requireAuth, requireRole(operationalRoles), putProductionStatusController);
router.post('/operacao/pedidos/:id/fechar', requireAuth, requireRole(settlementRoles), postOperationalSettlementController);
router.post('/pagamento/preferencia', paymentLimiter, requireCartAccess, postPagamentoPreferencia);
router.post('/pagamento/maquininha/iniciar', paymentLimiter, requireAuth, requireRole(settlementRoles), requireCartAccess, postPagamentoMaquininhaIniciar);
router.post('/pagamento/maquininha/confirmar', paymentLimiter, requireAuth, requireRole(['admin', 'operador', 'gerente', 'manager', 'caixa', 'cashier']), postPagamentoMaquininhaConfirmar);
router.post('/pagamento/webhook', paymentLimiter, postPagamentoWebhook);
router.get('/pedidos', requireAuth, getPedidosPorCpf);
router.get('/admin/pedidos', requireAuth, requireRole(['admin', 'operador']), getPedidosAdmin);
router.get('/admin/operacao-unificada', requireAuth, requireAdmin, getOperacaoUnificadaController);
router.put('/admin/pedidos/:id/status', requireAuth, requireAdmin, putPedidoStatus);
router.get('/admin/pedidos.csv', requireAuth, requireRole(['admin', 'operador']), exportPedidosCsv);
router.get('/admin/saidas.csv', requireAuth, requireRole(['admin', 'operador']), exportSaidasCsv);
router.post('/upload', requireAuth, requireAdmin, upload.single('imagem'), uploadImagemController);

router.get('/financeiro/saidas', requireAuth, requireRole(['admin', 'operador']), getSaidasController);
router.post('/financeiro/saidas', requireAuth, requireAdmin, postSaidaController);
router.delete('/financeiro/saidas/:id', requireAuth, requireAdmin, deleteSaidaController);
router.get('/estoque/entradas', requireAuth, requireRole(['admin', 'operador']), getEntradasEstoque);
router.post('/estoque/entradas', requireAuth, requireRole(['admin', 'operador']), postEntradaEstoque);
router.get('/estoque/perdas', requireAuth, requireRole(['admin', 'operador']), getPerdasEstoque);
router.post('/estoque/perdas', requireAuth, requireRole(['admin', 'operador']), postPerdaEstoque);
router.get('/estoque/giro', requireAuth, requireRole(['admin', 'operador']), getGiroEstoque);
router.get('/estoque/baixo', requireAuth, requireRole(['admin', 'operador']), getEstoqueBaixo);
router.get('/estoque/perdas.csv', requireAuth, requireRole(['admin', 'operador']), exportPerdasCsv);
router.get('/estoque/giro.csv', requireAuth, requireRole(['admin', 'operador']), exportGiroCsv);
router.get('/estoque/baixo.csv', requireAuth, requireRole(['admin', 'operador']), exportEstoqueBaixoCsv);

router.get('/analytics/overview', requireAuth, requireRole(['admin', 'operador']), getAnalyticsOverviewController);
router.get('/analytics/resumo', requireAuth, requireRole(['admin', 'operador']), getAnalyticsResumoController);
router.get('/analytics/series', requireAuth, requireRole(['admin', 'operador']), getAnalyticsSeriesController);
router.get('/analytics/top-produtos', requireAuth, requireRole(['admin', 'operador']), getAnalyticsTopProdutosController);

export default router;
