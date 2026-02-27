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

export async function createPreference({ order }) {
  ensureToken();

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
