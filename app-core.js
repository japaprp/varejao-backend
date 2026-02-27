(() => {
  const PROD_API = 'https://varejao-backend-83hm.onrender.com';
  const DEV_API = 'http://localhost:3001';

  function resolveApiBase() {
    const params = new URLSearchParams(window.location.search);
    const apiParam = params.get('api');
    const host = String(window.location.hostname || '').toLowerCase();
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

    if (apiParam) {
      localStorage.setItem('api_url', apiParam);
      return apiParam;
    }

    const persistedApi = localStorage.getItem('api_url');
    if (persistedApi) {
      const persistedIsLocal = persistedApi.includes('localhost') || persistedApi.includes('127.0.0.1');
      if (!isLocalHost && persistedIsLocal) {
        localStorage.setItem('api_url', PROD_API);
        return PROD_API;
      }
      return persistedApi;
    }

    const fallbackApi = isLocalHost ? DEV_API : PROD_API;
    localStorage.setItem('api_url', fallbackApi);
    return fallbackApi;
  }

  function resolveCartId() {
    const key = 'cart_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : `cart_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(key, id);
    }
    return id;
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
    resolveCartId,
    money,
    safeText,
    safeImageUrl,
    applyActiveNavLinks
  };
})();
