// Registro append-only de las conversaciones (para analizarlas después).
// Una línea JSON por pregunta/respuesta, en server/data/chats/<cliente>.jsonl.
// Son datos del negocio (posible info de clientes): NO van a git (gitignorado).
const fs = require('fs');
const path = require('path');

function dir() {
  return path.join(__dirname, 'chats');
}
const safeId = (id) => String(id || 'sin-cliente').replace(/[^A-Za-z0-9_-]/g, '_');

// Añade una entrada al log del cliente. Nunca lanza: si falla, solo avisa por consola
// (registrar el chat no debe tumbar la respuesta al usuario).
function appendChat(tenantId, entry) {
  try {
    const d = dir();
    fs.mkdirSync(d, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), tenantId, ...entry });
    fs.appendFileSync(path.join(d, `${safeId(tenantId)}.jsonl`), `${line}\n`);
  } catch (e) {
    console.error('[chat-log] no se pudo guardar la conversación:', e.message);
  }
}

// Lee todas las entradas registradas de un cliente (más recientes al final).
function readChats(tenantId) {
  try {
    const file = path.join(dir(), `${safeId(tenantId)}.jsonl`);
    return fs.readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Escapa un valor para CSV (comillas dobladas; envuelto en comillas si hace falta).
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Exporta las conversaciones de un cliente como CSV (una fila por mensaje).
function exportCsv(tenantId) {
  const cols = ['fecha', 'cliente', 'conversacion', 'pregunta', 'respuesta', 'motor', 'estado', 'fuentes', 'filas', 'tiempo_ms'];
  const rows = readChats(tenantId).map((r) => [
    r.ts, r.tenantId, r.conversationId || '', r.question || '', r.answer || '',
    r.engine || '', r.status || '', (r.sources || []).join(' + '), r.rows ?? '', r.elapsedMs ?? ''
  ]);
  return [cols, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

module.exports = { appendChat, readChats, exportCsv };
