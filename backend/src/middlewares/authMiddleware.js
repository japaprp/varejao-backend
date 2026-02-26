import { getUserByToken } from '../services/authService.js';

export function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  const user = getUserByToken(token);
  if (!user) {
    return res.status(401).json({ erro: 'Não autenticado' });
  }

  req.user = user;
  return next();
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ erro: 'Acesso restrito ao administrador' });
  }
  return next();
}

export function requireRole(roles = []) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ erro: 'Acesso restrito' });
    }
    return next();
  };
}

