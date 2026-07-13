import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell,
  LineChart, Line, ScatterChart, Scatter, XAxis, YAxis, Tooltip, Legend, CartesianGrid
} from 'recharts';

const COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6'];

const numES = new Intl.NumberFormat('es-ES');
const fmtNum = (v) => (Number.isNaN(Number(v)) ? v : numES.format(Number(v)));
const DIM_RE = /(^|[_\s])(mes|month|a[nñ]?o|anio|anyo|ano|year|dia|dias|day|semana|week|trimestre|quarter|periodo|hora)([_\s]|$)/i;
const MES_RE = /(^|[_\s])(mes|month)([_\s]|$)/i;
const FECHA_RE = /fecha|date/i;
const MESES_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Formatea una fecha ISO (2025-03-03T00:00:00) como dd/mm/aaaa.
const fmtFecha = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
};

// Devuelve el formateador del eje X según el tipo de columna.
function axisFmt(key) {
  if (MES_RE.test(key)) return (v) => (Number(v) >= 1 && Number(v) <= 12 ? MESES_ABBR[Number(v) - 1] : v);
  if (FECHA_RE.test(key)) return fmtFecha;
  return undefined;
}

// Decide el tipo de gráfico que mejor se adapta a los datos.
function pickChart(rows) {
  if (rows.length < 2) return null; // con una sola fila no hay nada que graficar
  const keys = Object.keys(rows[0]).filter((k) => k !== 'entity');
  const isNum = (k) => rows.every((r) => r[k] !== null && r[k] !== '' && !Number.isNaN(Number(r[k])));
  const nums = keys.filter(isNum);
  const cats = keys.filter((k) => !isNum(k));
  const dateKey = keys.find((k) => FECHA_RE.test(k));
  const dims = keys.filter((k) => DIM_RE.test(k)); // mes, año, día, semana…

  // El VALOR nunca es una dimensión (año/mes/día) ni una fecha.
  const value = nums.find((k) => k !== dateKey && !dims.includes(k));
  if (!value) return null;

  // Dimensiones que realmente varían, ordenadas por nº de valores distintos (desc).
  const varying = dims
    .map((k) => ({ k, n: new Set(rows.map((r) => r[k])).size }))
    .filter((d) => d.n > 1)
    .sort((a, b) => b.n - a.n);

  // Dos dimensiones (p. ej. Año + Mes) → COMPARATIVA: una serie por la dimensión
  // de menor cardinalidad (Año) sobre el eje de la de mayor (Mes).
  if (varying.length >= 2 && varying[1].n >= 2 && varying[1].n <= 8) {
    return { type: 'comparison', x: varying[0].k, series: varying[1].k, y: value };
  }
  // Una sola dimensión que varía → barras (pocas) o línea (muchas).
  if (varying.length >= 1) return { type: rows.length <= 12 ? 'bar' : 'line', x: varying[0].k, y: value };
  // Serie temporal por fecha → línea.
  if (dateKey && dateKey !== value) return { type: 'line', x: dateKey, y: value };
  // Dos numéricos y suficientes puntos → dispersión (atomización).
  if (nums.length >= 2 && cats.length === 0 && rows.length >= 4) return { type: 'scatter', x: nums[0], y: nums[1] };
  // Categoría + valor → tarta (pocas) o barras (muchas).
  const label = cats[0] || keys.find((k) => k !== value);
  if (!label) return null;
  return { type: rows.length <= 6 ? 'pie' : 'bar', x: label, y: value };
}

// Convierte datos largos [{Anio,Mes,Total}] en anchos [{Mes, '2025':x, '2026':y}]
// para pintar una serie (barra/línea) por cada valor de la dimensión-serie.
function pivotComparison(data, spec) {
  const seriesVals = [...new Set(data.map((r) => String(r[spec.series])))];
  const xVals = [...new Set(data.map((r) => r[spec.x]))];
  const rows = xVals.map((xv) => {
    const row = { [spec.x]: xv };
    seriesVals.forEach((sv) => {
      const found = data.find((r) => String(r[spec.x]) === String(xv) && String(r[spec.series]) === sv);
      row[sv] = found ? Number(found[spec.y]) : 0;
    });
    return row;
  });
  return { rows, seriesVals };
}

export default function Chart({ data }) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const spec = pickChart(data);
  if (!spec) return null;

  const nombres = { bar: 'Barras', pie: 'Tarta', line: 'Líneas', scatter: 'Dispersión', comparison: 'Comparativa' };
  const xFmt = axisFmt(spec.x);

  // Comparativa: barras agrupadas, una barra por serie (año) en cada punto (mes).
  if (spec.type === 'comparison') {
    const { rows, seriesVals } = pivotComparison(data, spec);
    return (
      <div style={{ marginTop: '1rem' }}>
        <h3 style={{ marginBottom: '0.3rem' }}>Gráfico <span style={{ color: '#9ca3af', fontWeight: 400, fontSize: '0.85rem' }}>(Comparativa)</span></h3>
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: 10, right: 20, bottom: 40, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={spec.x} angle={-30} textAnchor="end" interval={0} height={60} tick={{ fontSize: 11 }} tickFormatter={xFmt} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtNum} />
              <Tooltip formatter={fmtNum} />
              <Legend />
              {seriesVals.map((sv, i) => <Bar key={sv} dataKey={sv} name={sv} fill={COLORS[i % COLORS.length]} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  // Normaliza y limita para que sea legible.
  const rows = data.slice(0, 20).map((r) => ({ ...r, [spec.y]: Number(r[spec.y]) }));

  return (
    <div style={{ marginTop: '1rem' }}>
      <h3 style={{ marginBottom: '0.3rem' }}>Gráfico <span style={{ color: '#9ca3af', fontWeight: 400, fontSize: '0.85rem' }}>({nombres[spec.type]})</span></h3>
      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer>
          {spec.type === 'bar' ? (
            <BarChart data={rows} margin={{ top: 10, right: 20, bottom: 40, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={spec.x} angle={-30} textAnchor="end" interval={0} height={60} tick={{ fontSize: 11 }} tickFormatter={xFmt} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtNum} />
              <Tooltip formatter={fmtNum} />
              <Bar dataKey={spec.y} fill="#2563eb" />
            </BarChart>
          ) : spec.type === 'pie' ? (
            <PieChart>
              <Pie data={rows} dataKey={spec.y} nameKey={spec.x} outerRadius={110} label>
                {rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={fmtNum} />
              <Legend />
            </PieChart>
          ) : spec.type === 'line' ? (
            <LineChart data={rows} margin={{ top: 10, right: 20, bottom: 40, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={spec.x} angle={-30} textAnchor="end" interval={0} height={60} tick={{ fontSize: 11 }} tickFormatter={xFmt} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtNum} />
              <Tooltip formatter={fmtNum} />
              <Line type="monotone" dataKey={spec.y} stroke="#2563eb" dot={false} />
            </LineChart>
          ) : (
            <ScatterChart margin={{ top: 10, right: 20, bottom: 40, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={spec.x} name={spec.x} type="number" tick={{ fontSize: 11 }} tickFormatter={fmtNum} />
              <YAxis dataKey={spec.y} name={spec.y} type="number" tick={{ fontSize: 11 }} tickFormatter={fmtNum} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={fmtNum} />
              <Scatter data={rows} fill="#2563eb" />
            </ScatterChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
