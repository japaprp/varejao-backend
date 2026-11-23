import { isIP } from 'node:net';

const DEFAULT_MAX_ENTRIES = 10000;

/**
 * Render terminates inbound TLS through its edge/load balancer and documents
 * X-Forwarded-For as the client-IP source. Do not enable Express trust proxy
 * with an assumed hop count for this service.
 */
export function getClientIp(req) {
  const forwardedFor = req.headers?.['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.length <= 1024) {
    const candidate = forwardedFor.split(',')[0].trim();
    if (isIP(candidate)) return candidate;
  }

  const remoteAddress = req.socket?.remoteAddress;
  if (typeof remoteAddress === 'string' && isIP(remoteAddress)) {
    return remoteAddress;
  }

  return 'unknown';
}

export function createRateLimiter({
  keyPrefix,
  windowMs,
  max,
  message,
  maxEntries = DEFAULT_MAX_ENTRIES,
  clock = () => Date.now()
}) {
  const buckets = new Map();
  const capacity = Number.isSafeInteger(maxEntries) && maxEntries > 0
    ? maxEntries
    : DEFAULT_MAX_ENTRIES;

  return (req, res, next) => {
    const ip = getClientIp(req);
    const key = `${keyPrefix}:${ip}`;
    const now = clock();
    const entry = buckets.get(key);

    if (entry && now < entry.resetAt) {
      if (entry.count >= max) {
        const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
        res.setHeader('Retry-After', String(retryAfterSec));
        return res.status(429).json({
          erro: message || 'Muitas tentativas. Tente novamente em instantes.',
          retryAfterSec
        });
      }

      entry.count += 1;
      return next();
    }

    // Remove expired entries before allocating a new bucket. This bounds
    // memory even if callers rotate source addresses.
    for (const [bucketKey, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(bucketKey);
    }

    if (!buckets.has(key) && buckets.size >= capacity) {
      const nearestExpiry = Math.min(...Array.from(buckets.values(), (bucket) => bucket.resetAt));
      const retryAfterSec = Number.isFinite(nearestExpiry)
        ? Math.max(1, Math.ceil((nearestExpiry - now) / 1000))
        : 60;
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(503).json({
        erro: 'Protecao temporaria de requisicoes ocupada. Tente novamente em instantes.',
        retryAfterSec
      });
    }

    buckets.set(key, { count: 1, resetAt: now + windowMs });
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
