// Libera el puerto del backend (mata cualquier proceso que lo esté escuchando)
// antes de arrancar, para evitar el clásico EADDRINUSE al reiniciar `npm run dev`.
// Funciona en Windows y Unix. Nunca bloquea el arranque si algo falla.
const { execSync } = require('child_process');

const port = Number(process.env.PORT || 3001);

function run(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return '';
  }
}

try {
  const pids = new Set();

  if (process.platform === 'win32') {
    run('netstat -ano -p tcp')
      .split(/\r?\n/)
      .forEach((line) => {
        const m = line.match(/:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
        if (m && Number(m[1]) === port) pids.add(m[2]);
      });
    pids.forEach((pid) => {
      run(`taskkill /PID ${pid} /F`);
      console.log(`Puerto ${port}: proceso ${pid} detenido.`);
    });
  } else {
    run(`lsof -ti tcp:${port}`)
      .split(/\s+/)
      .filter(Boolean)
      .forEach((pid) => {
        run(`kill -9 ${pid}`);
        console.log(`Puerto ${port}: proceso ${pid} detenido.`);
      });
  }
} catch {
  // Si el sondeo falla (permisos, comando ausente…), seguimos: no bloquear el arranque.
}
