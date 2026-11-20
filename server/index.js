import { createApp } from './app.js';
import { cleanup } from './store.js';

const port = Number(process.env.PORT) || 3000;
const app = createApp();

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Roblox AI Builder läuft auf http://0.0.0.0:${port}`);
});

const cleanupTimer = setInterval(cleanup, 60_000);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

function shutdown(signal) {
  console.log(`Signal ${signal} empfangen – Server wird beendet.`);
  clearInterval(cleanupTimer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
