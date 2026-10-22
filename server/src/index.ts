import { startServer } from './start.js';

const running = await startServer();
const { config, port } = running;
console.info(`soundFy server: http://localhost:${port}`);
console.info(`Данные: ${config.dataDir}`);
if (config.syncIntervalMinutes > 0) {
  console.info(`Синхронизация артистов каждые ${config.syncIntervalMinutes} мин.`);
}

function shutdown() {
  running.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
