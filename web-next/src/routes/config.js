import { env } from '../config/env.js';

export async function configRoutes(fastify) {
  fastify.get('/api/config', async (_request, reply) => {
    return reply.send({ cesiumIonToken: env.cesiumIonToken, stadiaApiKey: env.stadiaApiKey });
  });
}
