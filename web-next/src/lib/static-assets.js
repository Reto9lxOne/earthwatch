import fs from 'fs/promises';
import path from 'path';

import { env } from '../config/env.js';

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

function resolveAssetPath(assetPath) {
  const cleanPath = assetPath.replace(/^\/+/, '');
  const absolutePath = path.resolve(env.publicDir, cleanPath);

  if (!absolutePath.startsWith(env.publicDir)) {
    throw new Error('invalid asset path');
  }

  return absolutePath;
}

export async function readPublicFile(assetPath) {
  const absolutePath = resolveAssetPath(assetPath);
  const body = await fs.readFile(absolutePath);
  const extension = path.extname(absolutePath);

  return {
    body,
    contentType: CONTENT_TYPES.get(extension) ?? 'application/octet-stream',
  };
}
