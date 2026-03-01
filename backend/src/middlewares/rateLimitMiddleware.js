const buckets = new Map();

function getIp(req) {
  return req.headers['x-forwarded-for']?.toString().split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
}

export function createRateLimiter({ keyPrefix, windowMs, max, message }) {
  return (req, res, next) => {
    const ip = getIp(req);
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const entry = buckets.get(key);

    if (!entry || now > entry.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= max) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(Math.max(1, retryAfterSec)));
      return res.status(429).json({
        erro: message || 'Muitas tentativas. Tente novamente em instantes.',
        retryAfterSec: Math.max(1, retryAfterSec)
      });
    }

    entry.count += 1;
    return next();
  };
}

export const authLimiter = createRateLimiter({
  keyPrefix: 'auth',
  windowMs: 5 * 60 * 1000,
  max: 20,
  message: 'Muitas tentativas de autenticacao. Aguarde e tente novamente.'
});

export const paymentLimiter = createRateLimiter({
  keyPrefix: 'payment',
  windowMs: 5 * 60 * 1000,
  max: 40,
  message: 'Muitas requisicoes de pagamento. Aguarde e tente novamente.'
});
