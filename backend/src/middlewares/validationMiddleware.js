function isEmail(value) {
  const raw = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
}

function isStrongEnoughPassword(value) {
  return String(value || '').length >= 6;
}

function normalizeCpf(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeCep(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

export function validateLoginPayload(req, res, next) {
  const { email = '', senha = '' } = req.body || {};
  if (!isEmail(email) || !isStrongEnoughPassword(senha)) {
    return res.status(400).json({ erro: 'Credenciais invalidas para login.' });
  }
  return next();
}

export function validateRegisterPayload(req, res, next) {
  const {
    nome = '',
    email = '',
    senha = '',
    cpf = '',
    cep = '',
    rua = '',
    bairro = '',
    cidade = '',
    telefone = ''
  } = req.body || {};
  if (String(nome).trim().length < 3) {
    return res.status(400).json({ erro: 'Nome invalido.' });
  }
  if (!isEmail(email) || !isStrongEnoughPassword(senha)) {
    return res.status(400).json({ erro: 'Email ou senha invalidos.' });
  }

  const cpfDigits = normalizeCpf(cpf);
  if (cpfDigits.length !== 11) {
    return res.status(400).json({ erro: 'CPF deve ter 11 digitos.' });
  }

  const cepDigits = normalizeCep(cep);
  if (cepDigits.length !== 8) {
    return res.status(400).json({ erro: 'CEP deve ter 8 digitos.' });
  }

  if (String(rua).trim().length < 3) {
    return res.status(400).json({ erro: 'Rua invalida.' });
  }
  if (String(bairro).trim().length < 2) {
    return res.status(400).json({ erro: 'Bairro invalido.' });
  }
  if (String(cidade).trim().length < 2) {
    return res.status(400).json({ erro: 'Cidade invalida.' });
  }

  const phoneDigits = normalizePhone(telefone);
  if (phoneDigits.length < 10 || phoneDigits.length > 11) {
    return res.status(400).json({ erro: 'Telefone invalido.' });
  }

  return next();
}

export function validateGooglePayload(req, res, next) {
  const idToken = String(req.body?.idToken || '').trim();
  if (!idToken) {
    return res.status(400).json({ erro: 'Token Google invalido.' });
  }
  return next();
}

export function validateFacebookPayload(req, res, next) {
  const accessToken = String(req.body?.accessToken || '').trim();
  if (!accessToken) {
    return res.status(400).json({ erro: 'Token Facebook invalido.' });
  }
  return next();
}
