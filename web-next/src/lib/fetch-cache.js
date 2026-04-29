import { env } from '../config/env.js';

const cache = new Map();

export async function fetchJsonWithCache(url, options = {}) {
  const ttlMs = options.ttlMs ?? env.externalCacheTtlMs;
  const now = Date.now();
  const cached = cache.get(url);

  if (cached && now - cached.createdAt < ttlMs) {
    return cached.value;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.requestTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/geo+json, application/json;q=0.9, */*;q=0.1',
        'user-agent': 'earthwatch-web-next/1.0',
        ...(options.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`upstream request failed with status ${response.status}`);
    }

    const value = await response.json();
    cache.set(url, { createdAt: now, value });
    return value;
  } finally {
    clearTimeout(timeout);
  }
}
