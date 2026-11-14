function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertStateObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('PostgreSQL application state must be a JSON object.');
  }
}

function assertSynchronousMutation(value) {
  if (value && typeof value.then === 'function') {
    throw new TypeError('Transaction mutators must be synchronous and side-effect-free.');
  }
}

export function createPostgresRepository(pool, { validateState = assertStateObject } = {}) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL-compatible pool with query() and connect() is required.');
  }
  if (typeof validateState !== 'function') {
    throw new TypeError('validateState must be a function.');
  }

  async function readState() {
    const result = await pool.query(
      'SELECT revision, payload FROM varejao_app_state WHERE singleton_id = 1'
    );
    if (result.rowCount !== 1 || !result.rows?.[0]) {
      const error = new Error('PostgreSQL application state is not initialized.');
      error.code = 'VAREJAO_STATE_NOT_INITIALIZED';
      throw error;
    }

    const payload = cloneJson(result.rows[0].payload);
    validateState(payload);
    return { revision: Number(result.rows[0].revision), payload };
  }

  async function transact(mutator) {
    if (typeof mutator !== 'function') {
      throw new TypeError('A transaction mutator function is required.');
    }

    const client = await pool.connect();
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const selected = await client.query(
        'SELECT revision, payload FROM varejao_app_state WHERE singleton_id = 1 FOR UPDATE'
      );
      if (selected.rowCount !== 1 || !selected.rows?.[0]) {
        const error = new Error('PostgreSQL application state is not initialized.');
        error.code = 'VAREJAO_STATE_NOT_INITIALIZED';
        throw error;
      }

      const currentRevision = String(selected.rows[0].revision);
      const draft = cloneJson(selected.rows[0].payload);
      validateState(draft);
      const value = mutator(draft);
      assertSynchronousMutation(value);
      validateState(draft);

      const updated = await client.query(
        'UPDATE varejao_app_state SET payload = $1::jsonb, revision = revision + 1, updated_at = now() WHERE singleton_id = 1 AND revision = $2 RETURNING revision',
        [JSON.stringify(draft), currentRevision]
      );
      if (updated.rowCount !== 1 || !updated.rows?.[0]) {
        const error = new Error('PostgreSQL application state revision conflict.');
        error.code = 'VAREJAO_REVISION_CONFLICT';
        throw error;
      }

      await client.query('COMMIT');
      transactionOpen = false;
      return { value, revision: Number(updated.rows[0].revision) };
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          error.rollbackError = rollbackError;
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return Object.freeze({ readState, transact });
}