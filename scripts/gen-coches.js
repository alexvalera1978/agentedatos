// Genera un Excel INVENTADO de venta de coches, con nombres de columna a propósito
// DISTINTOS a los del ERP o Shopify (para probar el mapping/descubrimiento genérico).
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const marcas = [
  ['SEAT', ['Ibiza', 'León', 'Ateca']],
  ['Volkswagen', ['Golf', 'Polo', 'Tiguan']],
  ['Toyota', ['Corolla', 'Yaris', 'C-HR']],
  ['BMW', ['Serie 1', 'Serie 3', 'X1']],
  ['Renault', ['Clio', 'Mégane', 'Captur']],
  ['Kia', ['Ceed', 'Sportage', 'Niro']],
  ['Peugeot', ['208', '308', '3008']],
  ['Audi', ['A3', 'A4', 'Q3']]
];
const compradores = [
  'Marta Ledesma', 'Ignacio Fuentes', 'Rocío Bermúdez', 'Álvaro Nieto', 'Lucía Sáez',
  'Hugo Carranza', 'Elena Villar', 'Pablo Otero', 'Nadia Rincón', 'Sergio Alcázar',
  'Beatriz Gallardo', 'Óscar Prieto', 'Carla Montes', 'Daniel Herrero', 'Aitana Cruz'
];
const provincias = ['Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Zaragoza', 'Málaga', 'Bilbao'];
const pagos = ['Contado', 'Financiado', 'Renting'];
const comerciales = ['Laura Gómez', 'Pedro Ruiz', 'Ana Molina', 'Javier Soto'];
const combustibles = ['Gasolina', 'Diésel', 'Híbrido', 'Eléctrico'];

const plate = (i) => `${1000 + i * 7} ${['BCD', 'FGH', 'JKL', 'MNP', 'RST'][i % 5]}`;
// Fechas repartidas entre 2026-05-10 y 2026-07-01 (para que "último mes" tenga datos).
const fecha = (i) => {
  const start = Date.UTC(2026, 4, 10); // 10-may-2026
  const d = new Date(start + i * 32 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
};

const operaciones = [];
const inventario = [];
for (let i = 0; i < 40; i++) {
  const [marca, modelos] = marcas[i % marcas.length];
  const modelo = modelos[i % modelos.length];
  const anio = 2019 + (i % 7);
  const precio = 9500 + ((i * 1373) % 42000);
  operaciones.push({
    id_operacion: 5000 + i,
    fecha_operacion: fecha(i),
    matricula: plate(i),
    marca,
    modelo,
    anio,
    precio_venta: precio, // <- NO se llama VALOR ni total_price
    forma_pago: pagos[i % pagos.length],
    comprador: compradores[i % compradores.length], // <- NO se llama CLIENTE ni customer
    provincia: provincias[i % provincias.length],
    comercial: comerciales[i % comerciales.length]
  });
  inventario.push({
    matricula: plate(i),
    marca,
    modelo,
    anio,
    kilometros: (i * 2137) % 180000,
    combustible: combustibles[i % combustibles.length],
    precio_catalogo: precio + 800,
    en_stock: i % 4 === 0 ? 'No' : 'Sí'
  });
}

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(operaciones), 'operaciones');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inventario), 'inventario');

const out = path.resolve(__dirname, '..', 'server', 'data', 'uploads', 'coches_ventas.xlsx');
fs.mkdirSync(path.dirname(out), { recursive: true });
XLSX.writeFile(wb, out);
console.log('Excel generado:', out);
console.log('Hojas: operaciones (' + operaciones.length + ' filas), inventario (' + inventario.length + ' filas)');
console.log('Columnas operaciones:', Object.keys(operaciones[0]).join(', '));
