import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(here, '../src/data/database.json');
const demoEmails = new Set([
  'gerente@varejao.com',
  'caixa@varejao.com',
  'balcao@varejao.com',
  'cozinha@varejao.com',
  'operador@varejao.com'
]);

function stop(message) {
  console.error(`PREFLIGHT FAIL: ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(dbPath)) {
  stop('database.json not found; no source data was changed.');
} else {
  try {
    const raw = fs.readFileSync(dbPath, 'utf8').replace(/^\uFEFF/, '');
    const db = JSON.parse(raw);
    const users = Array.isArray(db.usuarios) ? db.usuarios : [];
    const normalizedEmails = users.map((u) => String(u.email || '').trim().toLowerCase()).filter(Boolean);
    const duplicateEmailCount = normalizedEmails.length - new Set(normalizedEmails).size;
    const roleCounts = {};
    for (const user of users) {
      const role = String(user.role || 'missing').toLowerCase();
      roleCounts[role] = (roleCounts[role] || 0) + 1;
    }
    const missingHashCount = users.filter((u) => !String(u.senhaHash || '')).length;
    const bcryptHashCount = users.filter((u) => /^\$2[aby]\$/.test(String(u.senhaHash || ''))).length;
    const legacyHashCount = users.filter((u) => /^[a-f0-9]{64}$/i.test(String(u.senhaHash || ''))).length;
    const unknownHashCount = users.length - missingHashCount - bcryptHashCount - legacyHashCount;
    const demoAccountCount = users.filter((u) => demoEmails.has(String(u.email || '').trim().toLowerCase())).length;
    const collectionCounts = Object.fromEntries(
      Object.entries(db).map(([key, value]) => [key, Array.isArray(value) ? value.length : typeof value])
    );

    const report = {
      status: duplicateEmailCount || missingHashCount || unknownHashCount ? 'REVIEW_REQUIRED' : 'STRUCTURE_PARSED',
      source: 'backend/src/data/database.json',
      privacy: 'No names, emails, CPF, phone numbers, password hashes, tokens, or record values are emitted.',
      users: {
        total: users.length,
        roles: roleCounts,
        duplicateEmailCount,
        missingHashCount,
        bcryptHashCount,
        legacySha256HashCount: legacyHashCount,
        unknownHashFormatCount: unknownHashCount,
        knownDemoAccountCount: demoAccountCount
      },
      collections: collectionCounts
    };
    console.log(JSON.stringify(report, null, 2));
    if (duplicateEmailCount || missingHashCount || unknownHashCount) process.exitCode = 2;
  } catch (error) {
    stop(`database.json could not be parsed: ${error.message}`);
  }
}
