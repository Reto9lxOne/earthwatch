import http from 'http';
import https from 'https';

const PORT = process.env.PORT || 3000;

const ROUTES = {
  '/adsb/': {
    // airplanes.live — no account needed, just HTTP
    target: 'http://api.airplanes.live/v2/point/47/8/2000',
    ttl: 30, // cache seconds
  },
};

// Simple in-memory cache
const cache = new Map();

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { timeout: 10000 }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from upstream')); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('Upstream timeout')));
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const route = Object.keys(ROUTES).find(r => req.url.startsWith(r));
  if (!route) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Unknown route' }));
    return;
  }

  const cfg = ROUTES[route];
  const cached = cache.get(route);
  if (cached && Date.now() - cached.ts < cfg.ttl * 1000) {
    res.writeHead(200, { 'X-Cache': 'HIT' });
    res.end(JSON.stringify(cached.data));
    return;
  }

  try {
    const data = await fetchUrl(cfg.target);
    cache.set(route, { data, ts: Date.now() });
    res.writeHead(200, { 'X-Cache': 'MISS' });
    res.end(JSON.stringify(data));
  } catch (e) {
    console.error(`Proxy error for ${route}:`, e.message);
    res.writeHead(502);
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => console.log(`🛫 ADSB Proxy running on :${PORT}`));
