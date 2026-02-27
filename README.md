# Varejao do Povo

Sistema de compras online com front-end em HTML/CSS/JS e back-end em Node.js/Express.

## Deploy gratuito no Render (backend)

1. Suba este projeto no GitHub.
2. Acesse `https://render.com` e crie uma conta.
3. Clique em **New** -> **Web Service**.
4. Conecte o repositorio.
5. Configure:
   - **Name**: `varejao-backend`
   - **Root Directory**: `backend`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
6. Em **Environment**, adicione:
   - `MP_ACCESS_TOKEN`
   - `MP_PUBLIC_KEY`
   - `FRONTEND_URL` (URL publica do site)
   - `MP_WEBHOOK_URL` (`https://SEU_BACKEND.onrender.com/pagamento/webhook`)
   - `CORS_ALLOWED_ORIGINS` (lista separada por virgula com os dominios permitidos)
   - `GOOGLE_CLIENT_ID` (OAuth Client ID do Google para login social)
   - `FACEBOOK_APP_ID` (App ID do Facebook Login)
   - `FACEBOOK_APP_SECRET` (App Secret do Facebook Login)
7. Salve e aguarde o deploy.

Ao finalizar, o Render fornece a URL do backend, por exemplo:
`https://varejao-backend.onrender.com`

## Configurar o front-end para usar o backend publicado

Abra qualquer pagina do site com o parametro `api` para gravar o backend no navegador.
Exemplo:

```
https://seusite.com/index.html?api=https://varejao-backend.onrender.com
```

Isso salva a URL no navegador e todas as paginas passam a usar esse backend.

## Variaveis de ambiente do backend

Crie `backend/.env` com:

```
MP_ACCESS_TOKEN=SEU_ACCESS_TOKEN
MP_PUBLIC_KEY=SEU_PUBLIC_KEY
FRONTEND_URL=https://seusite.com
MP_WEBHOOK_URL=https://varejao-backend.onrender.com/pagamento/webhook
CORS_ALLOWED_ORIGINS=https://seusite.com
GOOGLE_CLIENT_ID=SEU_GOOGLE_CLIENT_ID
FACEBOOK_APP_ID=SEU_FACEBOOK_APP_ID
FACEBOOK_APP_SECRET=SEU_FACEBOOK_APP_SECRET
```

## Rodar local

1. Instale as dependencias do back-end:
   ```sh
   cd backend
   npm install
   npm start
   ```
2. Abra o front-end (HTML) no navegador.
3. O back-end roda em `http://localhost:3001`.
