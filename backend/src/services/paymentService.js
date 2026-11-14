import crypto from 'crypto';
import { FRONTEND_URL, MP_ACCESS_TOKEN, MP_WEBHOOK_URL } from '../config/env.js';

const BASE_URL = 'https://api.mercadopago.com';

function ensureToken() {
  if (!MP_ACCESS_TOKEN) {
    const err = new Error('MP_ACCESS_TOKEN nao configurado.');
    err.status = 500;
    throw err;
  }
}

function buildBackUrls() {
  if (!FRONTEND_URL) return null;
  const base = FRONTEND_URL.replace(/\/+$/, '');
  return {
    success: `${base}/Pagamento.html?status=approved`,
    pending: `${base}/Pagamento.html?status=pending`,
    failure: `${base}/Pagamento.html?status=failed`
  };
}

export async function createPreference({ order, metodoPreferido = '' }) {
  ensureToken();
  const metodo = String(metodoPreferido || '').toLowerCase();

  const backUrls = buildBackUrls();
  const payload = {
    items: [
      {
        title: `Pedido ${order.id}`,
        quantity: 1,
        unit_price: Number(order.total || 0),
        currency_id: 'BRL'
      }
    ],
    external_reference: order.id
  };

  if (metodo === 'pix') {
    payload.payment_methods = {
      excluded_payment_types: [{ id: 'credit_card' }, { id: 'debit_card' }, { id: 'ticket' }],
      installments: 1
    };
  } else if (metodo === 'credito') {
    payload.payment_methods = {
      excluded_payment_types: [{ id: 'debit_card' }, { id: 'ticket' }, { id: 'bank_transfer' }, { id: 'atm' }]
    };
  } else if (metodo === 'debito') {
    payload.payment_methods = {
      excluded_payment_types: [{ id: 'credit_card' }, { id: 'ticket' }, { id: 'bank_transfer' }, { id: 'atm' }]
    };
  }

  if (backUrls) {
    payload.back_urls = backUrls;
    payload.auto_return = 'approved';
  }

  if (MP_WEBHOOK_URL) {
    payload.notification_url = MP_WEBHOOK_URL;
  }

  const res = await fetch(`${BASE_URL}/checkout/preferences`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || 'Erro ao criar preferencia no Mercado Pago.');
    err.status = res.status;
    throw err;
  }

  return data;
}

export async function getPayment(paymentId) {
  ensureToken();
  const res = await fetch(`${BASE_URL}/v1/payments/${paymentId}`, {
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || 'Erro ao consultar pagamento.');
    err.status = res.status;
    throw err;
  }
  return data;
}


export function verifyWebhookSignature({ xSignature = '', xRequestId = '', dataId = '', secret = '' } = {}) {
  if (!secret || !xSignature || !xRequestId || !dataId) return false;

  const fields = Object.fromEntries(
    String(xSignature).split(',').map((part) => {
      const separator = part.indexOf('=');
      if (separator < 0) return ['', ''];
      return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    }).filter(([key, value]) => key && value)
  );
  const timestamp = fields.ts;
  const receivedSignature = fields.v1;
  if (!/^\d+$/.test(timestamp || '') || !/^[a-f0-9]{64}$/i.test(receivedSignature || '')) {
    return false;
  }

  const manifest = `id:${String(dataId).toLowerCase()};request-id:${String(xRequestId)};ts:${timestamp};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest();
  const received = Buffer.from(receivedSignature, 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

export function validatePaymentForOrder(payment, order, expectedCollectorId) {
  if (!payment || !order || !expectedCollectorId) return false;
  if (String(payment.id || '') !== String(payment.id || '').trim() || !String(payment.id || '').trim()) return false;
  if (String(payment.external_reference || '') !== String(order.id || '')) return false;
  if (String(payment.currency_id || '') !== 'BRL') return false;
  if (String(payment.collector_id || '') !== String(expectedCollectorId)) return false;

  const paid = Number(payment.transaction_amount);
  const due = Number(order.total);
  if (!Number.isFinite(paid) || !Number.isFinite(due) || Math.abs(paid - due) > 0.01) return false;
  return true;
}
