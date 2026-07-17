// Cliente de autenticación: guarda el token de sesión y añade la cabecera
// Authorization a todas las llamadas. Si el servidor responde 401 (token
// caducado o inválido), borra el token y avisa a la app para volver al login.
const KEY = 'agentedatos_token';

export const getToken = () => localStorage.getItem(KEY) || '';
export const setToken = (t) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));
export const logout = () => { setToken(''); window.dispatchEvent(new Event('auth-expired')); };

// Cabeceras comunes: el aviso anti-intersticial de ngrok + el token si lo hay.
export function authHeaders(extra) {
  const h = { 'ngrok-skip-browser-warning': 'true', ...(extra || {}) };
  const t = getToken();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

// fetch con token. En 401 cierra sesión (dispara 'auth-expired').
export async function authFetch(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: authHeaders(opts.headers) });
  if (res.status === 401) logout();
  return res;
}

// ¿Pide login el servidor? (público, sin token)
export async function fetchAuthStatus() {
  try {
    const r = await fetch('/api/auth/status', { headers: { 'ngrok-skip-browser-warning': 'true' } });
    const d = await r.json();
    return !!d.authRequired;
  } catch { return false; }
}

// Inicia sesión con la contraseña. Devuelve true si va bien; lanza error con mensaje si no.
export async function login(password) {
  const r = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
    body: JSON.stringify({ password })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.token) throw new Error(d.message || 'No se pudo iniciar sesión.');
  setToken(d.token);
  return true;
}
