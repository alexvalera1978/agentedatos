// Lanza las preguntas de questions.json al agente y guarda los resultados.
// Uso:  node scripts/run-questions.mjs <tenantId> [questions.json] [results.json] [baseUrl]
// Requiere el backend arrancado (npm run dev) y Node 18+.
import { readFileSync, writeFileSync } from 'fs';

const tenantId = process.argv[2];
const qfile = process.argv[3] || 'scripts/questions.json';
const outfile = process.argv[4] || 'scripts/results.json';
const base = process.argv[5] || 'http://localhost:3001';

if (!tenantId) {
  console.error('Uso: node scripts/run-questions.mjs <tenantId> [questions.json] [results.json] [baseUrl]');
  console.error('Ejemplo: node scripts/run-questions.mjs smtp2');
  process.exit(1);
}

const questions = JSON.parse(readFileSync(qfile, 'utf8'));
const results = [];
const history = []; // memoria de conversación (como el chat)
console.log(`Lanzando ${questions.length} preguntas al cliente "${tenantId}" (${base}) con memoria…\n`);

for (const q of questions) {
  process.stdout.write(`[${q.id}/${questions.length}] (nivel ${q.nivel}) ${q.pregunta}\n`);
  let r;
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/api/agent/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, question: q.pregunta, history: history.slice(-8) })
    });
    r = await res.json();
  } catch (e) {
    r = { status: 'error', text: 'ERROR de conexión: ' + e.message };
  }
  // Alimenta la memoria para la siguiente pregunta.
  history.push({ role: 'user', content: q.pregunta });
  history.push({ role: 'assistant', content: r.text || '' });

  results.push({
    id: q.id,
    nivel: q.nivel,
    tema: q.tema,
    pregunta: q.pregunta,
    respuesta: r.text || r.message || '',
    filas: (r.data || []).length,
    datos: (r.data || []).slice(0, 100), // datos completos para poder verificarlos
    fuentes: r.sources || null,
    status: r.status || 'error',
    aprendido: !!r.learned,
    segundos: Math.round((Date.now() - t0) / 100) / 10
  });
  // Guardado incremental (si se corta, no pierdes lo hecho).
  writeFileSync(outfile, JSON.stringify(results, null, 2));
}

const ok = results.filter((r) => r.status === 'ok').length;
console.log(`\nHecho. ${ok}/${results.length} con estado "ok". Resultados en ${outfile}`);
console.log('Revisa el fichero, rellena "correccion" donde falle y pásamelo.');
