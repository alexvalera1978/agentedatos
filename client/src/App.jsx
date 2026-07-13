import { useState, useEffect, useRef } from 'react';
import Admin from './Admin';
import Chart from './Chart';

const BRAND = 'Encarna';
const BRAND_SUB = 'by TEC';

const SOURCE_LABELS = { globalapi: 'ERP', erp: 'ERP', shopify: 'Shopify', sql: 'SQL', rest: 'REST', excel: 'Excel' };
// Estilo de etiqueta por tipo de fuente, para que se vea de un vistazo de dónde salió el dato.
const SOURCE_BADGE = {
  shopify: { icon: '🛍️', bg: '#dcfce7', fg: '#166534', bd: '#86efac' },
  globalapi: { icon: '🗄️', bg: '#dbeafe', fg: '#1e40af', bd: '#93c5fd' },
  erp: { icon: '🗄️', bg: '#dbeafe', fg: '#1e40af', bd: '#93c5fd' },
  sql: { icon: '🗄️', bg: '#dbeafe', fg: '#1e40af', bd: '#93c5fd' },
  rest: { icon: '🔌', bg: '#f3e8ff', fg: '#6b21a8', bd: '#d8b4fe' },
  excel: { icon: '📄', bg: '#fef9c3', fg: '#854d0e', bd: '#fde68a' }
};

// ---- Formato de celdas (dinero €, fechas dd/mm/aaaa, números europeos) ----
const MONEY_RE = /(importe|total|valor|amount|precio|coste|costo|ventas|price|gasto|monto|margen|iva|impuest)/i;
// Columnas que son DIMENSIONES (no se totalizan ni se tratan como valor numérico).
const DIM_RE = /(^|[_\s])(mes|month|a[nñ]?o|anio|anyo|ano|year|dia|dias|day|semana|week|trimestre|quarter|periodo|hora)([_\s]|$)/i;
const MES_RE = /(^|[_\s])(mes|month)([_\s]|$)/i;
// Columnas que son PORCENTAJE (se muestran con %, y NO se suman en el total).
const PCT_RE = /(pct|porcentaje|ratio|%)/i;
// Columnas que son MEDIAS/PROMEDIOS (no se suman en el total: sumar una media no tiene sentido).
const AVG_RE = /(medi[oa]|promedio|media)/i;
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const numES = new Intl.NumberFormat('es-ES');
const pctFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
function fmtCell(key, value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // Mes numérico → nombre del mes.
  if (MES_RE.test(key)) { const mi = Number(value); if (Number.isInteger(mi) && mi >= 1 && mi <= 12) return MESES[mi - 1]; }
  // "2026-06" (año-mes) → "Junio 2026".
  const ym = /^(\d{4})-(\d{2})$/.exec(s);
  if (ym) { const mi = Number(ym[2]); if (mi >= 1 && mi <= 12) return `${MESES[mi - 1]} ${ym[1]}`; }
  const dm = /^(\d{4})-(\d{2})-(\d{2})([T ]|$)/.exec(s);
  if (dm) return `${dm[3]}/${dm[2]}/${dm[1]}`;
  const looksNumeric = /^-?\d+(\.\d+)?$/.test(s) && !/^0\d/.test(s);
  if (typeof value === 'number' || looksNumeric) {
    const n = Number(value);
    if (PCT_RE.test(key)) return `${pctFmt.format(n)} %`; // porcentaje, no € (comprobar antes que dinero)
    if (MONEY_RE.test(key)) return eur.format(n);
    if (Math.abs(n) >= 1000 || !Number.isInteger(n)) return numES.format(n);
  }
  return s;
}
// Quita filas exactamente idénticas (artefactos de joins sin agrupar).
function dedupeRows(data) {
  if (!Array.isArray(data)) return data;
  const seen = new Set(); const out = [];
  for (const r of data) { const k = JSON.stringify(r); if (!seen.has(k)) { seen.add(k); out.push(r); } }
  return out;
}

