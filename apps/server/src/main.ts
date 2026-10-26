import { loadConfig } from './config.ts';
import { createHttpServer } from './http.ts';
import { createLogger } from './logger.ts';

const config = loadConfig();
const logger = createLogger(config);
const server = createHttpServer({ version: process.env.npm_package_version ?? '0.0.0', logger });

server.listen(config.PORT, config.HOST, () => {
  logger.info({ host: config.HOST, port: config.PORT, env: config.NODE_ENV }, 'server listening');
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  server.close((err) => {
    if (err) logger.error({ err }, 'error during shutdown');
    process.exit(err ? 1 : 0);
  });
  server.closeIdleConnections();
  setTimeout(() => {
    logger.warn('forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
