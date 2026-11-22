import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createPostgresRepository } from '../src/data/postgresRepository.js';

const connectionString = process.env.VAREJAO_TEST_POSTGRES_URL || '';
const databaseUrl = connectionString ? new URL(connectionString) : null;
if (databaseUrl?.protocol !== 'postgresql:' || databaseUrl.hostname !== '127.0.0.1'
    || databaseUrl.pathname !== '/varejao_repository_test' || databaseUrl.search) {
  throw new Error('Use VAREJAO_TEST_POSTGRES_URL for a disposable local varejao_repository_test database.');
}

const config = { connectionString, max: 1 };
const firstPool = new pg.Pool(config);
const secondPool = new pg.Pool(config);
const first = createPostgresRepository(firstPool);
const second = createPostgresRepository(secondPool);

try {
  const firstPid = (await firstPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const secondPid = (await secondPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  assert.notEqual(firstPid, secondPid);
  await firstPool.query(await readFile(new URL('../migrations/0001_postgres_foundation.sql', import.meta.url), 'utf8'));
  await assert.rejects(first.readState(), { code: 'VAREJAO_STATE_NOT_INITIALIZED' });
  await firstPool.query('INSERT INTO varejao_app_state (singleton_id, payload) VALUES (1, $1)', [{ units: 60 }]);
  const updates = await Promise.all(Array.from({ length: 60 }, (_, index) => {
    const repo = index % 2 === 0 ? first : second;
    return repo.transact(draft => { draft.units -= 1; });
  }));
  assert.equal(new Set(updates.map(item => item.revision)).size, 60);
  assert.deepEqual(await first.readState(), { revision: '60', payload: { units: 0 } });
  await assert.rejects(second.transact(draft => {
    draft.units = -1;
    throw new Error('fixture rollback');
  }), /fixture rollback/);
  assert.deepEqual(await first.readState(), { revision: '60', payload: { units: 0 } });
  console.log('PostgreSQL integration passed: 60 concurrent writes without lost updates and rollback confirmed.');
} finally {
  await Promise.all([firstPool.end(), secondPool.end()]);
}