function totalsRow(data) {
  if (!data || data.length < 2) return null;
  const keys = Object.keys(data[0]);
  // No se totalizan dimensiones, porcentajes ni medias (sumar un % o una media no tiene sentido).
  const isNumericCol = (k) => k !== 'entity' && !DIM_RE.test(k) && !PCT_RE.test(k) && !AVG_RE.test(k)
    && data.some((r) => r[k] !== null && r[k] !== '')
    && data.every((r) => r[k] === null || r[k] === '' || (/^-?\d+(\.\d+)?$/.test(String(r[k])) && !/^0\d/.test(String(r[k]))));
  const numCols = keys.filter(isNumericCol);
  if (numCols.length === 0) return null;
  const row = {}; let labelPlaced = false;
  keys.forEach((k) => {
    if (numCols.includes(k)) row[k] = data.reduce((sum, r) => sum + (Number(r[k]) || 0), 0);
    else if (k !== 'entity' && !labelPlaced) { row[k] = 'TOTAL'; labelPlaced = true; }
    else row[k] = '';
  });
  return row;
}

const S = {
  app: { display: 'flex', height: '100vh', color: '#0f172a' },
  side: { width: 264, background: '#0b1220', color: '#e2e8f0', display: 'flex', flexDirection: 'column', padding: '0.9rem', flexShrink: 0 },
  brand: { fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem' },
  brandSub: { fontSize: '0.8rem', color: '#64748b', fontWeight: 400 },
  newBtn: { display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.6rem 0.8rem', borderRadius: 10, border: '1px solid #1e293b', background: '#111a2e', color: '#e2e8f0', cursor: 'pointer', marginBottom: '1rem', fontSize: '0.9rem' },
  sideLabel: { fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', margin: '0.6rem 0 0.35rem' },
  select: { width: '100%', padding: '0.5rem', borderRadius: 8, background: '#111a2e', color: '#e2e8f0', border: '1px solid #1e293b', fontSize: '0.9rem' },
  convItem: { padding: '0.55rem 0.6rem', borderRadius: 8, color: '#cbd5e1', fontSize: '0.85rem', background: '#111a2e', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', marginTop: '0.3rem', display: 'flex', gap: '0.4rem', alignItems: 'center' },
  sideBtn: { display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.5rem 0.6rem', borderRadius: 8, border: 'none', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', fontSize: '0.85rem', textAlign: 'left' },
  user: { display: 'flex', alignItems: 'center', gap: '0.5rem', paddingTop: '0.6rem', borderTop: '1px solid #1e293b', color: '#e2e8f0', fontSize: '0.85rem' },
  main: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#f8fafc' },
  header: { padding: '0.8rem 1.4rem', borderBottom: '1px solid #e5e7eb', background: '#fff', fontWeight: 600, color: '#334155' },
  msgs: { flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' },
  userRow: { display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' },
  userBubble: { background: '#0b1220', color: '#fff', padding: '0.7rem 1.1rem', borderRadius: 14, maxWidth: '68%' },
  avatar: { width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '1rem' },
  botRow: { display: 'flex', justifyContent: 'flex-start', gap: '0.7rem', alignItems: 'flex-start' },
  botCard: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '1rem 1.2rem', maxWidth: '82%', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' },
  inputBar: { display: 'flex', gap: '0.6rem', padding: '0.9rem 1.4rem', borderTop: '1px solid #e5e7eb', background: '#fff', alignItems: 'flex-end' },
  input: { flex: 1, padding: '0.85rem 1rem', borderRadius: 12, border: '1px solid #d1d5db', fontSize: '1rem', resize: 'none', fontFamily: 'inherit', maxHeight: 120 },
  sendBtn: { width: 48, height: 48, borderRadius: 12, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: '1.2rem' },
  footer: { textAlign: 'center', fontSize: '0.75rem', color: '#94a3b8', padding: '0.4rem' }
};

function DataTable({ data }) {
  if (!data || data.length === 0) return null;
  const cols = Object.keys(data[0]);
  const t = totalsRow(data);
  return (
    <div style={{ marginTop: '0.8rem', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr>{cols.map((k) => <th key={k} style={{ textAlign: 'left', borderBottom: '1px solid #d1d5db', padding: '0.4rem', color: '#64748b', fontWeight: 600 }}>{k}</th>)}</tr>
        </thead>
        <tbody>
          {data.slice(0, 200).map((row, i) => (
            <tr key={i}>{cols.map((k, j) => <td key={j} style={{ borderBottom: '1px solid #f1f5f9', padding: '0.4rem' }}>{fmtCell(k, row[k])}</td>)}</tr>
          ))}
          {t && (
            <tr style={{ fontWeight: 700, background: '#f8fafc' }}>
              {cols.map((k, j) => <td key={j} style={{ borderTop: '2px solid #94a3b8', padding: '0.4rem' }}>{fmtCell(k, t[k])}</td>)}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AssistantMsg({ msg }) {
  const data = dedupeRows(msg.data);
  return (
    <div style={S.botRow}>
      <div style={{ ...S.avatar, background: '#1e293b', color: '#fff' }}>🤖</div>
      <div style={S.botCard}>
        {msg.learned && <div style={{ display: 'inline-block', fontSize: '0.72rem', color: '#166534', background: '#dcfce7', border: '1px solid #86efac', borderRadius: 8, padding: '0.1rem 0.5rem', marginBottom: '0.5rem' }}>🧠 Aprendido y guardado</div>}
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, color: msg.status === 'error' ? '#991b1b' : '#0f172a' }}>{msg.text || '(sin respuesta)'}</div>
        {data && data.length > 0 && <DataTable data={data} />}
        {msg.charts && data && data.length > 0 && <Chart data={data} />}
        {(msg.sources?.length || msg.engine) && (
          <div style={{ marginTop: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            {(msg.sources || []).map((s, i) => {
              const b = SOURCE_BADGE[s.kind] || { icon: '📦', bg: '#f1f5f9', fg: '#334155', bd: '#cbd5e1' };
              return (
                <span key={i} title={`Datos de: ${s.name} (${SOURCE_LABELS[s.kind] || s.kind})`}
                  style={{ fontSize: '0.72rem', color: b.fg, background: b.bg, border: `1px solid ${b.bd}`, borderRadius: 8, padding: '0.12rem 0.5rem', fontWeight: 600 }}>
                  {b.icon} {s.name}
                </span>
              );
            })}
            <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
              {msg.engine === 'llm' ? '· IA' : msg.engine === 'keyword' ? '· ⚠️ palabras clave (IA no activa)' : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState('chat');
  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState('');
  const [teaching, setTeaching] = useState(false);
  const msgsRef = useRef(null);

  useEffect(() => {
    fetch('/api/tenants', { headers: { 'ngrok-skip-browser-warning': 'true' } }).then((r) => r.json()).then((d) => {
      const list = d.tenants || [];
      setTenants(list);
      setTenantId((prev) => (list.some((t) => t.id === prev) ? prev : (list[0]?.id || '')));
    }).catch(() => {});
  }, [view]);

  useEffect(() => { if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight; }, [messages, loading]);

  const tenantName = tenants.find((t) => t.id === tenantId)?.name || '';
  const firstQ = messages.find((m) => m.role === 'user')?.text;

  const changeTenant = (id) => { setTenantId(id); setMessages([]); };
  const newChat = () => setMessages([]);

  const send = async () => {
    const q = input.trim();
    if (!q || loading) return;
    if (!tenantId) { setMessages((m) => [...m, { role: 'assistant', text: 'No hay ningún cliente. Créalo en Administración.', status: 'error' }]); return; }
    const hist = messages.map((m) => ({ role: m.role, content: m.text })).slice(-8);
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/agent/query', { method: 'POST', headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' }, body: JSON.stringify({ question: q, tenantId, history: hist }) });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      const r = data || { status: 'error', text: 'El servidor no respondió. ¿Está arrancado el backend (npm run dev)?' };
      setMessages((m) => [...m, { role: 'assistant', text: r.text || r.message || '', data: r.data, sources: r.sources, engine: r.engine, charts: r.charts, status: r.status, learned: r.learned }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: 'No se pudo contactar con el servidor: ' + e.message, status: 'error' }]);
    } finally { setLoading(false); }
  };

  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  const teach = async () => {
    const h = hint.trim();
    if (!h || !tenantId) return;
    try {
      const res = await fetch(`/api/tenants/${tenantId}/hint`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' }, body: JSON.stringify({ hint: h }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'error');
      setHint(''); setTeaching(false);
      setMessages((m) => [...m, { role: 'assistant', text: '👍 Aprendido. Lo tendré en cuenta a partir de ahora para este cliente.', status: 'ok' }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: 'No pude guardar la pista: ' + e.message, status: 'error' }]);
    }
  };

  if (view === 'admin') {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
        <div style={{ padding: '0.8rem 1.2rem', background: '#0b1220', color: '#fff', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button onClick={() => setView('chat')} style={{ ...S.newBtn, width: 'auto', marginBottom: 0 }}>← Volver al chat</button>
          <strong>Administración de clientes</strong>
        </div>
        <div style={{ maxWidth: 1100, margin: '1.2rem auto', padding: '0 1rem' }}><Admin /></div>
      </div>
    );
  }

  return (
    <div style={S.app}>
      <aside style={S.side}>
        <div style={S.brand}>{BRAND} <span style={S.brandSub}>{BRAND_SUB}</span></div>
        <button style={S.newBtn} onClick={newChat}>➕ Nueva conversación</button>

        <div style={S.sideLabel}>Cliente</div>
        <select style={S.select} value={tenantId} onChange={(e) => changeTenant(e.target.value)}>
          {tenants.length === 0 && <option value="">(sin clientes)</option>}
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>

        <div style={S.sideLabel}>Conversación</div>
        {firstQ ? <div style={S.convItem}>💬 {firstQ}</div> : <div style={{ ...S.convItem, color: '#475569' }}>Sin mensajes aún</div>}

        <div style={S.sideLabel}>Aprendizaje</div>
        {teaching ? (
          <div style={{ display: 'grid', gap: '0.35rem' }}>
            <textarea style={{ ...S.select, minHeight: 70, resize: 'vertical', fontFamily: 'inherit' }} placeholder="Enséñale algo de este cliente. Ej: el PVP está en MAN_ARTICULOS_TARIFAS.PRECIO (TIPO='C') unido por ARTICULO=MAN_ARTICULOS.CODIGO." value={hint} onChange={(e) => setHint(e.target.value)} />
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              <button style={{ ...S.newBtn, marginBottom: 0, background: '#2563eb', border: 'none', flex: 1, justifyContent: 'center' }} onClick={teach}>Guardar</button>
              <button style={{ ...S.newBtn, marginBottom: 0 }} onClick={() => { setTeaching(false); setHint(''); }}>✕</button>
            </div>
          </div>
        ) : (
          <button style={S.sideBtn} onClick={() => setTeaching(true)}>💡 Enseñar al agente</button>
        )}

        <div style={{ flex: 1 }} />
        <button style={S.sideBtn} onClick={() => setView('admin')}>⚙️ Administración</button>
        <div style={S.user}><span style={{ ...S.avatar, background: '#334155', color: '#fff', width: 30, height: 30 }}>👤</span> {tenantName || 'Cliente'}</div>
      </aside>

      <main style={S.main}>
        <div style={S.header}>{firstQ || `Chat · ${tenantName || 'selecciona un cliente'}`}</div>

        <div style={S.msgs} ref={msgsRef}>
          {messages.length === 0 && (
            <div style={{ color: '#94a3b8', textAlign: 'center', marginTop: '3rem' }}>
              <div style={{ fontSize: '2rem' }}>🤖</div>
              <p>Pregunta sobre tu negocio: ventas, stock, clientes, rankings…</p>
            </div>
          )}
          {messages.map((m, i) => (
            m.role === 'user'
              ? <div key={i} style={S.userRow}><div style={S.userBubble}>{m.text}</div><div style={{ ...S.avatar, background: '#e2e8f0' }}>👤</div></div>
              : <AssistantMsg key={i} msg={m} />
          ))}
          {loading && (
            <div style={S.botRow}><div style={{ ...S.avatar, background: '#1e293b', color: '#fff' }}>🤖</div><div style={{ ...S.botCard, color: '#94a3b8' }}>Escribiendo…</div></div>
          )}
        </div>

        <div style={S.inputBar}>
          <textarea style={S.input} rows={1} placeholder="Pregunta sobre tu negocio…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} />
          <button style={S.sendBtn} onClick={send} disabled={loading}>➤</button>
        </div>
        <div style={S.footer}>{BRAND} · Agente de datos de negocio{tenantName ? ` · ${tenantName}` : ''}</div>
      </main>
    </div>
  );
}
