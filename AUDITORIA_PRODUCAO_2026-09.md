# Auditoria de Producao — Setembro/2026

## Bloqueadores encontrados

### V1 — Persistencia principal em arquivo JSON
- Arquivos: `backend/src/data/repository.js` e `backend/src/data/database.json`
- `readDb()` carrega o banco inteiro para memoria e `writeDb()` regrava o arquivo inteiro com `writeFileSync`.
- Em dois processos/requisicoes concorrentes, uma escrita pode sobrescrever a outra. Falha de processo durante escrita tambem pode corromper o arquivo.
- Isso impede considerar o backend atual como base segura para operacao comercial concorrente.
- Correcao: migrar estado transacional para MySQL/PostgreSQL com transacoes, constraints e locks.

### V2 — Endpoint de confirmacao de maquininha nao exige autenticacao
- Arquivos: `storeRoutes.js` + `storeController.js`
- A rota `/pagamento/maquininha/confirmar` usa apenas o limiter de pagamento; nao aplica `requireAuth` nem papel operacional.
- O controlador aceita `orderId` e confirma o pagamento.
- Isso e risco direto de fraude/fechamento indevido de pedido.
- Correcao: exigir autenticacao, papel operacional e validar sessao/caixa/operador/pedido.

### V3 — Recuperacao de senha permite trocar senha sem prova de posse
- Arquivo: `backend/src/services/authService.js`
- `forgotPassword()` recebe email e `novaSenha`; se o email existir, grava a nova senha diretamente.
- Nao ha token de recuperacao no fluxo auditado.
- Isso caracteriza potencial tomada de conta por conhecimento do email.
- Correcao: fluxo de reset com token aleatorio, expiracao, uso unico e rate limit.

### V4 — CORS aceita subdominios amplos
- Arquivo: `backend/src/app.js`
- O servidor aceita qualquer origem `*.onrender.com` e qualquer `*.github.io`.
- A regra deve ser uma allowlist das origens realmente utilizadas.

### V5 — Corpo JSON sem limite explicito
- Arquivo: `backend/src/app.js`
- `express.json()` e usado sem `limit` configurado.
- Requisicoes grandes podem consumir memoria desnecessariamente.
- Correcao: limite por endpoint/perfil de payload.

### V6 — Persistencia e rate limit sao locais ao processo
- Arquivo: `rateLimitMiddleware.js`
- Buckets ficam em `Map` de memoria; em multiplas instancias cada instancia possui contador diferente.
- O mesmo vale para o estado JSON local.
- Correcao: Redis ou mecanismo compartilhado para rate limit e estado transacional em banco.

## Pontos positivos confirmados

- Middleware de autenticacao e RBAC existe.
- Operacao administrativa tem varias rotas protegidas.
- Existem SSE e fallback por polling.
- Validacao de payload e upload middleware existem.
- Credenciais principais sao configuradas por ambiente.

## Prioridade

1. Retirar confirmacao de maquininha da superficie publica
2. Corrigir reset de senha
3. Migrar persistencia JSON para banco transacional
4. Corrigir CORS
5. Limitar payloads
6. Redis para rate limit/estado compartilhado
7. Testes de concorrencia em estoque, checkout e pagamento
