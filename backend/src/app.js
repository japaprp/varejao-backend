import express from 'express';
import cors from 'cors';
import path from 'path';
import storeRoutes from './routes/storeRoutes.js';
import { CORS_ALLOWED_ORIGINS } from './config/env.js';

const app = express();

const allowedOrigins = String(CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

app.use(cors({
  origin(origin, callback) {
    // Permite chamadas sem Origin (curl, webhook server-to-server).
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    const err = new Error('Origem nao permitida pelo CORS');
    err.status = 403;
    return callback(err);
  }
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
app.use(storeRoutes);

app.use((req, res) => {
  res.status(404).json({ erro: 'Rota nao encontrada' });
});

app.use((error, req, res, next) => {
  const status = error.status || 500;
  const mensagem = error.message || 'Erro interno do servidor';
  res.status(status).json({ erro: mensagem });
});

export default app;

