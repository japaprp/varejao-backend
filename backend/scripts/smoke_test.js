import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { addCartItem, confirmMachinePayment, createPendingOrder, createOperationalOrder } from '../src/services/cartService.js';
import { readDb } from '../src/data/repository.js';
import { verifyWebhookSignature, validatePaymentForOrder } from '../src/services/paymentService.js';
import { registerUser } from '../src/services/authService.js';
import crypto from 'crypto';
import { assertRuntimeConfig } from '../src/config/env.js';
import { createAuthToken } from '../src/utils/security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const dbPath = path.join(backendRoot, 'src', 'data', 'database.json');
const dbBackupPath = `${dbPath}.smoke.bak`;
const port = Number(process.env.SMOKE_PORT || 3101);
const baseUrl = `http://127.0.0.1:${port}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(timeoutMs = 20000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/informacoes`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`Servidor respondeu com status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }

  throw lastError || new Error('Servidor nao respondeu dentro do tempo esperado.');
}

async function request(pathname, { method = 'GET', token = '', body } = {}) {
  const headers = {};
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const raw = await response.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = raw;
  }

  if (!response.ok) {
    const detail = typeof json === 'string' ? json : JSON.stringify(json);
    throw new Error(`${method} ${pathname} falhou com ${response.status}: ${detail}`);
  }

  return json;
}

function backupDatabase() {
  fs.copyFileSync(dbPath, dbBackupPath);
}

function restoreDatabase() {
  if (fs.existsSync(dbBackupPath)) {
    fs.copyFileSync(dbBackupPath, dbPath);
    fs.unlinkSync(dbBackupPath);
  }
}

async function main() {
  for (const invalidConfig of [
    { TOKEN_SECRET: '' },
    { TOKEN_SECRET: 'short-secret' },
    { TOKEN_SECRET: 'x'.repeat(32), NODE_ENV: 'production' },
    { TOKEN_SECRET: 'x'.repeat(32), NODE_ENV: 'production', ADMIN_PASSWORD: 'set', DISABLE_DEMO_OPERATIONAL_USERS: 'false' }
  ]) {
    let rejected = false;
    try { assertRuntimeConfig(invalidConfig); } catch { rejected = true; }
    if (!rejected) throw new Error('Configuracao insegura deveria ser rejeitada na inicializacao.');
  }
  if (!assertRuntimeConfig({ TOKEN_SECRET: 'x'.repeat(32), NODE_ENV: 'production', ADMIN_PASSWORD: 'set' })) {
    throw new Error('Configuracao minima segura deveria ser aceita.');
  }
  backupDatabase();

  const smokeAdminPassword = process.env.SMOKE_ADMIN_PASSWORD || crypto.randomBytes(24).toString('hex');
  const smokeTokenSecret = process.env.SMOKE_TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
  const server = spawn(process.execPath, ['index.js'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      PORT: String(port),
      ADMIN_EMAIL: process.env.SMOKE_ADMIN_EMAIL || 'admin@varejao.com',
      ADMIN_PASSWORD: smokeAdminPassword,
      TOKEN_SECRET: smokeTokenSecret,
      DISABLE_DEMO_OPERATIONAL_USERS: 'true'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  server.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer();

    const login = await request('/auth/login', {
      method: 'POST',
      body: {
        email: process.env.SMOKE_ADMIN_EMAIL || 'admin@varejao.com',
        senha: smokeAdminPassword
      }
    });
    const token = String(login?.token || '');
    if (!token) {
      throw new Error('Login smoke nao retornou token.');
    }

    const webhookManifest = 'id:987654321;request-id:smoke-request-1;ts:1700000000000;';
    const webhookDigest = crypto.createHmac('sha256', 'smoke-webhook-secret').update(webhookManifest).digest('hex');
    if (!verifyWebhookSignature({
      xSignature: `ts=1700000000000,v1=${webhookDigest}`,
      xRequestId: 'smoke-request-1',
      dataId: '987654321',
      secret: 'smoke-webhook-secret'
    })) {
      throw new Error('Assinatura HMAC valida deveria ser aceita.');
    }
    if (verifyWebhookSignature({
      xSignature: `ts=1700000000000,v1=${webhookDigest}`,
      xRequestId: 'request-id-adulterado',
      dataId: '987654321',
      secret: 'smoke-webhook-secret'
    })) {
      throw new Error('Assinatura HMAC com request-id adulterado deveria ser rejeitada.');
    }

    let serviceDeniedWithoutActor = false;
    try {
      confirmMachinePayment('missing-order');
    } catch (error) {
      serviceDeniedWithoutActor = error.status === 403;
    }
    if (!serviceDeniedWithoutActor) {
      throw new Error('Servico de confirmacao deveria exigir operador autenticado.');
    }

    const unauthMachineStart = await fetch(`${baseUrl}/pagamento/maquininha/iniciar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cartId: 'fisico-smoke-unauth' })
    });
    if (unauthMachineStart.status !== 401) {
      throw new Error('Maquininha iniciar sem autenticacao deveria retornar 401.');
    }

    const unauthMachineConfirm = await fetch(`${baseUrl}/pagamento/maquininha/confirmar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: 'ped-smoke-unauth' })
    });
    if (unauthMachineConfirm.status !== 401) {
      throw new Error('Maquininha confirmar sem autenticacao deveria retornar 401.');
    }

    const authorizedMachineConfirm = await fetch(`${baseUrl}/pagamento/maquininha/confirmar`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: 'ped-smoke-missing' })
    });
    if (authorizedMachineConfirm.status !== 404) {
      throw new Error('Admin autenticado deveria passar pela autorizacao e receber 404 para pedido inexistente.');
    }

    const idProbeSuffix = crypto.randomBytes(6).toString('hex');
    const idProbeUserA = registerUser({
      nome: 'ID Probe A',
      email: `id-probe-a-${idProbeSuffix}@example.test`,
      senha: `Probe-${idProbeSuffix}-A!`
    });
    const idProbeUserB = registerUser({
      nome: 'ID Probe B',
      email: `id-probe-b-${idProbeSuffix}@example.test`,
      senha: `Probe-${idProbeSuffix}-B!`
    });
    if (!idProbeUserA.usuario?.id || !idProbeUserB.usuario?.id ||
        idProbeUserA.usuario.id === idProbeUserB.usuario.id) {
      throw new Error('Cadastros distintos geraram IDs de usuario iguais.');
    }

    const customerPassword = `Smoke-${Date.now()}-A!`;
    const customer = await request('/auth/register', {
      method: 'POST',
      body: {
        nome: 'Cliente Smoke',
        email: `smoke-${Date.now()}@example.test`,
        senha: customerPassword,
        cpf: '12345678901',
        cep: '12345678',
        rua: 'Rua Smoke',
        bairro: 'Centro',
        cidade: 'Teste',
        telefone: '11999999999'
      }
    });
    const customerToken = String(customer?.token || '');
    if (!customerToken) {
      throw new Error('Cadastro smoke nao retornou token de cliente.');
    }
    const customerMachineConfirm = await fetch(`${baseUrl}/pagamento/maquininha/confirmar`, {
      method: 'POST',
      headers: { authorization: `Bearer ${customerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: 'ped-smoke-customer' })
    });
    if (customerMachineConfirm.status !== 403) {
      throw new Error('Cliente comum deveria receber 403 ao confirmar pagamento na maquininha.');
    }

    const noCpfSuffix = crypto.randomBytes(6).toString('hex');
    const cpfLessCustomer = registerUser({
      nome: 'Cliente sem CPF',
      email: `smoke-no-cpf-${noCpfSuffix}@example.test`,
      senha: `NoCpf-${noCpfSuffix}!`
    });
    if (!cpfLessCustomer?.token) {
      throw new Error('Cadastro smoke sem CPF nao retornou token.');
    }
    const arbitraryCpfHistory = await fetch(`${baseUrl}/pedidos?cpf=12345678901`, {
      headers: { authorization: `Bearer ${cpfLessCustomer.token}` }
    });
    if (arbitraryCpfHistory.status !== 403) {
      throw new Error(`Cliente sem CPF nao pode consultar historico por CPF arbitrario; esperado 403, recebido ${arbitraryCpfHistory.status}.`);
    }

    const resetAttempt = await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.test' })
    });
    if (resetAttempt.status !== 503) {
      throw new Error('Recuperacao sem token/email configurado deveria falhar fechado com 503.');
    }

    const allowedOrigin = await fetch(`${baseUrl}/informacoes`, {
      headers: { origin: 'https://japaprp.github.io' }
    });
    if (allowedOrigin.status !== 200 || allowedOrigin.headers.get('access-control-allow-origin') !== 'https://japaprp.github.io') {
      throw new Error('Origem oficial do GitHub Pages deveria ser permitida pelo CORS.');
    }
    const untrustedOrigin = await fetch(`${baseUrl}/informacoes`, {
      headers: { origin: 'https://untrusted.onrender.com' }
    });
    if (untrustedOrigin.status !== 403) {
      throw new Error('Origem Render nao cadastrada deveria receber 403.');
    }

    const oversizedPayload = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(1024 * 1024 + 100) })
    });
    if (oversizedPayload.status !== 413) {
      throw new Error('Payload JSON acima de 1 MB deveria receber 413.');
    }

    const farmaciaError = await fetch(`${baseUrl}/produtos`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        nome: 'Teste Farmacia Invalido',
        setor: 'farmacia',
        preco: 10.5,
        unidade: 'un',
        businessProfile: 'farmacia',
        strictDomainValidation: true
      })
    });
    if (farmaciaError.status !== 400) {
      throw new Error(`Validacao de farmacia deveria falhar com 400 e retornou ${farmaciaError.status}.`);
    }

    const produto = await request('/produtos', {
      method: 'POST',
      token,
      body: {
        nome: 'Pao Frances Smoke',
        setor: 'padaria',
        preco: 1.5,
        unidade: 'un',
        estoque: 40,
        businessProfile: 'padaria',
        rotaOperacional: 'kitchen',
        estacaoProducao: 'forno',
        tempoProducaoMin: 12,
        codigoInterno: `PAD-${Date.now()}`
      }
    });

    const machineCartId = 'caixa-smoke-maquininha';
    addCartItem({ produtoId: produto.id, quantidade: 1 }, machineCartId);
    const machineOrder = createPendingOrder({ cartId: machineCartId, metodoPagamento: 'maquininha' });

    let missingProofRejected = false;
    try {
      confirmMachinePayment(machineOrder.id, {
        confirmedBy: { id: login.usuario?.id || 'smoke-admin', role: 'admin' }
      });
    } catch (error) {
      missingProofRejected = error.status === 400;
    }
    if (!missingProofRejected) {
      throw new Error('Confirmacao da maquininha sem NSU/autorizacao deveria retornar 400.');
    }

    const confirmedMachineOrder = confirmMachinePayment(machineOrder.id, {
      nsu: 'NSU123456',
      confirmedBy: { id: login.usuario?.id || 'smoke-admin', role: 'admin' }
    });
    const persistedMachineOrder = readDb().pedidos.find((item) => item.id === machineOrder.id);
    if (confirmedMachineOrder.status !== 'Pago' ||
        persistedMachineOrder?.payment?.transactionReference !== 'NSU123456' ||
        persistedMachineOrder?.payment?.confirmedBy?.id !== (login.usuario?.id || 'smoke-admin') ||
        !persistedMachineOrder?.payment?.confirmedAt) {
      throw new Error('Confirmacao valida nao persistiu NSU, operador e horario.');
    }

    let duplicateMachineConfirmationRejected = false;
    try {
      confirmMachinePayment(machineOrder.id, {
        nsu: 'NSU123456',
        confirmedBy: { id: login.usuario?.id || 'smoke-admin', role: 'admin' }
      });
    } catch (error) {
      duplicateMachineConfirmationRejected = error.status === 409;
    }
    if (!duplicateMachineConfirmationRejected) {
      throw new Error('Confirmacao duplicada da maquininha deveria retornar 409.');
    }

    const validPayment = {
      id: 'mp-payment-1',
      external_reference: 'order-1',
      currency_id: 'BRL',
      collector_id: 'collector-1',
      transaction_amount: 25.50
    };
    const validOrder = { id: 'order-1', total: 25.50 };
    if (!validatePaymentForOrder(validPayment, validOrder, 'collector-1')) {
      throw new Error('Pagamento com pedido, valor, moeda e recebedor correspondentes deveria ser aceito.');
    }
    for (const invalidPayment of [
      { ...validPayment, transaction_amount: 25.49 },
      { ...validPayment, currency_id: 'USD' },
      { ...validPayment, collector_id: 'collector-2' },
      { ...validPayment, external_reference: 'other-order' }
    ]) {
      if (validatePaymentForOrder(invalidPayment, validOrder, 'collector-1')) {
        throw new Error('Pagamento divergente deveria ser rejeitado.');
      }
    }

    const webhookWithoutConfig = await fetch(`${baseUrl}/pagamento/webhook?data.id=987654321`, {
      method: 'POST'
    });
    if (webhookWithoutConfig.status !== 503) {
      throw new Error('Webhook sem segredo e ID do recebedor configurados deveria falhar fechado com 503.');
    }

    const ordersBeforeLegacyFinalize = readDb().pedidos.length;
    const stockBeforeLegacyFinalize = readDb().produtos.find((item) => item.id === produto.id)?.estoque;
    for (const legacyCartId of ['caixa-smoke-public-finalizar', 'online-smoke-public-finalizar']) {
      addCartItem({ produtoId: produto.id, quantidade: 1 }, legacyCartId);
      const legacyFinalize = await fetch(`${baseUrl}/finalizar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-cart-id': legacyCartId },
        body: JSON.stringify({ payments: [{ method: 'pix', amount: 1.5 }] })
      });
      if (legacyFinalize.status !== 410) {
        throw new Error(`Endpoint legado de finalizacao deveria retornar 410, recebeu ${legacyFinalize.status}.`);
      }
    }
    if (readDb().pedidos.length !== ordersBeforeLegacyFinalize ||
        readDb().produtos.find((item) => item.id === produto.id)?.estoque !== stockBeforeLegacyFinalize) {
      throw new Error('Endpoint legado de finalizacao alterou pedidos ou estoque.');
    }

    const idProbeOrderA = createOperationalOrder({
      businessProfile: 'padaria',
      items: [{ produtoId: produto.id, quantidade: 1 }]
    });
    const idProbeOrderB = createOperationalOrder({
      businessProfile: 'padaria',
      items: [{ produtoId: produto.id, quantidade: 1 }]
    });
    if (!idProbeOrderA?.id || !idProbeOrderB?.id || idProbeOrderA.id === idProbeOrderB.id) {
      throw new Error('Pedidos operacionais distintos geraram IDs iguais.');
    }

    const produtosPadaria = await request('/produtos?businessProfile=padaria');
    if (!Array.isArray(produtosPadaria) || !produtosPadaria.some((item) => item.id === produto.id)) {
      throw new Error('Produto de padaria nao apareceu na listagem filtrada.');
    }

    const operacaoConfig = await request('/operacao/config?profile=padaria');
    if (operacaoConfig?.businessProfile !== 'padaria') {
      throw new Error('Config operacional de padaria nao retornou o profile esperado.');
    }

    const operationalOrdersBeforeInvalidItems = readDb().pedidos.length;
    for (const invalidItems of [
      [{ produtoId: produto.id, quantidade: 0 }],
      [{ produtoId: 'produto-inexistente-smoke', quantidade: 1 }],
      [null]
    ]) {
      const invalidOperationalOrder = await fetch(`${baseUrl}/operacao/pedidos`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          businessProfile: 'padaria',
          tableId: 'BALCAO-INVALIDO',
          items: invalidItems
        })
      });
      if (invalidOperationalOrder.status !== 400) {
        throw new Error(`Item operacional invalido deveria retornar 400, recebeu ${invalidOperationalOrder.status}.`);
      }
    }
    if (readDb().pedidos.length !== operationalOrdersBeforeInvalidItems) {
      throw new Error('Itens operacionais invalidos criaram pedidos indevidos.');
    }

    const pedido = await request('/operacao/pedidos', {
      method: 'POST',
      token,
      body: {
        businessProfile: 'padaria',
        tableId: 'BALCAO-1',
        operator: 'Smoke QA',
        items: [
          {
            produtoId: produto.id,
            quantidade: 2,
            preco: 0.01
          }
        ]
      }
    });
    if (pedido?.itens?.[0]?.preco !== 1.5 || pedido?.subtotal !== 3) {
      throw new Error('Pedido operacional aceitou preco adulterado enviado pelo cliente.');
    }

    const kitchenToken = createAuthToken({
      user: { id: 'smoke-kitchen-user', nome: 'Smoke Kitchen', email: 'kitchen@example.test', role: 'cozinha' }
    }, 60 * 60 * 1000);
    const kitchenSettlement = await fetch(`${baseUrl}/operacao/pedidos/${pedido.id}/fechar`, {
      method: 'POST',
      headers: { authorization: `Bearer ${kitchenToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ payments: [{ method: 'cash', amount: pedido.total }] })
    });
    if (kitchenSettlement.status !== 403) {
      throw new Error(`Usuario de cozinha nao pode liquidar pedido; esperado 403, recebido ${kitchenSettlement.status}.`);
    }

    const fila = await request('/operacao/producao?profile=padaria', {
      token
    });
    if (!Array.isArray(fila) || !fila.some((item) => item.id === pedido.id)) {
      throw new Error('Pedido operacional nao apareceu na fila de producao.');
    }

    const preparo = await request(`/operacao/pedidos/${pedido.id}/producao-status`, {
      method: 'PATCH',
      token,
      body: {
        status: 'Em preparo'
      }
    });
    if (preparo?.status !== 'Em preparo') {
      throw new Error('Atualizacao de producao nao retornou status esperado.');
    }

    const stockBeforeInvalidSettlement = readDb().produtos.find((item) => item.id === produto.id)?.estoque;
    for (const invalidBody of [
      {},
      { discountAmount: 999, payments: [{ method: 'pix', amount: 3 }] },
      { discountAmount: 0, payments: [{ method: 'pix', amount: 2 }] },
      { discountAmount: 0, payments: [{ method: 'unknown-method', amount: 3 }] },
      { discountAmount: 0, payments: [{ method: 'pix', amount: 'not-a-number' }] },
      { discountAmount: 0, payments: [{ method: 'cash', amount: 3, amountReceived: 2 }] },
      { discountAmount: 0, payments: [{ method: 'cash', amount: 3, amountReceived: 5, changeAmount: 1 }] }
    ]) {
      const rejectedSettlement = await fetch(`${baseUrl}/operacao/pedidos/${pedido.id}/fechar`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(invalidBody)
      });
      if (rejectedSettlement.status !== 400) {
        throw new Error(`Fechamento operacional invalido deveria retornar 400, recebeu ${rejectedSettlement.status}.`);
      }
    }
    const orderAfterRejectedSettlements = readDb().pedidos.find((item) => item.id === pedido.id);
    const stockAfterRejectedSettlement = readDb().produtos.find((item) => item.id === produto.id)?.estoque;
    if (orderAfterRejectedSettlements?.status !== 'Em preparo' ||
        stockAfterRejectedSettlement !== stockBeforeInvalidSettlement) {
      throw new Error('Tentativa de fechamento invalida alterou pedido ou estoque.');
    }

    const fechado = await request(`/operacao/pedidos/${pedido.id}/fechar`, {
      method: 'POST',
      token,
      body: {
        discountAmount: 0,
        payments: [
          {
            method: 'pix',
            amount: 3
          }
        ]
      }
    });
    if (fechado?.status !== 'Pago' || fechado?.payment?.totalPaid !== 3 ||
        fechado?.payment?.entries?.length !== 1) {
      throw new Error('Fechamento operacional valido nao reconciliou pagamento.');
    }
    const stockAfterValidSettlement = readDb().produtos.find((item) => item.id === produto.id)?.estoque;
    if (stockAfterValidSettlement !== stockBeforeInvalidSettlement - 2) {
      throw new Error('Fechamento valido nao baixou o estoque exatamente pela quantidade vendida.');
    }

    const repeatedClose = await request(`/operacao/pedidos/${pedido.id}/fechar`, {
      method: 'POST',
      token,
      body: {
        discountAmount: 0,
        payments: [{ method: 'pix', amount: 3 }]
      }
    });
    const stockAfterRepeatedClose = readDb().produtos.find((item) => item.id === produto.id)?.estoque;
    if (repeatedClose?.status !== 'Pago' || stockAfterRepeatedClose !== stockAfterValidSettlement ||
        repeatedClose?.payment?.totalPaid !== 3) {
      throw new Error('Fechamento repetido alterou novamente o estoque ou os dados do pagamento.');
    }

    console.log('Smoke QA ok: auth, payments, catalogo, estoque, producao, pedidos e recuperacao validados.');
  } finally {
    if (!server.killed) {
      server.kill('SIGTERM');
    }
    await sleep(500);
    if (!server.killed) {
      server.kill('SIGKILL');
    }
    restoreDatabase();
    if (stderr.trim()) {
      process.stderr.write(stderr);
    }
    if (stdout.trim()) {
      process.stdout.write(stdout);
    }
  }
}

main().catch((error) => {
  restoreDatabase();
  console.error(error.message || error);
  process.exitCode = 1;
});
