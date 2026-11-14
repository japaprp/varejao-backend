import assert from 'node:assert/strict';
import { createRateLimiter, getClientIp } from '../src/middlewares/rateLimitMiddleware.js';

function makeRequest(forwardedFor, remoteAddress = '127.0.0.1') {
  return {
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
    socket: { remoteAddress }
  };
}

function makeResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function invoke(limiter, req) {
  const res = makeResponse();
  let nextCalled = false;
  limiter(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

// Render's documented X-Forwarded-For client address is accepted and
// the first address in a proxy chain is used.
assert.equal(
  getClientIp(makeRequest('198.51.100.24, 10.0.0.8')),
  '198.51.100.24'
);

// Malformed forwarded values never become arbitrary bucket keys.
assert.equal(
  getClientIp(makeRequest('not-an-ip, 10.0.0.8', '203.0.113.7')),
  '203.0.113.7'
);
assert.equal(getClientIp(makeRequest(undefined, 'not-an-ip')), 'unknown');

// Enforce the configured request window and Retry-After.
let now = 1000;
const limiter = createRateLimiter({
  keyPrefix: 'test-auth',
  windowMs: 5000,
  max: 2,
  clock: () => now,
  maxEntries: 2
});
const client = makeRequest('198.51.100.24');
assert.equal(invoke(limiter, client).nextCalled, true);
assert.equal(invoke(limiter, client).nextCalled, true);
const blocked = invoke(limiter, client);
assert.equal(blocked.nextCalled, false);
assert.equal(blocked.res.statusCode, 429);
assert.equal(blocked.res.headers['Retry-After'], '5');

// A full bucket table fails closed for new identities instead of growing
// without bound or silently evicting another client's active limit.
const capacityLimiter = createRateLimiter({
  keyPrefix: 'test-capacity',
  windowMs: 1000,
  max: 5,
  clock: () => now,
  maxEntries: 1
});
assert.equal(invoke(capacityLimiter, makeRequest('198.51.100.1')).nextCalled, true);
const capacityBlocked = invoke(capacityLimiter, makeRequest('198.51.100.2'));
assert.equal(capacityBlocked.nextCalled, false);
assert.equal(capacityBlocked.res.statusCode, 503);
assert.equal(capacityBlocked.res.headers['Retry-After'], '1');

// Expired buckets are removed and capacity becomes available again.
now += 1001;
assert.equal(invoke(capacityLimiter, makeRequest('198.51.100.2')).nextCalled, true);

console.log('Rate limiter tests ok');
