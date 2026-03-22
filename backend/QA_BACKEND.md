# QA Backend Varejao

## Scripts

- `npm run check`
  - valida sintaxe dos arquivos principais do backend
- `npm run smoke`
  - sobe o backend em porta temporaria
  - faz login admin
  - valida regra estrita de farmacia
  - cadastra produto de padaria
  - cria pedido operacional
  - atualiza producao
  - fecha o pedido
  - restaura o `database.json` ao final
- `npm run qa`
  - executa `check` + `smoke`

## Producao

Para evitar usuarios operacionais demo em ambiente real, defina:

```env
DISABLE_DEMO_OPERATIONAL_USERS=true
```

Se quiser trocar a senha padrao dos seeds operacionais em ambiente de teste:

```env
DEMO_OPERATIONAL_PASSWORD=sua-senha-aqui
```

## Observacao

O smoke test trabalha sobre uma copia temporaria do `src/data/database.json` e restaura o arquivo ao final.
