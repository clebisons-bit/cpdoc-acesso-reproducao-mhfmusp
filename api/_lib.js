// Funções compartilhadas pelas rotas /api (arquivos que começam com "_" não viram endpoints na Vercel).
import crypto from 'crypto';

/* ---------- Segredo e assinaturas ---------- */
function segredo() {
  const s = process.env.OTP_SECRET;
  if (!s || s.length < 16) throw new Error('Variável OTP_SECRET ausente ou curta demais (mínimo 16 caracteres).');
  return s;
}

export const hmac = (txt) => crypto.createHmac('sha256', segredo()).update(String(txt)).digest('hex');

export function iguais(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ---------- CPF ---------- */
export function cpfValido(cpf) {
  const c = String(cpf || '').replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (let t = 9; t < 11; t++) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(c[i]) * (t + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(c[t])) return false;
  }
  return true;
}

// O CPF nunca é guardado em claro como chave: usamos um HMAC dele.
export const chaveCpf = (cpfLimpo) => hmac(`cpf:${cpfLimpo}`);

/* ---------- Sessão assinada (emitida após o OTP correto) ---------- */
export function criarSessao(k, minutos = 120) {
  const exp = Date.now() + minutos * 60 * 1000;
  return { token: `${k}.${exp}.${hmac(`sess:${k}.${exp}`)}`, exp };
}

export function lerSessao(token) {
  const [k, exp, sig] = String(token || '').split('.');
  if (!k || !exp || !sig || Date.now() > Number(exp)) return null;
  return iguais(sig, hmac(`sess:${k}.${exp}`)) ? { k, exp: Number(exp) } : null;
}

/* ---------- Redis (Upstash, via REST) ---------- */
export async function redis(...cmd) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Redis (Upstash) não configurado na Vercel.');
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd.map(String))
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || `Redis HTTP ${r.status}`);
  return d.result;
}

// Limitador simples: devolve true se ainda está dentro do limite.
export async function limitar(chave, max, janelaSegundos) {
  const k = `rl:${chave}`;
  await redis('SET', k, 0, 'EX', janelaSegundos, 'NX');
  const n = await redis('INCR', k);
  return Number(n) <= max;
}

/* ---------- Utilidades ---------- */
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function lerBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  return b && typeof b === 'object' ? b : {};
}

export function ipDe(req) {
  const ip = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'desconhecido';
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24);
}

export function mascararEmail(email) {
  if (!email || !email.includes('@')) return 'e-mail cadastrado';
  const [user, domain] = email.split('@');
  if (user.length <= 2) return `${user[0]}*@${domain}`;
  return `${user[0]}${'*'.repeat(Math.min(user.length - 2, 5))}${user.slice(-1)}@${domain}`;
}

export const REMETENTE = () => process.env.MAIL_REMETENTE || 'propostacpdoc@gmail.com';
export const DESTINO = () => process.env.MAIL_DESTINO || 'cpdoc.museufm@usp.br';

export async function enviarBrevo(payload) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY não configurada na Vercel.');
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ sender: { name: 'CPDoc - Museu Histórico FMUSP', email: REMETENTE() }, ...payload })
  });
  if (!r.ok) {
    const detalhe = await r.text();
    const e = new Error(`Brevo ${r.status}: ${detalhe}`);
    e.status = r.status;
    throw e;
  }
  return r.json().catch(() => ({}));
}
