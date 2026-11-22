import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script, runInNewContext } from 'node:vm';
import { requireCartAccess } from '../src/middlewares/cartSessionMiddleware.js';

const siteFiles = ['index.html', 'Pagamento.html', 'setor-frutas.html', 'setor-legumes.html', 'setor-folhas.html'];
const source = await readFile(new URL('../../app-core.js', import.meta.url), 'utf8');
const trustedOrigin = 'https://varejao-backend-1.onrender.com';
const alternateOrigin = 'https://other-store.example.test';
const siteUrl = new URL('https://japaprp.github.io/varejao-backend/index.html');
const fixture = {
  cartId: 'v2_1abc4123-1234-4178-8178-123456789abc',
  cartToken: Buffer.alloc(32, 23).toString('base64url'),
  expiresAt: new Date(Date.now() + 3600000).toISOString()
};

function loadApp(url, fetch, storage = new Map()) {
  const window = { location: new URL(url), crypto };
  runInNewContext(source, {
    window,
    URL,
    URLSearchParams,
    fetch,
    Headers,
    document: { readyState: 'loading', addEventListener() {} },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    }
  });
  return window.AppCore;
}

for (const path of siteFiles) {
  const content = await readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
  assert.match(content, /app-core\.js\?v=cart-session-1/);
  assert.match(content, /AppCore\.fetchCart/);
  for (const [, script] of content.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    new Script(script, { filename: path });
  }
}

const calls = [];
const storage = new Map();
let checkoutDenied = false;
const transport = async (url, init) => {
  calls.push({ url: new URL(url), init });
  if (new URL(url).pathname === '/carrinho/sessao') {
    return Response.json(fixture, { status: 201 });
  }
  return checkoutDenied
    ? Response.json({ code: 'CART_SESSION_INVALID' }, { status: 401 })
    : Response.json({ itens: [] });
};

const configured = new URL(siteUrl);
configured.searchParams.set('api', alternateOrigin);
configured.searchParams.set('cart', fixture.cartId);
storage.set('api_url', alternateOrigin);

const storefront = loadApp(configured, transport, storage);
assert.equal(storefront.resolveCartApiBase(), trustedOrigin);
await assert.rejects(storefront.fetchCart(alternateOrigin, '/checkout'));
await assert.rejects(storefront.fetchCart(trustedOrigin, `${alternateOrigin}/checkout`));
assert.equal(calls.length, 0);

await Promise.all([
  storefront.fetchCart(trustedOrigin, '/checkout'),
  storefront.fetchCart(trustedOrigin, '/carrinho', { method: 'POST' })
]);
assert.equal(calls.length, 3);
assert.equal(calls.filter(({ url }) => url.pathname === '/carrinho/sessao').length, 1);
assert.equal(calls[1].init.headers.get('x-cart-id'), fixture.cartId);
assert.equal(calls[1].init.headers.get('x-cart-token'), fixture.cartToken);
assert.equal(calls[2].init.headers.get('x-cart-token'), fixture.cartToken);
assert.ok(calls.every(({ url }) => !url.href.includes(fixture.cartToken)));
assert.notEqual(storage.get('cart_id'), fixture.cartId);

const checkout = loadApp(siteUrl, transport, storage);
await checkout.fetchCart(trustedOrigin, '/checkout');
assert.equal(calls.length, 4);
assert.equal(calls[3].init.headers.get('x-cart-id'), fixture.cartId);
checkoutDenied = true;
await checkout.fetchCart(trustedOrigin, '/checkout');
assert.equal(storage.has(`cart_session:${trustedOrigin}`), false);

const legacy = loadApp(siteUrl, async (url, init) => {
  if (new URL(url).pathname === '/carrinho/sessao') return new Response(null, { status: 404 });
  assert.equal(init.headers.get('x-cart-id'), 'legacy-cart-fixture');
  assert.equal(init.headers.has('x-cart-token'), false);
  return Response.json([]);
});
await legacy.fetchCart(trustedOrigin, '/carrinho', { legacyCartId: 'legacy-cart-fixture' });

const strictModeBefore = process.env.CART_REQUIRE_SESSION;
try {
  process.env.CART_REQUIRE_SESSION = 'true';
  const req = { headers: { 'x-cart-id': 'legacy-cart-fixture' }, query: {} };
  let status;
  const res = {
    setHeader() {},
    status(code) { status = code; return this; },
    json(data) { return data; }
  };
  requireCartAccess(req, res, () => assert.fail('Strict mode accepted a legacy cart.'));
  assert.equal(status, 401);
} finally {
  if (strictModeBefore === undefined) delete process.env.CART_REQUIRE_SESSION;
  else process.env.CART_REQUIRE_SESSION = strictModeBefore;
}

console.log('Loja: origens, sessão compartilhada entre páginas, renovação e compatibilidade verificadas.');

