import Fastify from 'fastify';

import { env } from './config/env.js';
import { dbPlugin } from './plugins/db.js';
import { configRoutes } from './routes/config.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { healthRoutes } from './routes/health.js';
import { mapRoutes } from './routes/map.js';

function buildLoggerOptions() {
  if (env.nodeEnv === 'production') {
    return {
      level: env.logLevel,
      serializers: {
        req(request) {
          return {
            id: request.id,
            method: request.method,
            url: request.url,
            hostname: request.hostname,
            remoteAddress: request.ip,
          };
        },
      },
    };
  }

  return {
    level: env.logLevel,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
      },
    },
  };
}

export function buildApp() {
  const app = Fastify({
    logger: buildLoggerOptions(),
    trustProxy: true,
  });

  app.register(dbPlugin);
  app.register(configRoutes);
  app.register(dashboardRoutes);
  app.register(healthRoutes);
  app.register(mapRoutes);

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'request failed');
    reply.status(error.statusCode ?? 500).send({
      error: 'internal_server_error',
      message: 'The request could not be completed.',
    });
  });

  return app;
}
