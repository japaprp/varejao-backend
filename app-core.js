(() => {
  const PROD_API = 'https://varejao-backend-1.onrender.com';
  const DEV_API = 'http://127.0.0.1:3001';

  function normalizeApiUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.origin;
    } catch {
      return '';
    }
  }

  function resolveApiBase() {
    const params = new URLSearchParams(window.location.search);
    const apiParam = normalizeApiUrl(params.get('api'));
    const host = String(window.location.hostname || '').toLowerCase();
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    const isRenderHost = host.endsWith('.onrender.com');

    if (apiParam) {
      localStorage.setItem('api_url', apiParam);
      return apiParam;
    }

    const persistedApi = normalizeApiUrl(localStorage.getItem('api_url'));

    if (!isLocalHost && isRenderHost) {
      localStorage.setItem('api_url', PROD_API);
      return PROD_API;
    }

    if (persistedApi) {
      const persistedIsLocal = persistedApi.includes('localhost') || persistedApi.includes('127.0.0.1');
      if (!isLocalHost && persistedIsLocal) {
        localStorage.setItem('api_url', PROD_API);
        return PROD_API;
      }
      if (isLocalHost && !persistedIsLocal) {
        localStorage.setItem('api_url', DEV_API);
        return DEV_API;
      }
      return persistedApi;
    }

    const fallbackApi = isLocalHost ? DEV_API : PROD_API;
    localStorage.setItem('api_url', fallbackApi);
    return fallbackApi;
  }

  function isLoopback(host) {
    return ['localhost', '127.0.0.1', '[::1]'].includes(host);
  }

  function trustedApi(value) {
    const api = normalizeApiUrl(value);
    if (!api) return '';
    if (api === PROD_API) return api;
    return isLoopback(window.location.hostname) && isLoopback(new URL(api).hostname) ? api : '';
  }

  function resolveCartApiBase() {
    const params = new URLSearchParams(window.location.search);
    const configured = trustedApi(params.get('api'));
    const local = isLoopback(window.location.hostname);
    if (configured) {
      localStorage.setItem('api_url', configured);
      return configured;
    }
    const saved = trustedApi(localStorage.getItem('api_url'));
    return local && saved && saved !== PROD_API ? saved : local ? DEV_API : PROD_API;
  }

  function resolveCartId() {
    const key = 'cart_id';
    const params = new URLSearchParams(window.location.search);
    const cartParam = params.get('cart');
    if (cartParam && !cartParam.toLowerCase().startsWith('v2_')) {
      localStorage.setItem(key, cartParam);
      return cartParam;
    }
    let id = localStorage.getItem(key);
    if (!id || id.toLowerCase().startsWith('v2_')) {
      id = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : `cart_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(key, id);
    }
    return id;
  }

  const pendingCartSessions = new Map();
  const legacyCartApis = new Set();

  function cartStorageKey(api) {
    return `cart_session:${api}`;
  }

  function isValidCartSession(session) {
    return /^v2_[a-f0-9-]{36}$/.test(session?.cartId)
      && /^[A-Za-z0-9_-]{43}$/.test(session?.cartToken)
      && Date.parse(session.expiresAt) > Date.now();
  }

  function readCartSession(api) {
    try {
      const session = JSON.parse(localStorage.getItem(cartStorageKey(api)) || 'null');
      return isValidCartSession(session) ? session : null;
    } catch {
      return null;
    }
  }

  function getCartSession(api) {
    const existing = readCartSession(api);
    if (existing || legacyCartApis.has(api)) return Promise.resolve(existing);
    if (pendingCartSessions.has(api)) return pendingCartSessions.get(api);

    const pending = (async () => {
      const response = await fetch(`${api}/carrinho/sessao`, { method: 'POST', redirect: 'error' });
      if (response.status === 404) {
        legacyCartApis.add(api);
        return null;
      }
      if (response.status !== 201) throw new Error('Não foi possível iniciar o carrinho.');
      const newSession = await response.json();
      if (!isValidCartSession(newSession)) throw new Error('Resposta inválida da sessão do carrinho.');

      const sharedSession = readCartSession(api);
      if (sharedSession) return sharedSession;
      localStorage.setItem(cartStorageKey(api), JSON.stringify(newSession));
      return newSession;
    })().finally(() => pendingCartSessions.delete(api));

    pendingCartSessions.set(api, pending);
    return pending;
  }

  async function fetchCart(api, pathname, options = {}) {
    if (trustedApi(api) !== api) throw new Error('Endereço do carrinho inválido.');
    const url = new URL(pathname, api);
    if (url.origin !== api) throw new Error('Endereço do carrinho inválido.');

    const { legacyCartId = resolveCartId(), ...request } = options;
    const legacyPhysicalCart = /(caixa|pdv|balcao|fisic|sessao|session|mesa|comanda)/i.test(legacyCartId);
    const session = legacyPhysicalCart ? null : await getCartSession(api);
    const headers = new Headers(request.headers);
    headers.set('X-Cart-Id', session?.cartId ?? legacyCartId);
    headers.delete('X-Cart-Token');
    if (session) headers.set('X-Cart-Token', session.cartToken);
    const response = await fetch(url, { ...request, headers, redirect: 'error' });
    if (session && response.status === 401) {
      const payload = await response.clone().json().catch(() => ({}));
      if (payload.code === 'CART_SESSION_INVALID' && readCartSession(api)?.cartId === session.cartId) {
        localStorage.removeItem(cartStorageKey(api));
      }
    }
    return response;
  }

  function money(v) {
    return Number(v || 0).toFixed(2).replace('.', ',');
  }

  function safeText(v) {
    return String(v || '');
  }

  function safeImageUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (
      raw.startsWith('data:image/')
      || raw.startsWith('http://')
      || raw.startsWith('https://')
      || raw.startsWith('/')
      || raw.startsWith('imagens/')
      || raw.startsWith('uploads/')
    ) {
      return raw;
    }
    return '';
  }

  function normalizePageFromHref(href) {
    try {
      const url = new URL(href, window.location.href);
      const path = (url.pathname.split('/').pop() || 'index.html').toLowerCase();
      if (!path) return 'index.html';
      return path === '' ? 'index.html' : path;
    } catch {
      return '';
    }
  }

  function applyActiveNavLinks() {
    const current = normalizePageFromHref(window.location.href);
    const links = document.querySelectorAll('nav a, #principal a, .page-links a');
    links.forEach((link) => {
      const target = normalizePageFromHref(link.getAttribute('href') || '');
      if (!target) return;
      if (target === current) {
        link.classList.add('is-active-link');
        link.setAttribute('aria-current', 'page');
      }
    });
  }

  function initUi() {
    applyActiveNavLinks();
    document.body.classList.add('ui-ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUi);
  } else {
    initUi();
  }

  window.AppCore = {
    resolveApiBase,
    resolveCartApiBase,
    resolveCartId,
    fetchCart,
    money,
    safeText,
    safeImageUrl,
    applyActiveNavLinks
  };
})();

