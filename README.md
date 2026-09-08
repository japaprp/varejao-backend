# Varejao do Povo

Sistema de compras online com front-end HTML/CSS/JS e back-end Node.js/Express.

O projeto nasceu para uma operacao real de varejo e deve ser tratado como **produto de comercio/PDV**, nao como uma demo.

## Capacidades ja estruturadas

- loja online
- carrinho e checkout
- pagamentos Mercado Pago
- login social
- painel administrativo
- operacao integrada entre site/app/backend
- atualizacao em tempo real via SSE
- fallback por polling
- operacao unificada de carrinho/pedido/estoque/financeiro

---

# Roadmap para voltar a producao real

> **Regra:** nao apresentar uma funcionalidade como pronta se ela ainda estiver apenas planejada. O objetivo e ter uma base reutilizavel e confiavel para outros comercios, mesmo que o Varejao original nao exista mais.

## 1. Fluxo comercial completo

- [ ] Validar ponta a ponta: catalogo -> carrinho -> checkout -> pagamento -> pedido -> separacao -> entrega/retirada -> finalizacao
- [ ] Validar fluxo de cancelamento
- [ ] Validar reembolso/estorno
- [ ] Validar divergencia de estoque
- [ ] Validar pedido simultaneo em web/app/PDV
- [ ] Validar recuperacao de sessao/carrinho

## 2. PDV e operacao de loja

- [ ] Fechamento de caixa confiavel
- [ ] Sangria/suprimento
- [ ] Conciliacao de vendas
- [ ] Controle de operadores/permissoes
- [ ] Impressao/comprovante quando aplicavel
- [ ] Tratamento de queda de internet
- [ ] Operacao resiliente quando SSE cair

## 3. Estoque

- [ ] Movimentacoes consistentes
- [ ] Reserva de estoque no checkout quando necessario
- [ ] Concorrencia na baixa
- [ ] Reversao de estoque em cancelamentos
- [ ] Alertas de estoque minimo
- [ ] Auditoria de alteracoes

## 4. Pagamentos

- [ ] Validar credenciais e configuracao de producao
- [ ] Testar webhook repetido/atrasado/fora de ordem
- [ ] Idempotencia
- [ ] Pagamento aprovado/recusado/expirado/cancelado/estornado
- [ ] Reconciliacao gateway x pedido x caixa
- [ ] Monitoramento de falhas
- [ ] Nunca armazenar dados sensiveis de cartao fora do fluxo permitido pelo provedor

## 5. Seguranca

- [ ] Auditoria de autenticacao e autorizacao
- [ ] Revisar sessoes/tokens
- [ ] Testar IDOR/BOLA
- [ ] Revisar CORS
- [ ] Revisar XSS, SQL injection e validacao de entradas
- [ ] Rate limiting
- [ ] Protecao dos endpoints administrativos
- [ ] Webhook com autenticacao/validacao adequada
- [ ] Segredos somente em variaveis de ambiente
- [ ] Remover credenciais de demonstracao antes de qualquer uso publico
- [ ] Logs sem tokens, senhas ou PII desnecessaria

## 6. Tempo real e resiliencia

- [ ] Testar reconexao SSE
- [ ] Garantir fallback de polling sem duplicar eventos
- [ ] Evitar perda de atualizacao durante reconexao
- [ ] Idempotencia dos eventos
- [ ] Testar varios clientes conectados simultaneamente
- [ ] Limites de conexoes
- [ ] Health check do stream

## 7. Performance e escala

- [ ] Medir latencia dos endpoints criticos
- [ ] Revisar consultas e indices do banco
- [ ] Teste de carga
- [ ] Testar simultaneidade de checkout/pedidos
- [ ] Testar numero realista de conexoes SSE
- [ ] Cache onde houver beneficio
- [ ] Definir limites de payload e paginação

## 8. Observabilidade

- [ ] Logs estruturados
- [ ] Correlacao por pedido/sessao
- [ ] Health check
- [ ] Monitoramento de erros
- [ ] Metricas de pedidos/pagamentos/estoque
- [ ] Alertas de falha de webhook
- [ ] Alertas de indisponibilidade

## 9. Backup e recuperacao

- [ ] Backup automatico do banco
- [ ] Testar restauracao
- [ ] Politica de retencao
- [ ] Rollback documentado
- [ ] Procedimento de contingencia

## 10. UX

- [ ] Loading/erro/vazio/sucesso em todos os fluxos
- [ ] Checkout claro
- [ ] Feedback imediato de pagamento
- [ ] Fluxo de operador simples
- [ ] Responsividade
- [ ] Acessibilidade basica
- [ ] Teste pratico com usuario real

## 11. Produto reutilizavel

- [ ] Separar configuracoes do negocio do codigo
- [ ] Catalogo e identidade visual configuraveis
- [ ] Preparar base para outros varejistas
- [ ] Documentar instalacao e configuracao
- [ ] Checklist de go-live
- [ ] Documentar suporte e manutencao

## Criterio de pronto

O sistema deve ser capaz de operar um comercio real de ponta a ponta com integridade de pedidos, pagamentos e estoque. O fato de uma tela existir nao significa que o modulo esteja pronto para venda.

---

# Deploy gratuito no Render (backend)

1. Suba este projeto no GitHub.
2. Crie um Web Service no Render.
3. Configure Root Directory `backend`, Runtime `Node`, Build `npm install` e Start `npm start`.
4. Configure as variaveis de ambiente necessarias, sem colocar segredos no repositorio.

## Variaveis principais

- `MP_ACCESS_TOKEN`
- `MP_PUBLIC_KEY`
- `FRONTEND_URL`
- `MP_WEBHOOK_URL`
- `CORS_ALLOWED_ORIGINS`
- `GOOGLE_CLIENT_ID`
- `FACEBOOK_APP_ID`
- `FACEBOOK_APP_SECRET`
- `TOKEN_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

## Checkout em tempo real

A tela `Pagamento.html` utiliza SSE em `GET /stream/checkout` com fallback automatico por polling.

## Operacao unificada

O `admin.html` recebe atualizacoes de operacao em tempo real por SSE com fallback por polling.

## Regra de continuidade

Prioridade ao retomar o projeto:

**seguranca -> integridade de pedidos/pagamentos/estoque -> resiliencia -> testes -> performance -> observabilidade -> UX -> produto comercial.**
