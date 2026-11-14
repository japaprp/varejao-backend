import app from './app.js';
import { PORT, assertRuntimeConfig } from './config/env.js';

export function startServer() {
  assertRuntimeConfig();
  app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
}
