import { isSessionCartId, validateCartSession } from '../services/cartSessionService.js';

export function requireCartAccess(req, res, next) {
  const rawId = req.headers['x-cart-id'] || req.query.cartId || req.body?.cartId || '';
  if (typeof rawId !== 'string' || rawId.length > 200) {
    return res.status(400).json({ erro: 'Identificador do carrinho inválido.' });
  }

  const cartId = rawId.trim();
  const token = req.headers['x-cart-token'];
  if (Object.hasOwn(Object.prototype, cartId)) {
    return res.status(400).json({ erro: 'Identificador do carrinho inválido.' });
  }

  res.setHeader('Cache-Control', 'no-store');
  if (isSessionCartId(cartId)) {
    if (!validateCartSession(cartId, token)) {
      return res.status(401).json({ code: 'CART_SESSION_INVALID', erro: 'A sessão do carrinho é inválida ou expirou.' });
    }
    req.isProtectedCart = true;
  } else if (token !== undefined || process.env.CART_REQUIRE_SESSION === 'true') {
    return res.status(401).json({ erro: 'Inicie uma sessão para acessar o carrinho.' });
  }

  req.cartId = cartId;
  return next();
}
