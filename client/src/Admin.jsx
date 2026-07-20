import { useEffect, useState } from 'react';
import { authFetch } from './auth';

const box = { border: '1px solid #e5e7eb', borderRadius: '12px', padding: '1rem', background: '#fff', marginBottom: '1rem' };
const input = { padding: '0.5rem', borderRadius: '8px', border: '1px solid #d1d5db', width: '100%', boxSizing: 'border-box' };
const btn = { padding: '0.5rem 0.9rem', borderRadius: '8px', border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer' };
const btnGhost = { ...btn, background: '#f3f4f6', color: '#111827', border: '1px solid #d1d5db' };
const labelS = { display: 'grid', gap: '0.3rem', fontSize: '0.82rem', color: '#374151' };

const CANONICOS = [
  ['id', 'id'], ['codigo', 'código'], ['documento', 'documento'],
  ['fecha', 'fecha'], ['fecha_prevista', 'fecha prevista'],
  ['importe', 'importe'], ['precio_unitario', 'precio unitario'], ['coste', 'coste'],
  ['descuento', 'descuento'], ['impuestos', 'impuestos'], ['margen', 'margen'], ['moneda', 'moneda'],
  ['cantidad', 'cantidad'], ['stock', 'stock'],
  ['cliente', 'cliente'], ['proveedor', 'proveedor'], ['comercial', 'comercial'],
  ['producto', 'producto'], ['categoria', 'categoría'], ['marca', 'marca'], ['variante', 'variante'],
  ['ubicacion', 'ubicación'], ['region', 'región'], ['canal', 'canal'],
  ['tipo', 'tipo'], ['estado', 'estado'], ['forma_pago', 'forma de pago']
];
const ENTIDADES = ['orders', 'customers', 'products', 'inventory', 'invoices', 'purchases', 'suppliers', 'tickets'];

// Proveedores de LLM que el cliente puede elegir (todos compatibles con la API de OpenAI).
const LLM_PROVIDERS = [
  { id: '', label: 'Por defecto del servidor (.env)', model: '' },
  { id: 'openai', label: 'OpenAI', model: 'gpt-4o' },
  { id: 'gemini', label: 'Google Gemini', model: 'gemini-2.5-flash' },
  { id: 'groq', label: 'Groq', model: 'llama-3.3-70b-versatile' },
  { id: 'deepseek', label: 'DeepSeek', model: 'deepseek-chat' },
  { id: 'custom', label: 'Personalizado (compatible OpenAI)', model: '' }
];

const KINDS = {
  excel: { label: 'Excel / CSV (archivo)', sql: false, fields: [{ k: 'filePath', label: 'Ruta del archivo', ph: 'server/data/uploads/coches_ventas.xlsx' }] },
  shopify: { label: 'Shopify', sql: false, fields: [{ k: 'domain', label: 'Dominio de la tienda', ph: 'xxx.myshopify.com' }, { k: 'accessToken', label: 'Access token', secret: true }, { k: 'apiVersion', label: 'Versión de API', def: '2024-10' }] },
  rest: { label: 'REST genérico', sql: false, fields: [{ k: 'baseUrl', label: 'URL base' }, { k: 'apiKey', label: 'API key', secret: true }, { k: 'resources', label: 'Recursos (coma)', ph: 'orders,products' }] },
  globalapi: { label: 'ERP GlobalApi (SQL sobre HTTP)', sql: true, fields: [{ k: 'baseUrl', label: 'URL base de la API', ph: 'https://.../globalapi' }, { k: 'apiKey', label: 'API key', secret: true }, { k: 'apiKeyHeader', label: 'Cabecera de la API key', def: 'X-Api-Key' }] },
  sql: { label: 'SQL (PostgreSQL)', sql: true, fields: [{ k: 'host', label: 'Host', def: 'localhost' }, { k: 'port', label: 'Puerto', def: '5432' }, { k: 'database', label: 'Base de datos' }, { k: 'user', label: 'Usuario' }, { k: 'password', label: 'Contraseña', secret: true }] }
};

async function api(path, method = 'GET', body) {
  let res;
  // ngrok-skip-browser-warning evita la página intersticial de ngrok; authFetch añade el token.
  const headers = { 'Content-Type': 'application/json' };
  try { res = await authFetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('sin conexión con el servidor (¿backend arrancado?)'); }
  const text = await res.text();
  let data = {};
  if (text) { try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 200) }; } }
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

