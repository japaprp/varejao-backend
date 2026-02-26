import { readDb, writeDb } from '../data/repository.js';

function isCouponExpired(validade) {
  if (!validade) return false;
  const today = new Date();
  const end = new Date(validade);
  end.setHours(23, 59, 59, 999);
  return today > end;
}

export function validateCoupon(codigo, subtotal) {
  const db = readDb();
  const cupom = db.cupons.find((c) => String(c.codigo).toUpperCase() === String(codigo || '').toUpperCase());

  if (!cupom) {
    const err = new Error('Cupom não encontrado');
    err.status = 404;
    throw err;
  }

  if (!cupom.ativo || isCouponExpired(cupom.validade)) {
    const err = new Error('Cupom inativo ou expirado');
    err.status = 400;
    throw err;
  }

  if (Number(subtotal) < Number(cupom.minSubtotal || 0)) {
    const err = new Error(`Subtotal minimo para cupom: R$ ${Number(cupom.minSubtotal || 0).toFixed(2)}`);
    err.status = 400;
    throw err;
  }

  if (Number(cupom.usos || 0) >= Number(cupom.usoMaximo || Infinity)) {
    const err = new Error('Cupom indisponivel no momento');
    err.status = 400;
    throw err;
  }

  return cupom;
}

export function calculateCouponDiscount(cupom, subtotal) {
  if (cupom.tipo === 'percentual') {
    return (Number(subtotal) * Number(cupom.valor)) / 100;
  }
  return Number(cupom.valor);
}

export function registerCouponUse(codigo) {
  const db = readDb();
  const idx = db.cupons.findIndex((c) => String(c.codigo).toUpperCase() === String(codigo).toUpperCase());
  if (idx === -1) return;
  db.cupons[idx].usos = Number(db.cupons[idx].usos || 0) + 1;
  writeDb(db);
}

