import { readPublicFile } from '../lib/static-assets.js';

export async function dashboardRoutes(fastify) {
  fastify.get('/', async (request, reply) => {
    const file = await readPublicFile('index.html');
    reply
      .type(file.contentType)
      .header('cache-control', 'no-store')
      .send(file.body);
  });

  fastify.get('/assets/:name', async (request, reply) => {
    const file = await readPublicFile(`assets/${request.params.name}`);
    reply
      .type(file.contentType)
      .header('cache-control', 'public, max-age=3600')
      .send(file.body);
  });
}
