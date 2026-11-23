import assert from 'node:assert/strict';
import { createPostgresRepository } from '../src/data/postgresRepository.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeClient {
  constructor(pool) { this.pool = pool; this.working = null; this.started = false; this.released = false; }
  async query(sql, params = []) {
    const normalized = String(sql).replace(/\\s+/g, ' ').trim().toUpperCase();
    this.pool.events.push(normalized.split(' ')[0]);
    if (normalized === 'BEGIN') { this.working = this.pool.state ? clone(this.pool.state) : null; this.started = true; return { rowCount: null, rows: [] }; }
    if (normalized === 'COMMIT') { this.pool.state = clone(this.working); this.working = null; this.started = false; return { rowCount: null, rows: [] }; }
    if (normalized === 'ROLLBACK') { this.working = null; this.started = false; return { rowCount: null, rows: [] }; }
    if (normalized.includes('SELECT REVISION, PAYLOAD') && normalized.includes('FOR UPDATE')) {
      if (!this.started) throw new Error('Transaction not started');
      if (!this.working) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [{ revision: this.working.revision, payload: clone(this.working.payload) }] };
    }
    if (normalized.startsWith('UPDATE VAREJAO_APP_STATE')) {
      if (this.pool.forceConflict || String(this.working.revision) !== String(params[1])) return { rowCount: 0, rows: [] };
      this.working.payload = JSON.parse(params[0]);
      this.working.revision += 1;
      return { rowCount: 1, rows: [{ revision: this.working.revision }] };
    }
    throw new Error('Unexpected fake SQL: ' + normalized);
  }
  release() { this.released = true; this.pool.releases += 1; }
}

class FakePool {
  constructor(state = { revision: 0, payload: { produtos: [], pedidos: [] } }) {
    this.state = state;
    this.events = [];
    this.releases = 0;
    this.forceConflict = false;
  }
  async query(sql) {
    if (!String(sql).toUpperCase().includes('SELECT REVISION, PAYLOAD')) throw new Error('Unexpected pool SQL');
    if (!this.state) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [{ revision: this.state.revision, payload: clone(this.state.payload) }] };
  }
  async connect() { return new FakeClient(this); }
}

async function main() {
  {
    const pool = new FakePool();
    const repository = createPostgresRepository(pool);
    const snapshot = await repository.readState();
    snapshot.payload.produtos.push({ id: 'local-only' });
    assert.deepEqual(pool.state.payload.produtos, [], 'readState must return a detached snapshot');
  }
  {
    const pool = new FakePool();
    const repository = createPostgresRepository(pool);
    const result = await repository.transact((state) => {
      state.produtos.push({ id: 'p-1' });
      return 'committed';
    });
    assert.equal(result.value, 'committed');
    assert.equal(result.revision, '1');
    assert.deepEqual(pool.state.payload.produtos, [{ id: 'p-1' }]);
    assert.deepEqual(pool.events, ['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);
    assert.equal(pool.releases, 1);
  }
  {
    const pool = new FakePool();
    const repository = createPostgresRepository(pool);
    await assert.rejects(repository.transact((state) => { state.produtos.push({ id: 'no-commit' }); throw new Error('forced failure'); }), /forced failure/);
    assert.deepEqual(pool.state.payload.produtos, []);
    assert.equal(pool.events.at(-1), 'ROLLBACK');
    assert.equal(pool.releases, 1);
  }
  {
    const pool = new FakePool();
    const repository = createPostgresRepository(pool);
    await assert.rejects(repository.transact(async (state) => { state.produtos.push({ id: 'async-side-effect' }); }), /must be synchronous/);
    assert.deepEqual(pool.state.payload.produtos, []);
    assert.equal(pool.events.at(-1), 'ROLLBACK');
  }
  {
    const pool = new FakePool();
    pool.forceConflict = true;
    const repository = createPostgresRepository(pool);
    await assert.rejects(repository.transact((state) => { state.produtos.push({ id: 'conflict' }); }), (error) => error.code === 'VAREJAO_REVISION_CONFLICT');
    assert.deepEqual(pool.state.payload.produtos, []);
    assert.equal(pool.events.at(-1), 'ROLLBACK');
  }
  {
    const pool = new FakePool(null);
    const repository = createPostgresRepository(pool);
    await assert.rejects(repository.readState(), (error) => error.code === 'VAREJAO_STATE_NOT_INITIALIZED');
    await assert.rejects(repository.transact(() => {}), (error) => error.code === 'VAREJAO_STATE_NOT_INITIALIZED');
  }
  console.log('PostgreSQL repository contract tests ok: detached reads, row-locked commit, rollback, sync-only mutators, revision conflict, and fail-closed initialization.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});