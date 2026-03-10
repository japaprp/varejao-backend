function normalizeCartId(value = '') {
  const raw = String(value || '').trim();
  return raw || 'default';
}

const checkoutStreams = new Map();
const adminStreams = new Set();

function getCheckoutBucket(cartId) {
  const key = normalizeCartId(cartId);
  if (!checkoutStreams.has(key)) {
    checkoutStreams.set(key, new Set());
  }
  return checkoutStreams.get(key);
}

function writeSse(res, eventName, payload = {}) {
  if (!res || res.writableEnded || res.destroyed) {
    return false;
  }

  try {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function cleanupAdminStream(res) {
  adminStreams.delete(res);
}

export function registerCheckoutStream(cartId, res) {
  const key = normalizeCartId(cartId);
  const bucket = getCheckoutBucket(key);
  bucket.add(res);

  const heartbeat = setInterval(() => {
    const ok = writeSse(res, 'ping', {
      cartId: key,
      ts: new Date().toISOString(),
    });

    if (!ok) {
      clearInterval(heartbeat);
      bucket.delete(res);
      if (bucket.size === 0) {
        checkoutStreams.delete(key);
      }
    }
  }, 25000);

  const cleanup = () => {
    clearInterval(heartbeat);
    bucket.delete(res);
    if (bucket.size === 0) {
      checkoutStreams.delete(key);
    }
  };

  return { cartId: key, cleanup };
}

export function registerAdminStream(res) {
  adminStreams.add(res);

  const heartbeat = setInterval(() => {
    const ok = writeSse(res, 'ping', {
      ts: new Date().toISOString(),
    });

    if (!ok) {
      clearInterval(heartbeat);
      cleanupAdminStream(res);
    }
  }, 25000);

  const cleanup = () => {
    clearInterval(heartbeat);
    cleanupAdminStream(res);
  };

  return { cleanup };
}

export function publishCheckoutUpdate(cartId, payload = {}) {
  const key = normalizeCartId(cartId);
  const bucket = checkoutStreams.get(key);
  if (!bucket || bucket.size === 0) {
    return 0;
  }

  let sent = 0;
  for (const res of bucket) {
    const ok = writeSse(res, 'checkout_update', {
      cartId: key,
      updatedAt: new Date().toISOString(),
      ...payload,
    });

    if (!ok) {
      bucket.delete(res);
      continue;
    }

    sent += 1;
  }

  if (bucket.size === 0) {
    checkoutStreams.delete(key);
  }

  return sent;
}

export function publishAdminUpdate(payload = {}) {
  if (adminStreams.size === 0) {
    return 0;
  }

  let sent = 0;
  for (const res of adminStreams) {
    const ok = writeSse(res, 'operacao_update', {
      updatedAt: new Date().toISOString(),
      ...payload,
    });

    if (!ok) {
      cleanupAdminStream(res);
      continue;
    }

    sent += 1;
  }

  return sent;
}
