import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { confirmMachinePayment } from '../src/services/cartService.js';

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
  backupDatabase();

  const server = spawn(process.execPath, ['index.js'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      PORT: String(port),
      ADMIN_EMAIL: process.env.SMOKE_ADMIN_EMAIL || 'admin@varejao.com',
      ADMIN_PASSWORD: process.env.SMOKE_ADMIN_PASSWORD || 'admin123456',
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
        senha: process.env.SMOKE_ADMIN_PASSWORD || 'admin123456'
      }
    });
    const token = String(login?.token || '');
    if (!token) {
      throw new Error('Login smoke nao retornou token.');
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

    const produtosPadaria = await request('/produtos?businessProfile=padaria');
    if (!Array.isArray(produtosPadaria) || !produtosPadaria.some((item) => item.id === produto.id)) {
      throw new Error('Produto de padaria nao apareceu na listagem filtrada.');
    }

    const operacaoConfig = await request('/operacao/config?profile=padaria');
    if (operacaoConfig?.businessProfile !== 'padaria') {
      throw new Error('Config operacional de padaria nao retornou o profile esperado.');
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
            quantidade: 2
          }
        ]
      }
    });

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
    if (fechado?.status !== 'Pago') {
      throw new Error('Fechamento operacional nao concluiu como Pago.');
    }

    console.log('Smoke QA ok: auth, catalogo, producao e fechamento operacional validados.');
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