const defaults = (k) => Object.fromEntries(KINDS[k].fields.map((f) => [f.k, f.def || '']));

function pairsToMappings(pairs, tableEntity) {
  const byTable = {};
  Object.entries(pairs).forEach(([canon, v]) => {
    if (!v || !v.tabla || !v.columna) return;
    (byTable[v.tabla] = byTable[v.tabla] || {})[canon] = v.columna;
  });
  return Object.entries(byTable).map(([tabla, fields]) => ({ source: tabla, target: tableEntity[tabla] || tabla, fields }));
}
// Config de un origen guardado -> valores del formulario (para poder editarlo).
function sourceToForm(source) {
  const k = source.kind || 'excel';
  const c = source.config || {};
  let f;
  if (k === 'sql') {
    const m = /^postgres(?:ql)?:\/\/([^:]*):([^@]*)@([^:/]+):(\d+)\/(.+)$/.exec(c.connectionString || '');
    f = m ? { user: m[1], password: m[2], host: m[3], port: m[4], database: m[5] } : {};
  } else if (k === 'rest') {
    f = { baseUrl: c.baseUrl || '', apiKey: c.apiKey || '', resources: (c.resources || []).join(',') };
  } else if (k === 'globalapi') {
    f = { baseUrl: c.baseUrl || '', apiKey: c.apiKey || '', apiKeyHeader: c.apiKeyHeader || 'X-Api-Key' };
  } else if (k === 'shopify') {
    f = { domain: c.domain || '', accessToken: c.accessToken || '', apiVersion: c.apiVersion || '2024-10' };
  } else {
    f = { filePath: c.filePath || '' };
  }
  return { kind: k, name: source.name || '', fields: { ...defaults(k), ...f } };
}

function mappingsToState(mappings) {
  const pairs = {}; const te = {}; const cols = {};
  (mappings || []).forEach((m) => {
    te[m.source] = m.target;
    Object.entries(m.fields || {}).forEach(([canon, col]) => {
      pairs[canon] = { tabla: m.source, columna: col };
      cols[m.source] = cols[m.source] || [];
      if (!cols[m.source].includes(col)) cols[m.source].push(col);
    });
  });
  return { pairs, te, cols };
}

