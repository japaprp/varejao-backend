import express from 'express';
import cors from 'cors';
import path from 'path';
import storeRoutes from './routes/storeRoutes.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
app.use(storeRoutes);

app.use((req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada' });
});

app.use((error, req, res, next) => {
  const status = error.status || 500;
  const mensagem = error.message || 'Erro interno do servidor';
  res.status(status).json({ erro: mensagem });
});

export default app;



