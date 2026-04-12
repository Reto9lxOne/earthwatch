import http from 'http';
import https from 'https';
import { WebSocket, WebSocketServer } from 'ws';

const PORT = process.env.PORT || 3000;
const AIS_TOKEN = process.env.AISSTREAM_TOKEN || '';

// ── REST Routes (ADSB) ───────────────────────────────────
const ROUTES = {
  '/adsb/': {
    target: 'http://api.airplanes.live/v2/point/47/8/2000',
    ttl: 30,
  },
};

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

// ── AIS Ship State ───────────────────────────────────────
const shipState = new Map();
const MAX_SHIPS = 2000;
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
  if (!AIS_TOKEN) {
    console.warn('No AISSTREAM_TOKEN — ship tracking disabled');
    return;
  }
  console.log('Connecting to aisstream.io...');
  aisWs = new WebSocket('wss://stream.aisstream.io/v0/stream');

  aisWs.on('open', () => {
    console.log('AIS stream connected');
    aisWs.send(JSON.stringify({
      APIKey: AIS_TOKEN,
      MessageTypes: ['PositionReport', 'ShipStaticData'],
      BoundingBoxes: [[[-90, -180], [90, 180]]],
    }));
  });

  aisWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const mtype = msg.MessageType;
      const meta = msg.MetaData;
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

  aisWs.on('close', () => {
    console.warn('AIS stream closed — reconnecting in 10s');
    setTimeout(connectAIS, 10000);
  });
  aisWs.on('error', (e) => console.error('AIS error:', e.message));
}

// ── HTTP Server ──────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/ships/snapshot') {
    const ships = [...shipState.values()].filter(s => s.lat && s.lon);
    res.writeHead(200);
    res.end(JSON.stringify({ count: ships.length, ships }));
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({
      adsb: 'ok',
      ais: aisWs?.readyState === WebSocket.OPEN ? 'connected' : 'disconnected',
      ships: shipState.size,
    }));
    return;
  }

  const route = Object.keys(ROUTES).find(r => req.url.startsWith(r));
  if (!route) { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return; }

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
    console.error(`Proxy error ${route}:`, e.message);
    res.writeHead(502);
    res.end(JSON.stringify({ error: e.message }));
  }
});

// ── WebSocket for Dashboard Clients ──────────────────────
const wss = new WebSocketServer({ server, path: '/ws/ships' });

wss.on('connection', (ws) => {
  dashClients.add(ws);
  const ships = [...shipState.values()].filter(s => s.lat && s.lon);
  ws.send(JSON.stringify({ type: 'snapshot', ships }));
  ws.on('close', () => dashClients.delete(ws));
  ws.on('error', () => dashClients.delete(ws));
});

server.listen(PORT, () => {
  console.log(`Earthwatch Proxy :${PORT} | ADSB /adsb/ | Ships /ws/ships`);
  connectAIS();
});
