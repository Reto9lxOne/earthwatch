export async function healthRoutes(fastify) {
  fastify.get('/health', async (request, reply) => {
    let database = 'ok';

    try {
      await fastify.db.query('SELECT 1');
    } catch (error) {
      database = 'error';
      fastify.log.error({ err: error }, 'database health check failed');
    }

    const payload = {
      status: database === 'ok' ? 'ok' : 'degraded',
      service: 'earthwatch-web-next',
      database,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };

    if (database !== 'ok') {
      reply.code(503);
    }

    return payload;
  });
}
