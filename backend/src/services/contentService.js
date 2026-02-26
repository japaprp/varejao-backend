import { readDb } from '../data/repository.js';

export function getPromocoes() {
  return readDb().produtos.filter((item) => item.promocao);
}

export function getInformacoes() {
  return readDb().informacoes;
}

export function getFidelidade() {
  return readDb().fidelidade;
}
