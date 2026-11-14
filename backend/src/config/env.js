export const PORT = Number(process.env.PORT) || 3001;
export const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
export const MP_PUBLIC_KEY = process.env.MP_PUBLIC_KEY || '';
export const FRONTEND_URL = process.env.FRONTEND_URL || '';
export const MP_WEBHOOK_URL = process.env.MP_WEBHOOK_URL || '';
export const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || '';
export const MP_COLLECTOR_ID = process.env.MP_COLLECTOR_ID || '';
export const CORS_ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS || FRONTEND_URL || '';
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
export const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || '';
export const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || '';
// Never ship a reusable signing key. Configure a unique random value (32+ chars) in the host.
export const TOKEN_SECRET = process.env.TOKEN_SECRET || '';
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@varejao.com';
// No built-in administrator or operational passwords.
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
export const DEMO_OPERATIONAL_PASSWORD = process.env.DEMO_OPERATIONAL_PASSWORD || '';
// Demo operational accounts are opt-in, not created by default.
export const DISABLE_DEMO_OPERATIONAL_USERS = process.env.DISABLE_DEMO_OPERATIONAL_USERS !== 'false';

export function assertRuntimeConfig(env = process.env) {
  const tokenSecret = String(env.TOKEN_SECRET || '');
  if (tokenSecret.length < 32) {
    throw new Error('Configuracao invalida: TOKEN_SECRET deve ser definido com pelo menos 32 caracteres aleatorios.');
  }
  if (env.NODE_ENV === 'production' && !String(env.ADMIN_PASSWORD || '')) {
    throw new Error('Configuracao invalida: ADMIN_PASSWORD deve ser definido no ambiente de producao.');
  }
  const demoDisabled = env.DISABLE_DEMO_OPERATIONAL_USERS !== 'false';
  if (env.NODE_ENV === 'production' && !demoDisabled && !String(env.DEMO_OPERATIONAL_PASSWORD || '')) {
    throw new Error('Configuracao invalida: DEMO_OPERATIONAL_PASSWORD e obrigatorio quando contas operacionais de demonstracao estao habilitadas.');
  }
  return true;
}
