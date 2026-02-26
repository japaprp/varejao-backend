import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'database.json');

export function readDb() {
  const raw = fs.readFileSync(dbPath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

export function writeDb(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
}
