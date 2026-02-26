import { Router } from 'express';
import {
  deleteSaidaController,
  getAnalyticsOverviewController,
  getAnalyticsResumoController,
  getAnalyticsSeriesController,
  getAnalyticsTopProdutosController,
  getCarrinho,
  getCheckout,
  postPagamentoPreferencia,
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
  login,
  me,
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
  exportPedidosCsv,
  exportSaidasCsv,
  uploadImagemController,
  putPedidoStatus
} from '../controllers/storeController.js';
import { requireAdmin, requireAuth, requireRole } from '../middlewares/authMiddleware.js';
import { upload } from '../middlewares/uploadMiddleware.js';

const router = Router();

router.post('/auth/register', register);
router.post('/auth/login', login);
router.get('/auth/me', requireAuth, me);

router.get('/produtos', getProdutos);
router.post('/produtos', requireAuth, requireAdmin, postProduto);
router.put('/produtos/:id', requireAuth, requireAdmin, putProduto);
router.delete('/produtos/:id', requireAuth, requireAdmin, removeProduto);

router.get('/promocoes', getPromocoesController);
router.get('/informacoes', getInformacoesController);
router.get('/fidelidade', getFidelidadeController);
router.get('/fidelidade/:cpf', getFidelidadeCpfController);

router.get('/cupons/validar', validarCupomController);

router.post('/carrinho', postCarrinho);
router.get('/carrinho', getCarrinho);
router.get('/checkout', getCheckout);
router.post('/finalizar', postFinalizar);
router.post('/pagamento/preferencia', postPagamentoPreferencia);
router.post('/pagamento/webhook', postPagamentoWebhook);
router.get('/pedidos', getPedidosPorCpf);
router.get('/admin/pedidos', requireAuth, requireRole(['admin', 'operador']), getPedidosAdmin);
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
