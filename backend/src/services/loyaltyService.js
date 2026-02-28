import { readDb, writeDb } from '../data/repository.js';

const LIMITE_FIDELIDADE = 200;

function normalizeCpf(value) {
  return String(value || '').replace(/\D/g, '');
}

function findCliente(db, cpf) {
  const target = normalizeCpf(cpf);
  return db.clientesFidelidade.find((c) => normalizeCpf(c.cpf) === target) || null;
}

export function getLoyaltyByCpf(cpf) {
  const db = readDb();
  if (!normalizeCpf(cpf)) return null;
  return findCliente(db, cpf);
}

export function applyLoyalty(cpf, nome, valorCompra) {
  const cpfNorm = normalizeCpf(cpf);
  if (!cpfNorm) return null;

  const db = readDb();
  let cliente = findCliente(db, cpfNorm);

  if (!cliente) {
    cliente = {
      cpf: cpfNorm,
      nome: nome || 'Cliente',
      totalGasto: 0,
      progressoGasto: 0,
      recompensasGeradas: 0,
      cupons: []
    };
    db.clientesFidelidade.push(cliente);
  }

  cliente.totalGasto += Number(valorCompra);
  cliente.progressoGasto += Number(valorCompra);

  while (cliente.progressoGasto >= LIMITE_FIDELIDADE) {
    cliente.progressoGasto -= LIMITE_FIDELIDADE;
    cliente.recompensasGeradas += 1;

    const codigo = `FIDELI${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 10)}`;
    const cupom = {
      codigo,
      tipo: 'percentual',
      valor: 10,
      ativo: true,
      minSubtotal: 40,
      validade: '2027-12-31',
      usoMaximo: 1,
      usos: 0,
      origem: 'fidelidade'
    };

    db.cupons.push(cupom);
    cliente.cupons.push(codigo);
  }

  writeDb(db);
  return cliente;
}
