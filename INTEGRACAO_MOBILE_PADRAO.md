# Padrao de Integracao Mobile (Leitor + Varejao)

Este documento define o contrato minimo para plugar o app mobile no backend sem erro de integracao.

## 1) Conceito de sessao (`cartId`)

Use sempre um `cartId` fixo por contexto operacional:

`web-01` = compras online (site)
`caixa-01` = loja fisica / operador de caixa
`caixa-02` = outro caixa fisico
`mesa-03` = fluxo fisico (mesa/comanda)

Regra do backend:

Se `cartId` contiver `caixa|pdv|balcao|fisic|sessao|session|mesa|comanda`, o canal vira `fisico`.
Caso contrario, o canal vira `online`.

## 2) Header padrao

Envie em todas as chamadas de carrinho/checkout/pagamento:

```http
X-Cart-Id: caixa-01
Content-Type: application/json
```

## 3) Ordem oficial de chamadas (Scanner de produtos)

1. Ler codigo de barras/QR no app.
2. Buscar produto.
3. Adicionar item no carrinho da sessao.
4. Recarregar checkout da mesma sessao.
5. Iniciar pagamento conforme canal.

## 4) Busca de produto (recomendado)

### 4.1 Por codigo de barras

```http
GET /produtos?barcode=7898632473278
```

### 4.2 Fallback por QR Code

```http
GET /produtos?qr=QR-CODIGO-EXEMPLO
```

### 4.3 Fallback por busca geral

```http
GET /produtos?q=banana
```

Resposta: lista de produtos. No app, use o primeiro item valido.

Campos relevantes do produto:

`id`, `nome`, `preco`, `unidade`, `estoque`, `codigoBarras`, `qrCode`, `imagem`

## 5) Adicionar item no carrinho

```http
POST /carrinho
X-Cart-Id: caixa-01
Content-Type: application/json

{
  "produtoId": "p001",
  "quantidade": 1
}
```

Resposta esperada:

```json
{ "sucesso": true }
```

Observacao:

Se o item ja existir no carrinho da sessao, o backend soma a quantidade automaticamente.

## 6) Ler resumo para mostrar no app/caixa

```http
GET /checkout
X-Cart-Id: caixa-01
```

Resposta exemplo:

```json
{
  "itens": [
    {
      "produtoId": "p001",
      "produto": "Banana Nanica",
      "unidade": "kg",
      "preco": 8.99,
      "quantidade": 1
    }
  ],
  "subtotal": 8.99,
  "desconto": 0,
  "totalBase": 8.99,
  "frete": 30,
  "total": 38.99,
  "cupomAplicado": null,
  "cartId": "caixa-01",
  "canal": "fisico"
}
```

## 7) Pagamento fisico (maquininha)

### 7.1 Criar pedido pendente

```http
POST /pagamento/maquininha/iniciar
X-Cart-Id: caixa-01
Content-Type: application/json

{
  "cpf": "12345678901",
  "nomeCliente": "Cliente Balcao",
  "cupom": ""
}
```

Resposta:

`orderId`, `status`, `total`, `subtotal`, `frete`, `desconto`, `cartId`, `canal`

### 7.2 Confirmar aprovacao da maquininha

```http
POST /pagamento/maquininha/confirmar
Content-Type: application/json

{
  "orderId": "ped_1741511111111",
  "nsu": "123456"
}
```

Ao confirmar, o pedido vira pago e o estoque e baixado.

## 8) Pagamento online (Mercado Pago)

### 8.1 Criar preferencia

```http
POST /pagamento/preferencia
X-Cart-Id: web-01
Content-Type: application/json

{
  "cpf": "12345678901",
  "nomeCliente": "Cliente Online",
  "cupom": "",
  "metodoPreferido": "pix"
}
```

Resposta:

`preferenceId`, `initPoint`, `sandboxInitPoint`, `orderId`

### 8.2 Redirecionar cliente para `initPoint`

A confirmacao final vem por webhook do pagamento.

## 9) Finalizacao direta (modo simples / fallback)

```http
POST /finalizar
X-Cart-Id: caixa-01
Content-Type: application/json

{
  "cpf": "12345678901",
  "nomeCliente": "Cliente",
  "cupom": ""
}
```

Use apenas quando nao houver fluxo por gateway/maquininha.

## 10) Erros comuns e tratamento no app

`400` = dados invalidos, carrinho vazio, estoque insuficiente
`404` = produto nao encontrado
`409` = codigo de barras/QR duplicado no cadastro
`500` = indisponibilidade temporaria

Padrao no app:

1. Exibir mensagem objetiva.
2. Manter fila local da leitura para retry.
3. Reenviar quando rede/API voltar.

## 11) Payload padrao recomendado no app mobile

Modelo interno de item:

```json
{
  "local_id": "scan_20260310_001",
  "barcode": "7898632473278",
  "qr_code": "",
  "product_id": "p001",
  "name": "Banana Nanica",
  "unit_price": 8.99,
  "unit": "kg",
  "quantity": 1,
  "subtotal": 8.99,
  "scanned_at": "2026-03-10T18:10:00Z",
  "operator_id": "op-01",
  "cart_id": "caixa-01"
}
```

Esse modelo deve ser convertido para as chamadas oficiais do backend (`/carrinho`, `/checkout`, `/pagamento/...`).

## 12) Checklist rapido para nao quebrar integracao

1. Usar o mesmo `cartId` no app e na pagina web.
2. Nao misturar `web-*` com `caixa-*` para a mesma operacao.
3. Confirmar pagamento da maquininha para baixar estoque.
4. Tratar offline com fila local.
5. Sempre reler `/checkout` apos cada leitura.
