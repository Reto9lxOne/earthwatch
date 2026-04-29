import { buildApp } from './app.js';
import { env } from './config/env.js';

const app = buildApp();

async function start() {
  try {
    await app.listen({ host: env.host, port: env.port });
    app.log.info(
      {
        host: env.host,
        port: env.port,
        nodeEnv: env.nodeEnv,
      },
      'earthwatch-web-next started'
    );
  } catch (error) {
    app.log.error({ err: error }, 'failed to start earthwatch-web-next');
    process.exit(1);
  }
}

start();
