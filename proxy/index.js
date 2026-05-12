import http from 'http';
import https from 'https';
import { WebSocket, WebSocketServer } from 'ws';

const PORT = process.env.PORT || 3000;
const AIS_TOKEN = process.env.AISSTREAM_TOKEN || '';
const NASA_KEY  = process.env.NASA_API_KEY || 'DEMO_KEY';

// ── REST Routes ──────────────────────────────────────────
const cache = new Map();

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { timeout: 20000 }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from upstream')); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('Upstream timeout')));
  });
}

// ── Satellite TLE (via tle.ivanstanojevic.me) ────────────
const TLE_APIS = {
  starlink: ['https://tle.ivanstanojevic.me/api/tle/?search=starlink&page-size=100'],
  weather:  ['https://tle.ivanstanojevic.me/api/tle/?search=noaa&page-size=50',
             'https://tle.ivanstanojevic.me/api/tle/?search=goes&page-size=20',
             'https://tle.ivanstanojevic.me/api/tle/?search=metop&page-size=20'],
  stations: ['https://tle.ivanstanojevic.me/api/tle/25544',   // ISS
             'https://tle.ivanstanojevic.me/api/tle/48274'],  // Tiangong
};
const tleCache = new Map();

function parseTLEResponse(data) {
  if (data.line1 && data.line2) return [{ name: data.name?.trim() || 'Unknown', tle1: data.line1, tle2: data.line2 }];
  return (data.member || []).map(m => ({ name: m.name?.trim() || 'Unknown', tle1: m.line1, tle2: m.line2 }));
}

// ── AIS Ship State ───────────────────────────────────────
const shipState = new Map();
const MAX_SHIPS = 500;
const dashClients = new Set();

function broadcastShip(vessel) {
  const msg = JSON.stringify({ type: 'ship', data: vessel });
  dashClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

// ── AIS Upstream Connection ──────────────────────────────
let aisWs = null;

function connectAIS() {
  if (!AIS_TOKEN) { console.warn('No AISSTREAM_TOKEN — ship tracking disabled'); return; }
  console.log('Connecting to aisstream.io...');
  aisWs = new WebSocket('wss://stream.aisstream.io/v0/stream');

  aisWs.on('open', () => {
    console.log('AIS stream connected');
    aisWs.send(JSON.stringify({
      APIKey: AIS_TOKEN,
      MessageTypes: ['PositionReport', 'ShipStaticData'],
      BoundingBoxes: [[[30, -15], [65, 35]]], // Europe
    }));
  });

  aisWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const mtype = msg.MessageType;
      const meta  = msg.MetaData;
      if (!meta) return;
      const mmsi = String(meta.MMSI);

      if (mtype === 'PositionReport') {
        const p = msg.Message?.PositionReport;
        if (!p) return;
        const existing = shipState.get(mmsi) || {};
        const vessel = {
          ...existing, mmsi,
          lat: meta.latitude, lon: meta.longitude,
          cog: p.Cog, sog: p.Sog, heading: p.TrueHeading,
          navStatus: p.NavigationalStatus, ts: Date.now(),
        };
        shipState.set(mmsi, vessel);
        if (shipState.size > MAX_SHIPS) {
          const oldest = [...shipState.entries()].sort((a,b)=>a[1].ts-b[1].ts)[0];
          shipState.delete(oldest[0]);
        }
        broadcastShip(vessel);

      } else if (mtype === 'ShipStaticData') {
        const s = msg.Message?.ShipStaticData;
        if (!s) return;
        const existing = shipState.get(mmsi) || { mmsi };
        shipState.set(mmsi, {
          ...existing,
          name: s.Name?.trim() || existing.name,
          shipType: s.Type,
          destination: s.Destination?.trim(),
          callsign: s.CallSign?.trim(),
          ts: existing.ts || Date.now(),
        });
      }
    } catch {}
  });

  aisWs.on('close', () => { console.warn('AIS closed — reconnecting in 10s'); setTimeout(connectAIS, 10000); });
  aisWs.on('error', (e) => console.error('AIS error:', e.message));
}

// ── HTTP Server ──────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({
      adsb: 'removed',
      ais: aisWs?.readyState === WebSocket.OPEN ? 'connected' : 'disconnected',
      ships: shipState.size,
    }));
    return;
  }

  // Ships snapshot
  if (req.url === '/ships/snapshot') {
    const ships = [...shipState.values()].filter(s => s.lat != null && s.lon != null);
    res.writeHead(200);
    res.end(JSON.stringify({ count: ships.length, ships }));
    return;
  }

  // Satellite TLE data
  if (req.url.startsWith('/satellites/')) {
    const group = req.url.replace('/satellites/', '').split('?')[0];
    if (!TLE_APIS[group]) { res.writeHead(404); res.end(JSON.stringify({ error: 'Unknown group' })); return; }
    const cached = tleCache.get(group);
    if (cached && Date.now() - cached.ts < 3600000) {
      res.writeHead(200, { 'X-Cache': 'HIT' }); res.end(JSON.stringify(cached.data)); return;
    }
    try {
      const results = await Promise.all(TLE_APIS[group].map(u => fetchUrl(u)));
      const sats = results.flatMap(parseTLEResponse);
      tleCache.set(group, { data: sats, ts: Date.now() });
      res.writeHead(200, { 'X-Cache': 'MISS' }); res.end(JSON.stringify(sats));
    } catch (e) {
      console.error('TLE fetch error:', e.message);
      res.writeHead(502); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // NASA DONKI proxy — key stays on server
  // Route: /donki/CME?startDate=...&endDate=...
  if (req.url.startsWith('/donki/')) {
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      const type   = urlObj.pathname.replace('/donki/', '');
      const params = urlObj.searchParams;
      params.set('api_key', NASA_KEY);
      const nasaUrl = `https://api.nasa.gov/DONKI/${type}?${params.toString()}`;

      const cacheKey = nasaUrl;
      const cached = cache.get(cacheKey);
      if (cached && Date.now() - cached.ts < 300000) { // 5min cache
        res.writeHead(200, { 'X-Cache': 'HIT' });
        res.end(JSON.stringify(cached.data));
        return;
      }

      const data = await fetchUrl(nasaUrl);
      cache.set(cacheKey, { data, ts: Date.now() });
      res.writeHead(200, { 'X-Cache': 'MISS' });
      res.end(JSON.stringify(data));
    } catch (e) {
      console.error('DONKI proxy error:', e.message);
      res.writeHead(502);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ── WebSocket for Dashboard ───────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws/ships' });

wss.on('connection', (ws) => {
  dashClients.add(ws);
  console.log(`Dashboard client connected (${dashClients.size} total)`);
  // Send snapshot immediately
  const ships = [...shipState.values()].filter(s => s.lat != null && s.lon != null);
  ws.send(JSON.stringify({ type: 'snapshot', ships }));
  ws.on('close', () => { dashClients.delete(ws); });
  ws.on('error', () => { dashClients.delete(ws); });
});

server.listen(PORT, () => {
  console.log(`Earthwatch Proxy :${PORT}`);
  console.log(`  Ships WS:  /ws/ships`);
  console.log(`  Ships REST: /ships/snapshot`);
  console.log(`  DONKI:     /donki/{type}?startDate=...&endDate=...`);
  console.log(`  Health:    /health`);
  connectAIS();
});
