import fp from 'fastify-plugin';
import pg from 'pg';

import { env } from '../config/env.js';

const { Pool } = pg;

export const dbPlugin = fp(async function dbPlugin(fastify) {
  const pool = new Pool({
    host: env.dbHost,
    port: env.dbPort,
    database: env.dbName,
    user: env.dbUser,
    password: env.dbPassword,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  fastify.decorate('db', pool);

  fastify.addHook('onClose', async () => {
    await pool.end();
  });
});
