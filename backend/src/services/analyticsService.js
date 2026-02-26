import { readDb } from '../data/repository.js';

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfWeek() {
  const now = new Date();
  const day = now.getDay();
  const diff = (day + 6) % 7;
  const start = new Date(now);
  start.setDate(now.getDate() - diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function startOfYear() {
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1);
}

function getPeriodStart(periodo) {
  switch (periodo) {
    case 'dia': return startOfToday();
    case 'semana': return startOfWeek();
    case 'mes': return startOfMonth();
    case 'ano': return startOfYear();
    default: return new Date(0);
  }
}

function inPeriod(dateValue, start) {
  return new Date(dateValue) >= start;
}

function formatDate(dateValue) {
  const d = new Date(dateValue);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function isPaidStatus(status) {
  return ['Pago', 'Finalizado', 'Em preparo', 'Saiu para entrega'].includes(String(status || ''));
}

export function getAnalyticsSummary(periodo = 'mes') {
  const db = readDb();
  const start = getPeriodStart(periodo);

  const pedidos = (db.pedidos || []).filter((p) => inPeriod(p.createdAt, start) && isPaidStatus(p.status));
  const saidas = (db.saidas || []).filter((s) => inPeriod(s.data, start));

  const entradaBruta = pedidos.reduce((sum, p) => sum + Number(p.subtotal || 0), 0);
  const descontos = pedidos.reduce((sum, p) => sum + Number(p.desconto || 0), 0);
  const entradaProdutos = pedidos.reduce((sum, p) => sum + Number(p.totalBase ?? (Number(p.subtotal || 0) - Number(p.desconto || 0))), 0);
  const freteTotal = pedidos.reduce((sum, p) => sum + Number(p.frete || 0), 0);
  const entradaLiquida = pedidos.reduce((sum, p) => sum + Number(p.total || 0), 0);
  const saidaTotal = saidas.reduce((sum, s) => sum + Number(s.valor || 0), 0);
  const lucro = entradaLiquida - saidaTotal;
  const ticketMedio = pedidos.length ? entradaLiquida / pedidos.length : 0;

  return {
    periodo,
    pedidos: pedidos.length,
    entradaBruta,
    descontos,
    entradaProdutos,
    freteTotal,
    entradaLiquida,
    saidaTotal,
    lucro,
    ticketMedio
  };
}

export function getAnalyticsOverview() {
  return {
    dia: getAnalyticsSummary('dia'),
    semana: getAnalyticsSummary('semana'),
    mes: getAnalyticsSummary('mes'),
    ano: getAnalyticsSummary('ano')
  };
}

export function getAnalyticsSeries(periodo = 'mes') {
  const db = readDb();
  const start = getPeriodStart(periodo);

  const map = new Map();
  const push = (label, key, value) => {
    if (!map.has(label)) {
      map.set(label, { label, entrada: 0, saida: 0, frete: 0, lucro: 0 });
    }
    const row = map.get(label);
    row[key] += Number(value || 0);
    row.lucro = row.entrada - row.saida;
  };

  (db.pedidos || []).filter((p) => inPeriod(p.createdAt, start) && isPaidStatus(p.status)).forEach((p) => {
    push(formatDate(p.createdAt), 'entrada', Number(p.total || 0));
    push(formatDate(p.createdAt), 'frete', Number(p.frete || 0));
  });

  (db.saidas || []).filter((s) => inPeriod(s.data, start)).forEach((s) => {
    push(formatDate(s.data), 'saida', Number(s.valor || 0));
  });

  return Array.from(map.values()).sort((a, b) => {
    const [da, ma] = a.label.split('/').map(Number);
    const [dbb, mb] = b.label.split('/').map(Number);
    return (ma - mb) || (da - dbb);
  });
}

export function getTopProdutos(periodo = 'mes') {
  const db = readDb();
  const start = getPeriodStart(periodo);
  const agg = new Map();

  (db.pedidos || []).filter((p) => inPeriod(p.createdAt, start) && isPaidStatus(p.status)).forEach((pedido) => {
    (pedido.itens || []).forEach((item) => {
      const key = item.produto;
      if (!agg.has(key)) {
        agg.set(key, { produto: key, quantidade: 0, faturamento: 0, unidade: item.unidade || '' });
      }
      const row = agg.get(key);
      row.quantidade += Number(item.quantidade || 0);
      row.faturamento += Number(item.quantidade || 0) * Number(item.preco || 0);
    });
  });

  return Array.from(agg.values())
    .sort((a, b) => b.faturamento - a.faturamento)
    .slice(0, 10);
}
