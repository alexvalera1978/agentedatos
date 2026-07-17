// Autenticación simple por CONTRASEÑA ÚNICA compartida (protege la app expuesta
// por ngrok). La contraseña vive en la variable de entorno APP_PASSWORD; si no
// está definida, la autenticación queda DESACTIVADA (cómodo en desarrollo y para
// no romper los tests). El token de sesión es autofirmado (HMAC) y con caducidad:
// no hace falta guardar sesiones en memoria y sobrevive a reinicios del servidor.
const crypto = require('crypto');

const DIAS_VALIDEZ = 7;
const TTL_MS = DIAS_VALIDEZ * 24 * 60 * 60 * 1000;

const password = () => String(process.env.APP_PASSWORD || '');
// Secreto para firmar el token. Si cambias la contraseña, los tokens antiguos
// dejan de valer automáticamente (el secreto por defecto deriva de ella).
const secret = () => String(process.env.APP_SECRET || process.env.APP_PASSWORD || '');

// ¿Está activada la protección? (solo si hay contraseña configurada)
function enabled() {
  return password().length > 0;
}

// Comparación en tiempo constante para no filtrar la contraseña por timing.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function checkPassword(pw) {
  if (!enabled()) return true;
  return safeEqual(pw || '', password());
}

function sign(exp) {
  return crypto.createHmac('sha256', secret()).update(String(exp)).digest('hex');
}

// Emite un token "<caducidad>.<firma>".
function issueToken() {
  const exp = Date.now() + TTL_MS;
  return `${exp}.${sign(exp)}`;
}

function verifyToken(token) {
  if (!enabled()) return true; // sin contraseña configurada, todo pasa
  const [exp, sig] = String(token || '').split('.');
  if (!exp || !sig) return false;
  if (Number(exp) < Date.now()) return false; // caducado
  return safeEqual(sig, sign(exp));
}

// Middleware Express: protege /api/* (excepto login y el estado de auth) y deja
// pasar el resto (frontend estático, /health). Sin contraseña configurada, no bloquea.
function middleware(req, res, next) {
  if (!enabled()) return next();
  const p = req.path;
  if (!p.startsWith('/api/')) return next(); // frontend y estáticos: públicos
  if (p === '/api/login' || p === '/api/auth/status') return next(); // públicos
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!verifyToken(token)) {
    return res.status(401).json({ status: 'error', message: 'No autorizado. Inicia sesión.' });
  }
  return next();
}

module.exports = { enabled, checkPassword, issueToken, verifyToken, middleware };