export default function Admin() {
  const [tenants, setTenants] = useState([]);
  const [selected, setSelected] = useState(null);
  const [config, setConfig] = useState(null);
  const [msg, setMsg] = useState('');
  const [nt, setNt] = useState({ id: '', name: '', business: '' });

  const [kind, setKind] = useState('excel');
  const [sname, setSname] = useState('');
  const [editingSourceId, setEditingSourceId] = useState(null); // null = añadiendo uno nuevo
  const [fields, setFields] = useState(defaults('excel'));
  const [advanced, setAdvanced] = useState('');
  const [showAdv, setShowAdv] = useState(false);
  const [testRes, setTestRes] = useState(null);

  const [colsByRes, setColsByRes] = useState({});
  const [pattern, setPattern] = useState('');
  const [tables, setTables] = useState(null);

  const [pairs, setPairs] = useState({});
  const [tableEntity, setTableEntity] = useState({});
  const [prompt, setPrompt] = useState('');
  const [charts, setCharts] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [llm, setLlm] = useState({ provider: '', model: '', baseUrl: '' });
  const [llmKey, setLlmKey] = useState('');       // key nueva a enviar (vacío = no cambiar)
  const [llmKeySet, setLlmKeySet] = useState(false); // ¿ya hay una guardada?

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 4500); };
  const wrap = (fn) => async (...a) => { try { await fn(...a); } catch (e) { flash('⚠️ ' + e.message); } };

  const loadTenants = () => api('/api/tenants').then((d) => setTenants(d.tenants || [])).catch((e) => flash('⚠️ ' + e.message));
  useEffect(() => { loadTenants(); }, []);

  // Cambiar el tipo de origen (desde el desplegable): empieza de cero.
  const changeKind = (k) => {
    setKind(k); setSname(''); setFields(defaults(k)); setAdvanced(''); setTestRes(null); setTables(null);
    setColsByRes({}); setPairs({}); setTableEntity({});
  };

  // Vaciar el formulario para AÑADIR un origen nuevo.
  const newSource = () => {
    setEditingSourceId(null); setKind('excel'); setSname(''); setFields(defaults('excel'));
    setAdvanced(''); setTestRes(null); setTables(null); setColsByRes({}); setPairs({}); setTableEntity({});
  };

  // Cargar un origen guardado en el formulario para EDITARLO.
  const editSource = (source) => {
    const ff = sourceToForm(source);
    setEditingSourceId(source.id); setKind(ff.kind); setSname(ff.name); setFields(ff.fields);
    setAdvanced(''); setTestRes(null); setTables(null);
  };

  const openTenant = wrap(async (id) => {
    setSelected(id); setTestRes(null); setTables(null);
    const c = await api(`/api/tenants/${id}`);
    setConfig(c); setPrompt(c.prompt || ''); setCharts(c.charts === true);
    setLlm({ provider: c.llm?.provider || '', model: c.llm?.model || '', baseUrl: c.llm?.baseUrl || '' });
    setLlmKey(''); setLlmKeySet(!!c.llmKeySet);
    const { pairs: p, te, cols } = mappingsToState(c.mappings || []);
    setPairs(p); setTableEntity(te); setColsByRes(cols);
    setShowMap(Object.keys(cols).length > 0);
    // Pre-rellena el formulario con el primer origen guardado (si lo hay) en modo edición.
    const src = (c.sources || [])[0];
    if (src) { const ff = sourceToForm(src); setEditingSourceId(src.id); setKind(ff.kind); setSname(ff.name); setFields(ff.fields); }
    else { setEditingSourceId(null); setKind('excel'); setSname(''); setFields(defaults('excel')); }
  });

  const buildConfig = () => {
    let cfg;
    if (kind === 'sql') cfg = { connectionString: `postgres://${fields.user}:${fields.password}@${fields.host}:${fields.port}/${fields.database}` };
    else if (kind === 'rest') cfg = { baseUrl: fields.baseUrl, apiKey: fields.apiKey, resources: (fields.resources || '').split(',').map((s) => s.trim()).filter(Boolean) };
    else if (kind === 'globalapi') cfg = { baseUrl: fields.baseUrl, apiKey: fields.apiKey, apiKeyHeader: fields.apiKeyHeader || 'X-Api-Key', queries: {} };
    else cfg = { ...fields };
    if (advanced.trim()) { let ex; try { ex = JSON.parse(advanced); } catch { throw new Error('El JSON avanzado no es válido.'); } cfg = { ...cfg, ...ex }; }
    return cfg;
  };
  const draftSource = () => ({ kind, name: sname || KINDS[kind].label, config: buildConfig() });

  const createTenant = wrap(async () => {
    if (!nt.id || !nt.name) throw new Error('Indica id y nombre.');
    await api('/api/tenants', 'POST', nt);
    await loadTenants(); await openTenant(nt.id);
    setNt({ id: '', name: '', business: '' }); flash('✅ Cliente creado');
  });

  const onUpload = wrap(async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const dataBase64 = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
    const d = await api('/api/onboarding/upload', 'POST', { filename: file.name, dataBase64 });
    setFields((f) => ({ ...f, filePath: d.filePath })); flash('✅ Archivo subido: ' + d.filePath);
  });

  const testConn = wrap(async () => { setTestRes(await api('/api/onboarding/test', 'POST', draftSource())); });

  const autoDiscover = wrap(async () => {
    setTestRes(await api('/api/onboarding/test', 'POST', draftSource()));
    if (!KINDS[kind].sql) {
      const d = await api('/api/onboarding/suggest', 'POST', draftSource());
      const cols = {}; (d.schema?.resources || []).forEach((r) => { cols[r.name] = (r.columns || []).map((c) => c.name); });
      setColsByRes(cols);
      const p = {}; const te = {};
      (d.suggestions || []).forEach((s) => { te[s.source] = s.target; Object.entries(s.fields || {}).forEach(([canon, col]) => { p[canon] = { tabla: s.source, columna: col }; }); });
      setPairs(p); setTableEntity(te); setShowMap(true);
      flash('✅ Descubierto y pre-emparejado. Revisa abajo si quieres.');
    } else {
      flash('Origen SQL: busca las tablas abajo y añade las que te interesen.');
    }
  });

  const searchTables = wrap(async () => { const d = await api('/api/onboarding/tables', 'POST', { ...draftSource(), patron: pattern }); setTables(d.tablas || []); });
  const addTable = wrap(async (t) => {
    const d = await api('/api/onboarding/columns', 'POST', { ...draftSource(), tabla: t });
    setColsByRes((c) => ({ ...c, [t]: (d.columnas || []).map((x) => x.name) }));
    setTableEntity((te) => ({ ...te, [t]: te[t] || '' }));
    setShowMap(true);
  });
  const removeTable = (t) => {
    setColsByRes((c) => { const n = { ...c }; delete n[t]; return n; });
    setPairs((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v.tabla !== t)));
    setTableEntity((te) => { const n = { ...te }; delete n[t]; return n; });
  };

  const setPair = (canon, val) => setPairs((p) => {
    if (!val) { const n = { ...p }; delete n[canon]; return n; }
    const [tabla, columna] = val.split('|||');
    return { ...p, [canon]: { tabla, columna } };
  });

  // ¿El formulario de origen tiene lo mínimo para guardarlo?
  const sourceConfigured = () => {
    if (kind === 'excel') return !!fields.filePath;
    if (kind === 'shopify') return !!fields.domain;
    if (kind === 'sql') return !!(fields.host && fields.database);
    return !!fields.baseUrl; // rest, globalapi
  };

  // Guardar el origen del formulario: crea uno nuevo o actualiza el que se está editando.
  const saveSource = wrap(async () => {
    if (!sourceConfigured()) throw new Error('Completa los datos del origen antes de guardarlo.');
    const src = draftSource();
    if (editingSourceId) {
      await api(`/api/tenants/${selected}/sources/${editingSourceId}`, 'PUT', src);
      flash('✅ Origen actualizado');
    } else {
      const created = await api(`/api/tenants/${selected}/sources`, 'POST', src);
      setEditingSourceId(created.id); // seguimos editando el recién creado
      flash('✅ Origen añadido');
    }
    const c = await api(`/api/tenants/${selected}`); setConfig(c);
  });

  const deleteSource = wrap(async (sourceId) => {
    await api(`/api/tenants/${selected}/sources/${sourceId}`, 'DELETE');
    if (editingSourceId === sourceId) newSource();
    const c = await api(`/api/tenants/${selected}`); setConfig(c);
    flash('🗑 Origen borrado');
  });

  // Descarga las conversaciones del cliente en CSV (usa authFetch para el token).
  const downloadChats = wrap(async () => {
    const res = await authFetch(`/api/tenants/${selected}/chats.csv`);
    if (!res.ok) throw new Error('No se pudieron descargar las conversaciones.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `chats-${selected}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  });

  const saveAll = wrap(async () => {
    const mappings = pairsToMappings(pairs, tableEntity);
    await api(`/api/tenants/${selected}`, 'PUT', { mappings, prompt, charts, llm });
    if (llmKey.trim()) await api(`/api/tenants/${selected}/llm-key`, 'POST', { apiKey: llmKey.trim() });
    await openTenant(selected);
    flash('✅ Guardado (LLM + mapping + guía + opciones)');
  });

  const usedTables = Object.keys(colsByRes);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr', gap: '1.5rem' }}>
      <aside>
        <h3 style={{ marginTop: 0 }}>Clientes</h3>
        {tenants.length === 0 && <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>No hay clientes. Crea uno.</p>}
        {tenants.map((t) => (
          <button key={t.id} onClick={() => openTenant(t.id)} style={{ ...btnGhost, width: '100%', textAlign: 'left', marginBottom: '0.35rem', background: selected === t.id ? '#dbeafe' : '#f3f4f6' }}>{t.name}</button>
        ))}
        <div style={{ ...box, marginTop: '1rem' }}>
          <strong style={{ fontSize: '0.85rem' }}>+ Nuevo cliente</strong>
          <div style={{ display: 'grid', gap: '0.4rem', marginTop: '0.5rem' }}>
            <input style={input} placeholder="id" value={nt.id} onChange={(e) => setNt({ ...nt, id: e.target.value })} />
            <input style={input} placeholder="Nombre" value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} />
            <input style={input} placeholder="Negocio (opcional)" value={nt.business} onChange={(e) => setNt({ ...nt, business: e.target.value })} />
            <button style={btn} onClick={createTenant}>Crear</button>
          </div>
        </div>
      </aside>

      <main>
        {msg && <div style={{ ...box, background: '#ecfdf5', borderColor: '#a7f3d0' }}>{msg}</div>}
        {!selected && <p style={{ color: '#6b7280' }}>Selecciona un cliente o crea uno nuevo.</p>}

        {selected && config && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
              <h2 style={{ marginTop: 0, marginBottom: 0 }}>{config.tenant?.name} <span style={{ color: '#9ca3af', fontWeight: 400 }}>({selected})</span></h2>
              <button style={{ ...btnGhost, fontSize: '0.85rem' }} onClick={downloadChats} title="Descarga todas las preguntas y respuestas de este cliente en CSV">⬇ Descargar conversaciones (CSV)</button>
            </div>

            <div style={box}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>Orígenes de datos <span style={{ fontWeight: 400, color: '#6b7280', fontSize: '0.8rem' }}>({(config.sources || []).length})</span></strong>
                <button style={{ ...btnGhost, fontSize: '0.82rem', padding: '0.3rem 0.6rem' }} onClick={newSource}>+ Añadir origen</button>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: '0.3rem 0 0.5rem' }}>
                Un cliente puede tener varios orígenes (p. ej. ERP + Shopify). En la <b>Guía del agente</b> defines cómo se combinan (qué fuente usar para cada tipo de pregunta).
              </p>
              {(config.sources || []).length === 0 && <p style={{ color: '#6b7280', margin: 0 }}>Ninguno todavía. Pulsa <b>+ Añadir origen</b>.</p>}
              <div style={{ display: 'grid', gap: '0.35rem' }}>
                {(config.sources || []).map((s) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', padding: '0.4rem 0.6rem', borderRadius: '8px', border: '1px solid #e5e7eb', background: editingSourceId === s.id ? '#dbeafe' : '#f9fafb' }}>
                    <span style={{ fontSize: '0.88rem' }}><strong>{s.name}</strong> <span style={{ color: '#6b7280' }}>· {KINDS[s.kind]?.label || s.kind}</span>{editingSourceId === s.id && <span style={{ color: '#1d4ed8', fontSize: '0.75rem' }}> · editando</span>}</span>
                    <span style={{ display: 'flex', gap: '0.35rem' }}>
                      <button style={{ ...btnGhost, fontSize: '0.78rem', padding: '0.2rem 0.5rem' }} onClick={() => editSource(s)}>✏️ Editar</button>
                      <button style={{ ...btnGhost, fontSize: '0.78rem', padding: '0.2rem 0.5rem', color: '#991b1b' }} onClick={() => { if (window.confirm(`¿Borrar el origen "${s.name}"?`)) deleteSource(s.id); }}>🗑</button>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 1 · Conectar */}
            <div style={box}>
              <strong>1 · {editingSourceId ? 'Editar origen' : 'Conectar nuevo origen'}</strong>
              <div style={{ display: 'grid', gap: '0.7rem', marginTop: '0.7rem' }}>
                <div style={{ display: 'flex', gap: '0.7rem', flexWrap: 'wrap' }}>
                  <label style={{ ...labelS, flex: '0 0 230px' }}>Tipo de origen
                    <select style={input} value={kind} onChange={(e) => changeKind(e.target.value)}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
                  </label>
                  <label style={{ ...labelS, flex: 1, minWidth: 160 }}>Nombre del origen<input style={input} placeholder={KINDS[kind].label} value={sname} onChange={(e) => setSname(e.target.value)} /></label>
                </div>
                {kind === 'excel' && (
                  <label style={{ ...labelS, background: '#eff6ff', border: '1px dashed #93c5fd', borderRadius: '8px', padding: '0.6rem' }}>
                    <strong style={{ fontSize: '0.85rem' }}>⬆ Subir archivo Excel/CSV</strong>
                    <input type="file" accept=".xlsx,.xls,.csv" onChange={onUpload} />
                    <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Al subirlo se rellena la ruta sola.</span>
                  </label>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.6rem' }}>
                  {KINDS[kind].fields.map((f) => (
                    <label key={f.k} style={labelS}>{f.label}
                      <input style={input} type={f.secret ? 'password' : 'text'} placeholder={f.ph || ''} value={fields[f.k] || ''} onChange={(e) => setFields({ ...fields, [f.k]: e.target.value })} />
                    </label>
                  ))}
                </div>
                <div>
                  <button style={{ ...btnGhost, fontSize: '0.8rem', padding: '0.2rem 0.5rem' }} onClick={() => setShowAdv(!showAdv)}>{showAdv ? '▾' : '▸'} Avanzado (JSON extra)</button>
                  {showAdv && <textarea style={{ ...input, fontFamily: 'monospace', minHeight: 70, marginTop: '0.4rem' }} placeholder='{ "queries": { "orders": "SELECT ..." } }' value={advanced} onChange={(e) => setAdvanced(e.target.value)} />}
                </div>
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <button style={btnGhost} onClick={testConn}>Probar conexión</button>
                  <button style={btnGhost} onClick={autoDiscover}>⚡ Auto-descubrir</button>
                  <button style={btn} onClick={saveSource}>{editingSourceId ? '💾 Guardar cambios del origen' : '➕ Guardar origen'}</button>
                  {editingSourceId && <button style={btnGhost} onClick={newSource}>Cancelar edición</button>}
                </div>
                {testRes && <div style={{ color: testRes.ok ? '#065f46' : '#991b1b' }}>{testRes.ok ? '✅' : '❌'} {testRes.message}</div>}
              </div>
            </div>

            {/* 2 · SQL: buscar tablas */}
            {KINDS[kind].sql && (
              <div style={box}>
                <strong>2 · Buscar tablas del ERP / SQL</strong>
                <div style={{ display: 'flex', gap: '0.6rem', margin: '0.6rem 0' }}>
                  <input style={input} placeholder="filtro (STOCK, CLIENTE, VENTA…) — vacío = todo" value={pattern} onChange={(e) => setPattern(e.target.value)} />
                  <button style={btnGhost} onClick={searchTables}>Buscar</button>
                </div>
                {tables && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>{tables.map((t) => <button key={t} style={{ ...btnGhost, fontSize: '0.8rem', padding: '0.25rem 0.5rem', background: colsByRes[t] ? '#dcfce7' : '#f3f4f6' }} onClick={() => addTable(t)}>{colsByRes[t] ? '✓ ' : '+ '}{t}</button>)}</div>}
              </div>
            )}

            {/* 3 · Mapping OPCIONAL */}
            <div style={box}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{KINDS[kind].sql ? '3' : '2'} · Emparejar campos <span style={{ fontWeight: 400, color: '#6b7280', fontSize: '0.8rem' }}>(opcional — con IA no es necesario)</span></strong>
                {usedTables.length > 0 && <button style={{ ...btnGhost, fontSize: '0.8rem', padding: '0.2rem 0.5rem' }} onClick={() => setShowMap(!showMap)}>{showMap ? 'ocultar' : 'mostrar'}</button>}
              </div>
              <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '0.3rem 0 0' }}>
                Sirve para dar contexto: dices qué columna de tu origen es el "importe", la "fecha", el "cliente"… Solo rellena lo que tengas; el resto déjalo en "—".
              </p>

              {usedTables.length === 0 ? (
                <p style={{ color: '#6b7280', marginTop: '0.6rem' }}>Pulsa <b>Auto-descubrir</b> (o añade tablas) para ver aquí las columnas.</p>
              ) : showMap && (
                <>
                  {/* entidad por tabla */}
                  <div style={{ margin: '0.8rem 0', display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>Tipo de cada tabla/recurso:</span>
                    {usedTables.map((tabla) => (
                      <span key={tabla} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.82rem', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '0.2rem 0.4rem' }}>
                        <b>{tabla}</b> →
                        <select style={{ ...input, width: 'auto', padding: '0.15rem 0.3rem' }} value={tableEntity[tabla] || ''} onChange={(e) => setTableEntity({ ...tableEntity, [tabla]: e.target.value })}>
                          <option value="">—</option>
                          {ENTIDADES.map((en) => <option key={en} value={en}>{en}</option>)}
                          {tableEntity[tabla] && !ENTIDADES.includes(tableEntity[tabla]) && <option value={tableEntity[tabla]}>{tableEntity[tabla]}</option>}
                        </select>
                        {KINDS[kind].sql && <button style={{ ...btnGhost, padding: '0 0.35rem', fontSize: '0.75rem' }} onClick={() => removeTable(tabla)}>✕</button>}
                      </span>
                    ))}
                  </div>

                  {/* campos canónicos con desplegable */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '0.35rem 1.2rem' }}>
                    {CANONICOS.map(([key, lab]) => {
                      const cur = pairs[key] ? `${pairs[key].tabla}|||${pairs[key].columna}` : '';
                      return (
                        <label key={key} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
                          <span style={{ color: cur ? '#111827' : '#9ca3af', fontWeight: cur ? 600 : 400 }}>{lab}</span>
                          <select style={{ ...input, padding: '0.3rem 0.4rem', background: cur ? '#f0f9ff' : '#fff' }} value={cur} onChange={(e) => setPair(key, e.target.value)}>
                            <option value="">—</option>
                            {Object.entries(colsByRes).map(([tabla, cols]) => (
                              <optgroup key={tabla} label={tabla}>
                                {cols.map((col) => <option key={col} value={`${tabla}|||${col}`}>{usedTables.length > 1 ? `${tabla} · ${col}` : col}</option>)}
                              </optgroup>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* 4 · Guía */}
            <div style={box}>
              <strong>{KINDS[kind].sql ? '4' : '3'} · Guía del agente (opcional)</strong>
              <textarea style={{ ...input, minHeight: 80, marginTop: '0.6rem' }} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Pistas para el LLM: dónde está cada dato, reglas de negocio…" />
            </div>

            {/* Modelo de IA (LLM) */}
            <div style={box}>
              <strong>Modelo de IA (LLM)</strong>
              <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: '0.3rem 0 0.6rem' }}>
                Elige el proveedor de IA de este cliente y pon su API key. Si lo dejas en <b>«Por defecto del servidor»</b>, se usa la clave global del servidor (.env). La API key se guarda cifrada aparte y nunca se muestra.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.6rem' }}>
                <label style={labelS}>Proveedor
                  <select style={input} value={llm.provider} onChange={(e) => {
                    const p = e.target.value; const def = LLM_PROVIDERS.find((x) => x.id === p);
                    setLlm({ ...llm, provider: p, model: def?.model || '' });
                  }}>
                    {LLM_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </label>
                {llm.provider && (
                  <label style={labelS}>Modelo
                    <input style={input} placeholder={LLM_PROVIDERS.find((x) => x.id === llm.provider)?.model || 'nombre del modelo'} value={llm.model} onChange={(e) => setLlm({ ...llm, model: e.target.value })} />
                  </label>
                )}
                {llm.provider === 'custom' && (
                  <label style={labelS}>URL base (endpoint)
                    <input style={input} placeholder="https://.../v1" value={llm.baseUrl} onChange={(e) => setLlm({ ...llm, baseUrl: e.target.value })} />
                  </label>
                )}
                {llm.provider && (
                  <label style={labelS}>API key {llmKeySet && <span style={{ color: '#059669', fontSize: '0.72rem' }}>· configurada</span>}
                    <input style={input} type="password" placeholder={llmKeySet ? '•••••••• (vacío = no cambiar)' : 'Introduce la API key'} value={llmKey} onChange={(e) => setLlmKey(e.target.value)} />
                  </label>
                )}
              </div>
              {llm.provider === 'gemini' && <p style={{ fontSize: '0.72rem', color: '#6b7280', margin: '0.5rem 0 0' }}>Gemini: crea la key en Google AI Studio (aistudio.google.com). Modelos: gemini-2.0-flash, gemini-2.5-flash, gemini-2.5-pro.</p>}
            </div>

            {/* Opciones */}
            <div style={box}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={charts} onChange={(e) => setCharts(e.target.checked)} />
                <span><strong>Mostrar gráficos</strong> — al preguntar, además de la tabla y el texto, el agente añade el gráfico que mejor se adapte (tarta, barras, líneas, dispersión).</span>
              </label>
            </div>

            <button style={{ ...btn, padding: '0.7rem 1.2rem', fontSize: '1rem' }} onClick={saveAll}>💾 Guardar guía, mapping y opciones</button>
            <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.4rem' }}>Los orígenes se guardan por separado con su propio botón (arriba). Aquí guardas la guía, el mapping y las opciones.</p>
          </>
        )}
      </main>
    </div>
  );
}
