const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const chatLog = require('./chat-log');

// El log vive en server/data/chats; usamos un tenant de prueba con id único y limpiamos.
const TID = '__test_chatlog__';
const file = path.join(__dirname, 'chats', `${TID}.jsonl`);
function cleanup() { try { fs.unlinkSync(file); } catch {} }

test('appendChat + exportCsv registran y exportan bien (con escaping)', () => {
  cleanup();
  chatLog.appendChat(TID, { conversationId: 'c1', question: 'ventas de hoy', answer: 'Total 1.234 €', engine: 'llm', status: 'ok', sources: ['Shopify', 'ERP'], rows: 3, elapsedMs: 850 });
  chatLog.appendChat(TID, { conversationId: 'c1', question: 'y con "comas, y saltos"\nsegunda línea', answer: 'ok', engine: 'llm', status: 'ok', sources: [], rows: 0, elapsedMs: 100 });

  const rows = chatLog.readChats(TID);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].question, 'ventas de hoy');
  assert.ok(rows[0].ts, 'guarda timestamp');

  const csv = chatLog.exportCsv(TID);
  const lines = csv.split('\r\n');
  assert.ok(lines[0].startsWith('fecha,cliente,conversacion,pregunta,respuesta'), 'cabecera CSV');
  assert.ok(csv.includes('Shopify + ERP'), 'une las fuentes');
  // El texto con comas/comillas/saltos va entre comillas y con comillas dobladas.
  assert.ok(csv.includes('"y con ""comas, y saltos""'), 'escapa comillas y comas');
  cleanup();
});
