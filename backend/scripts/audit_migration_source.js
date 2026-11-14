import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, '../src/data/database.json');
const db = JSON.parse(fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, ''));

const errors = [];
const counts = {};
const expectedCollections = {
  produtos: 'array',
  informacoes: 'object',
  fidelidade: 'object',
  usuarios: 'array',
  clientesFidelidade: 'array',
  cupons: 'array',
  entradasEstoque: 'array',
  perdasEstoque: 'array',
  pedidos: 'array',
  saidas: 'array',
  carrinhos: 'object',
  operacaoConfig: 'object'
};

for (const [name, expected] of Object.entries(expectedCollections)) {
  const value = db[name];
  const actual = Array.isArray(value) ? 'array' : value && typeof value === 'object' ? 'object' : typeof value;
  if (actual !== expected) errors.push(`collection ${name} must be ${expected}`);
  counts[name] = expected === 'array' && Array.isArray(value) ? value.length : actual;
}

function duplicateCount(values) {
  const seen = new Set();
  let duplicates = 0;
  for (const value of values) {
    if (seen.has(value)) duplicates += 1;
    else seen.add(value);
  }
  return duplicates;
}

function checkUniqueIds(name, rows) {
  const valid = rows.filter((row) => row && typeof row.id === 'string' && row.id.trim());
  const missing = rows.length - valid.length;
  const duplicates = duplicateCount(valid.map((row) => row.id));
  if (missing) errors.push(`${name}: ${missing} records without a string id`);
  if (duplicates) errors.push(`${name}: ${duplicates} duplicate ids`);
  return { missingIds: missing, duplicateIds: duplicates };
}

const products = Array.isArray(db.produtos) ? db.produtos : [];
const users = Array.isArray(db.usuarios) ? db.usuarios : [];
const coupons = Array.isArray(db.cupons) ? db.cupons : [];
const orders = Array.isArray(db.pedidos) ? db.pedidos : [];

const idAudits = {
  produtos: checkUniqueIds('produtos', products),
  usuarios: checkUniqueIds('usuarios', users),
  cupons: checkUniqueIds('cupons', coupons),
  pedidos: checkUniqueIds('pedidos', orders),
  saidas: checkUniqueIds('saidas', Array.isArray(db.saidas) ? db.saidas : [])
};

const emails = users
  .map((user) => String(user?.email || '').trim().toLowerCase())
  .filter(Boolean);
const duplicateEmails = duplicateCount(emails);
if (duplicateEmails) errors.push(`usuarios: ${duplicateEmails} duplicate normalized emails`);

const allowedRoles = new Set(['cliente', 'admin', 'gerente', 'caixa', 'balcao', 'cozinha', 'operador']);
let invalidRoles = 0;
let missingHashes = 0;
let malformedHashes = 0;
for (const user of users) {
  if (!allowedRoles.has(String(user?.role || '').trim().toLowerCase())) invalidRoles += 1;
  const hash = String(user?.senhaHash || '');
  if (!hash) missingHashes += 1;
  else if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) malformedHashes += 1;
}
if (invalidRoles) errors.push(`usuarios: ${invalidRoles} invalid roles`);
if (missingHashes) errors.push(`usuarios: ${missingHashes} missing password hashes`);
if (malformedHashes) errors.push(`usuarios: ${malformedHashes} password hashes not in bcrypt format`);

let invalidProductValues = 0;
const productIds = new Set(products.map((product) => String(product?.id ?? '')));
for (const product of products) {
  const price = Number(product?.preco);
  const stock = Number(product?.estoque);
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(stock) || stock < 0) {
    invalidProductValues += 1;
  }
}
if (invalidProductValues) errors.push(`produtos: ${invalidProductValues} invalid price/stock records`);

let invalidOrderLines = 0;
for (const order of orders) {
  if (!Array.isArray(order?.itens)) {
    invalidOrderLines += 1;
    continue;
  }
  for (const item of order.itens) {
    const quantity = Number(item?.quantidade);
    if (!productIds.has(String(item?.produtoId ?? '')) || !Number.isFinite(quantity) || quantity <= 0) {
      invalidOrderLines += 1;
    }
  }
}
if (invalidOrderLines) errors.push(`pedidos: ${invalidOrderLines} invalid item references/quantities`);

const couponCodes = coupons.map((coupon) => String(coupon?.codigo || '').trim().toLowerCase()).filter(Boolean);
const duplicateCouponCodes = duplicateCount(couponCodes);
if (duplicateCouponCodes) errors.push(`cupons: ${duplicateCouponCodes} duplicate normalized codes`);

const report = {
  source: 'repository snapshot only; not live runtime data',
  collectionCounts: counts,
  idAudits,
  integrity: {
    duplicateNormalizedEmails: duplicateEmails,
    invalidRoles,
    missingPasswordHashes: missingHashes,
    malformedPasswordHashes: malformedHashes,
    invalidProductPriceOrStockRecords: invalidProductValues,
    invalidOrderItemReferencesOrQuantities: invalidOrderLines,
    duplicateNormalizedCouponCodes: duplicateCouponCodes
  },
  errors
};

console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
