import { fetchJsonWithCache } from '../lib/fetch-cache.js';
import { env } from '../config/env.js';
import { getDashboardSummary } from '../repositories/dashboard-repository.js';
import { listRecentEarthquakes } from '../repositories/earthquake-repository.js';
import { listRecentNaturalEvents, listRecentVolcanoes } from '../repositories/natural-event-repository.js';
import { listRecentSolarEvents } from '../repositories/solar-event-repository.js';
import { listRecentRadiation } from '../repositories/radiation-repository.js';

// ── NOAA CO₂ (Mauna Loa) ─────────────────────────────────
let co2Cache = null;
let co2CacheTs = 0;
const CO2_CACHE_TTL = 6 * 60 * 60 * 1000; // 6h

async function fetchCO2() {
  if (co2Cache && Date.now() - co2CacheTs < CO2_CACHE_TTL) return co2Cache;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(
      'https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_daily_mlo.txt',
      { signal: controller.signal }
    );
    if (!resp.ok) throw new Error(`NOAA CO₂ HTTP ${resp.status}`);
    const text = await resp.text();

    let latest = null;
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed) continue;
      const parts = trimmed.split(/\s+/);
      const ppm = parseFloat(parts[4]);
      if (isNaN(ppm) || ppm < 0) continue;
      latest = { year: +parts[0], month: +parts[1], day: +parts[2], ppm };
    }

    co2Cache = latest;
    co2CacheTs = Date.now();
    return latest;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Sea Surface Temperature (NOAA ERDDAP) ────────────────
let sstCache = null;
let sstCacheTs = 0;
const SST_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

async function fetchSST() {
  if (sstCache && Date.now() - sstCacheTs < SST_CACHE_TTL) return sstCache;

  // stride=40 on 0.25° dataset ≈ 10° effective grid, ~13k ocean points
  const url = 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/nesdisBLENDEDsstDNDaily.csv' +
    '?analysed_sst%5B(last)%5D%5B(-75):40:(75)%5D%5B(-180):40:(180)%5D';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const resp = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (!resp.ok) throw new Error(`ERDDAP SST HTTP ${resp.status}`);
    const text = await resp.text();

    const lines = text.trim().split('\n');
    const points = [];
    for (const line of lines.slice(2)) {
      if (!line) continue;
      const [, lat, lon, sst] = line.split(',');
      const temp = parseFloat(sst);
      if (isNaN(temp)) continue;
      points.push({ lat: parseFloat(lat), lon: parseFloat(lon), temp });
    }

    sstCache = points;
    sstCacheTs = Date.now();
    return points;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Country centroids for IODA outage layer ──────────────
const COUNTRY_CENTROIDS = {
  AF:[33,65],AL:[41,20],DZ:[28,3],AO:[-12,18],AR:[-34,-64],AM:[40,45],AU:[-25,134],AT:[47,14],AZ:[40,48],
  BS:[24,-76],BH:[26,51],BD:[24,90],BY:[53,28],BE:[51,4],BZ:[17,-89],BJ:[9,2],BO:[-17,-65],BA:[44,17],
  BW:[-22,24],BR:[-10,-55],BG:[43,25],BF:[13,-2],BI:[-3,30],CM:[6,12],CA:[60,-95],CV:[16,-24],CF:[7,21],
  TD:[15,19],CL:[-30,-71],CN:[35,105],CO:[4,-72],CD:[-4,25],CG:[-1,15],CR:[10,-84],CI:[7,-6],HR:[45,16],
  CU:[22,-80],CY:[35,33],CZ:[50,15],DK:[56,10],DO:[19,-71],EC:[-2,-77],EG:[27,30],SV:[14,-89],ET:[8,38],
  FI:[64,26],FR:[46,2],GA:[-1,12],GM:[13,-16],GE:[42,44],DE:[51,10],GH:[8,-1],GR:[39,22],GT:[15,-90],
  GN:[11,-11],HT:[19,-73],HN:[15,-87],HU:[47,20],IN:[20,77],ID:[-5,120],IQ:[33,44],IE:[53,-8],IL:[31,35],
  IT:[43,12],JM:[18,-77],JP:[36,138],JO:[31,36],KZ:[48,68],KE:[1,38],KW:[29,47],KG:[41,75],LA:[18,103],
  LB:[34,36],LY:[27,17],LT:[56,24],MG:[-20,47],MW:[-13,34],MY:[2,112],MV:[3,73],ML:[17,-4],MR:[20,-12],
  MX:[23,-102],MD:[47,29],MN:[46,105],MA:[32,-5],MZ:[-18,35],MM:[17,96],NA:[-22,17],NP:[28,84],NL:[52,5],
  NI:[13,-86],NE:[17,8],NG:[10,8],NO:[60,8],OM:[21,57],PK:[30,69],PA:[9,-80],PG:[-6,147],PY:[-23,-58],
  PE:[-10,-76],PH:[13,122],PL:[52,20],PT:[39,-8],QA:[25,51],RO:[46,25],RU:[60,100],RW:[-2,30],
  SA:[24,45],SN:[14,-14],RS:[44,21],SL:[8,-12],SO:[6,46],ZA:[-29,25],SS:[7,30],ES:[40,-4],LK:[7,81],
  SD:[15,30],SE:[62,15],CH:[47,8],SY:[35,38],TW:[24,121],TJ:[39,71],TZ:[-6,35],TH:[15,101],TG:[8,1],
  TN:[34,9],TR:[39,35],TM:[40,60],UG:[1,32],UA:[49,32],AE:[24,54],GB:[54,-2],US:[38,-97],UY:[-33,-56],
  UZ:[41,64],VE:[8,-66],VN:[16,108],VI:[18,-65],YE:[16,48],ZM:[-15,30],ZW:[-20,30],
  BZ:[17,-89],BW:[-22,24],CI:[7,-6],
};

// ── OpenSky Flights ───────────────────────────────────────
let flightCache = null;
let flightCacheTs = 0;
const FLIGHT_CACHE_TTL = 60 * 1000; // 60s

async function fetchFlights() {
  if (flightCache && Date.now() - flightCacheTs < FLIGHT_CACHE_TTL) return flightCache;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch('https://opensky-network.org/api/states/all', { signal: controller.signal });
    if (!resp.ok) throw new Error(`OpenSky HTTP ${resp.status}`);
    const data = await resp.json();

    const flights = (data.states ?? [])
      .filter(s => !s[8] && s[5] != null && s[6] != null) // airborne, has lat/lon
      .slice(0, 2000)
      .map(s => ({
        icao:     s[0],
        callsign: (s[1] || '').trim() || null,
        country:  s[2],
        lon:      s[5],
        lat:      s[6],
        altM:     s[7] != null ? Math.round(s[7]) : null,
        speedMs:  s[9] != null ? Math.round(s[9]) : null,
        heading:  s[10] != null ? Math.round(s[10]) : null,
      }));

    flightCache = flights;
    flightCacheTs = Date.now();
    return flights;
  } finally {
    clearTimeout(timeout);
  }
}

// ── NOAA Aurora Oval ─────────────────────────────────────
let auroraCache = null;
let auroraCacheTs = 0;
const AURORA_CACHE_TTL = 60 * 60 * 1000; // 60 min

async function fetchAurora() {
  if (auroraCache && Date.now() - auroraCacheTs < AURORA_CACHE_TTL) return auroraCache;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json', { signal: controller.signal });
    if (!resp.ok) throw new Error(`NOAA Aurora HTTP ${resp.status}`);
    const data = await resp.json();

    const points = (data.coordinates ?? [])
      .filter(c => c[2] >= 5) // probability >= 5%
      .map(c => ({ lon: c[0], lat: c[1], prob: c[2] }));

    const result = { observedAt: data['Observation Time'], forecastAt: data['Forecast Time'], points };
    auroraCache = result;
    auroraCacheTs = Date.now();
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

// ── IODA Internet Outages ─────────────────────────────────
let outageCache = null;
let outageCacheTs = 0;
const OUTAGE_CACHE_TTL = 15 * 60 * 1000; // 15 min

async function fetchOutages() {
  if (outageCache && Date.now() - outageCacheTs < OUTAGE_CACHE_TTL) return outageCache;

  const since = Math.floor((Date.now() - 48 * 3600 * 1000) / 1000);
  const until = Math.floor(Date.now() / 1000);
  const url = `https://api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts?from=${since}&until=${until}&limit=200&entityType=country`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`IODA HTTP ${resp.status}`);
    const data = await resp.json();

    // Keep only the latest critical alert per country
    const latest = new Map();
    for (const alert of (data.data ?? [])) {
      const code = alert.entity?.code?.toUpperCase();
      if (!code) continue;
      const existing = latest.get(code);
      if (!existing || alert.time > existing.time) latest.set(code, alert);
    }

    const outages = [];
    for (const [code, alert] of latest) {
      const centroid = COUNTRY_CENTROIDS[code];
      if (!centroid) continue;
      outages.push({
        code,
        name:    alert.entity?.name || code,
        level:   alert.level,
        source:  alert.datasource,
        time:    alert.time,
        lat:     centroid[0],
        lon:     centroid[1],
      });
    }

    outageCache = outages;
    outageCacheTs = Date.now();
    return outages;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Webcams (Windy + TfL + Caltrans) ────────────────────
let webcamCache = null;
let webcamCacheTs = 0;
const WEBCAM_TTL = 60 * 60 * 1000; // 60 min

async function fetchWindyWebcams() {
  if (!env.windyWebcamsKey) return [];
  const limit = 50;  // free tier max per request
  const pages = 2;   // 100 most-viewed cameras — enough for a global overview
  const results = [];

  for (let page = 0; page < pages; page++) {
    const url = `https://api.windy.com/webcams/api/v3/webcams?limit=${limit}&offset=${page * limit}&orderBy=popularity&include=location,images`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const resp = await fetch(url, {
        headers: { 'x-windy-api-key': env.windyWebcamsKey },
        signal: controller.signal,
      });
      if (!resp.ok) break;
      const data = await resp.json();
      const cams = data.webcams ?? [];
      if (!cams.length) break;

      for (const c of cams) {
        const loc = c.location;
        if (!loc?.latitude || !loc?.longitude) continue;
        results.push({
          id:       `windy-${c.webcamId}`,
          source:   'windy',
          name:     c.title,
          lat:      loc.latitude,
          lon:      loc.longitude,
          city:     loc.city || null,
          country:  loc.country_code || null,
          imageUrl: c.images?.current?.thumbnail || null,
        });
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  return results;
}

async function fetchTflWebcams() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch('https://api.tfl.gov.uk/Place/Type/JamCam', { signal: controller.signal });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data ?? []).map(cam => {
      const props = Object.fromEntries(
        (cam.additionalProperties ?? []).map(p => [p.key, p.value])
      );
      if (props.available !== 'true') return null;
      return {
        id:       cam.id,
        source:   'tfl',
        name:     cam.commonName,
        lat:      cam.lat,
        lon:      cam.lon,
        city:     'London',
        country:  'GB',
        imageUrl: props.imageUrl || null,
      };
    }).filter(Boolean);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCaltransWebcams() {
  const districts = ['d10', 'd11', 'd12'];
  const results = [];
  for (const d of districts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const resp = await fetch(
        `https://cwwp2.dot.ca.gov/data/${d}/cctv/cctvStatus${d.toUpperCase()}.json`,
        { signal: controller.signal }
      );
      if (!resp.ok) continue;
      const data = await resp.json();
      for (const entry of data.data ?? []) {
        const c = entry.cctv;
        const loc = c.location;
        if (!loc?.latitude || !loc?.longitude) continue;
        results.push({
          id:       `caltrans-${d}-${c.index}`,
          source:   'caltrans',
          name:     loc.locationName,
          lat:      parseFloat(loc.latitude),
          lon:      parseFloat(loc.longitude),
          city:     loc.nearbyPlace || null,
          country:  'US',
          imageUrl: c.imageData?.static?.currentImageURL || null,
        });
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  return results;
}

async function fetchAllWebcams() {
  if (webcamCache && Date.now() - webcamCacheTs < WEBCAM_TTL) return webcamCache;

  const [windy] = await Promise.allSettled([
    fetchWindyWebcams(),
  ]);

  const all = [
    ...(windy.status === 'fulfilled' ? windy.value : []),
  ];

  webcamCache = all;
  webcamCacheTs = Date.now();
  return all;
}

// ── OSM Nuclear Power Plants ─────────────────────────────
let nuclearPlantsCache = null;
let nuclearPlantsCacheTs = 0;
const NUCLEAR_PLANTS_TTL = 24 * 60 * 60 * 1000; // 24h

const OVERPASS_QUERY = '[out:json][timeout:30];(node["power"="plant"]["plant:source"="nuclear"];way["power"="plant"]["plant:source"="nuclear"];relation["power"="plant"]["plant:source"="nuclear"];);out center 500;';

async function fetchNuclearPlants() {
  if (nuclearPlantsCache && Date.now() - nuclearPlantsCacheTs < NUCLEAR_PLANTS_TTL) {
    return nuclearPlantsCache;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const resp = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'earthwatch/1.0 (homelab monitoring; contact via github)',
        'Accept': 'application/json',
      },
      body: 'data=' + encodeURIComponent(OVERPASS_QUERY),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status}`);
    const data = await resp.json();

    const plants = (data.elements ?? [])
      .map(el => {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (!lat || !lon) return null;
        const t = el.tags ?? {};
        return {
          id:       el.id,
          lat,
          lon,
          name:     t['name:en'] || t['name'] || 'Unknown',
          operator: t['operator'] || null,
          capacity: t['plant:output:electricity'] || null,
          started:  t['start_date'] ? t['start_date'].slice(0, 4) : null,
          wikidata: t['wikidata'] || null,
        };
      })
      .filter(Boolean);

    nuclearPlantsCache = plants;
    nuclearPlantsCacheTs = Date.now();
    return plants;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Open-Meteo Lightning Potential Grid ──────────────────
let lightningGridCache = null;
let lightningGridCacheTs = 0;
const LIGHTNING_GRID_TTL = 60 * 60 * 1000; // 60 min

function buildLightningGrid(step = 15) {
  const lats = [];
  const lons = [];
  for (let lat = -80; lat <= 80; lat += step) {
    for (let lon = -180; lon < 180; lon += step) {
      lats.push(lat);
      lons.push(lon);
    }
  }
  return { lats, lons };
}

async function fetchLightningPotentialGrid() {
  if (lightningGridCache && Date.now() - lightningGridCacheTs < LIGHTNING_GRID_TTL) {
    return lightningGridCache;
  }

  const { lats, lons } = buildLightningGrid(15);
  const batchSize = 150;
  const results = [];

  const now = new Date();
  // Open-Meteo returns times as "YYYY-MM-DDTHH:00" in UTC
  const currentHourStr = now.toISOString().slice(0, 13) + ':00';

  for (let i = 0; i < lats.length; i += batchSize) {
    const bLats = lats.slice(i, i + batchSize);
    const bLons = lons.slice(i, i + batchSize);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${bLats.join(',')}&longitude=${bLons.join(',')}&hourly=cape&forecast_days=1&timezone=UTC`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status}`);
      const data = await resp.json();

      const entries = Array.isArray(data) ? data : [data];
      for (const entry of entries) {
        const times = entry.hourly?.time ?? [];
        const values = entry.hourly?.cape ?? [];
        const idx = times.indexOf(currentHourStr);
        const value = idx >= 0 ? (values[idx] ?? 0) : 0;
        if (value > 500) {
          results.push({ lat: entry.latitude, lon: entry.longitude, value });
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  lightningGridCache = results;
  lightningGridCacheTs = Date.now();
  return results;
}

function toEarthquakeFeature(row) {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [Number(row.lon), Number(row.lat)],
    },
    properties: {
      eventId: row.event_id,
      magnitude: row.magnitude == null ? null : Number(row.magnitude),
      place: row.place,
      time: row.time instanceof Date ? row.time.toISOString() : row.time,
      depthKm: row.depth_km == null ? null : Number(row.depth_km),
      tsunami: row.tsunami,
      alert: row.alert,
      significance: row.significance,
      url: row.url,
    },
  };
}

function toNaturalEventFeature(row) {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [Number(row.lon), Number(row.lat)],
    },
    properties: {
      eventId: row.event_id,
      title: row.title,
      category: row.category,
      status: row.status,
      time: row.time instanceof Date ? row.time.toISOString() : row.time,
    },
  };
}

function toSolarEvent(row) {
  return {
    eventId: row.event_id,
    time: row.time instanceof Date ? row.time.toISOString() : row.time,
    eventType: row.event_type,
    classType: row.class_type,
    kpIndex: row.kp_index == null ? null : Number(row.kp_index),
    note: row.note,
  };
}

export async function mapRoutes(fastify) {
  fastify.get('/api/v1/map/summary', async () => {
    return {
      data: await getDashboardSummary(fastify.db),
      meta: {
        generatedAt: new Date().toISOString(),
      },
    };
  });

  fastify.get('/api/v1/map/layers/earthquakes', async (request) => {
    const rows = await listRecentEarthquakes(fastify.db, {
      limit: request.query.limit,
      sinceHours: request.query.sinceHours,
    });

    return {
      data: {
        type: 'FeatureCollection',
        features: rows
          .filter((row) => row.lat != null && row.lon != null)
          .map(toEarthquakeFeature),
      },
      meta: {
        layer: 'earthquakes',
        count: rows.length,
        generatedAt: new Date().toISOString(),
      },
    };
  });

  fastify.get('/api/v1/map/layers/natural-events', async (request) => {
    const rows = await listRecentNaturalEvents(fastify.db, {
      limit: request.query.limit,
    });

    return {
      data: {
        type: 'FeatureCollection',
        features: rows
          .filter((row) => row.lat != null && row.lon != null)
          .map(toNaturalEventFeature),
      },
      meta: {
        layer: 'natural-events',
        count: rows.length,
        generatedAt: new Date().toISOString(),
      },
    };
  });

  fastify.get('/api/v1/map/layers/volcanoes', async (request) => {
    const rows = await listRecentVolcanoes(fastify.db, {
      limit: request.query.limit,
    });

    return {
      data: {
        type: 'FeatureCollection',
        features: rows
          .filter((row) => row.lat != null && row.lon != null)
          .map(toNaturalEventFeature),
      },
      meta: {
        layer: 'volcanoes',
        count: rows.length,
        generatedAt: new Date().toISOString(),
      },
    };
  });

  fastify.get('/api/v1/map/layers/solar-events', async (request) => {
    const rows = await listRecentSolarEvents(fastify.db, {
      limit: request.query.limit,
    });

    return {
      data: rows.map(toSolarEvent),
      meta: {
        layer: 'solar-events',
        count: rows.length,
        generatedAt: new Date().toISOString(),
      },
    };
  });

  fastify.get('/api/v1/external/iss', async () => {
    const data = await fetchJsonWithCache('https://api.wheretheiss.at/v1/satellites/25544');
    return {
      data,
      meta: {
        generatedAt: new Date().toISOString(),
      },
    };
  });

  fastify.get('/api/v1/external/co2', async () => {
    const data = await fetchCO2();
    return { data, meta: { generatedAt: new Date().toISOString() } };
  });

  fastify.get('/api/v1/map/layers/sst', async () => {
    const points = await fetchSST();
    return {
      data: points,
      meta: { layer: 'sst', count: points.length, generatedAt: new Date().toISOString() },
    };
  });

  fastify.get('/api/v1/map/layers/flights', async () => {
    const flights = await fetchFlights();
    return {
      data: { type: 'FeatureCollection', features: flights.map(f => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
        properties: { icao: f.icao, callsign: f.callsign, country: f.country, altM: f.altM, speedMs: f.speedMs, heading: f.heading },
      }))},
      meta: { layer: 'flights', count: flights.length, generatedAt: new Date().toISOString() },
    };
  });

  fastify.get('/api/v1/map/layers/aurora', async () => {
    const data = await fetchAurora();
    return {
      data: data.points,
      meta: { layer: 'aurora', count: data.points.length, observedAt: data.observedAt, forecastAt: data.forecastAt, generatedAt: new Date().toISOString() },
    };
  });

  fastify.get('/api/v1/map/layers/internet-outages', async () => {
    const outages = await fetchOutages();
    return {
      data: { type: 'FeatureCollection', features: outages.map(o => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [o.lon, o.lat] },
        properties: { code: o.code, name: o.name, level: o.level, source: o.source, time: o.time },
      }))},
      meta: { layer: 'internet-outages', count: outages.length, generatedAt: new Date().toISOString() },
    };
  });

  fastify.get('/api/v1/map/layers/webcams', async () => {
    const cams = await fetchAllWebcams();
    const bySource = cams.reduce((acc, c) => {
      acc[c.source] = (acc[c.source] || 0) + 1;
      return acc;
    }, {});
    return {
      data: {
        type: 'FeatureCollection',
        features: cams.map(c => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
          properties: {
            id:       c.id,
            source:   c.source,
            name:     c.name,
            city:     c.city,
            country:  c.country,
            imageUrl: c.imageUrl,
          },
        })),
      },
      meta: { layer: 'webcams', count: cams.length, bySource, generatedAt: new Date().toISOString() },
    };
  });

  fastify.get('/api/v1/map/layers/radiation', async () => {
    const rows = await listRecentRadiation(fastify.db);
    return {
      data: {
        type: 'FeatureCollection',
        features: rows
          .filter(r => r.lat != null && r.lon != null)
          .map(r => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [Number(r.lon), Number(r.lat)] },
            properties: {
              source:    r.source,
              stationId: r.station_id,
              valueUsv:  Number(r.value_usv),
              time:      r.time instanceof Date ? r.time.toISOString() : r.time,
            },
          })),
      },
      meta: { layer: 'radiation', count: rows.length, generatedAt: new Date().toISOString() },
    };
  });

  fastify.get('/api/v1/map/layers/nuclear-plants', async () => {
    const plants = await fetchNuclearPlants();
    return {
      data: {
        type: 'FeatureCollection',
        features: plants.map(p => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          properties: {
            id:       p.id,
            name:     p.name,
            operator: p.operator,
            capacity: p.capacity,
            started:  p.started,
            wikidata: p.wikidata,
          },
        })),
      },
      meta: { layer: 'nuclear-plants', count: plants.length, generatedAt: new Date().toISOString() },
    };
  });

  fastify.get('/api/v1/lightning/potential', async () => {
    const data = await fetchLightningPotentialGrid();
    return {
      data,
      meta: {
        gridStep: 15,
        count: data.length,
        generatedAt: new Date().toISOString(),
      },
    };
  });

  fastify.get('/api/v1/external/noaa-alerts', async () => {
    const data = await fetchJsonWithCache(
      'https://api.weather.gov/alerts/active?status=actual&message_type=alert&urgency=Immediate,Expected&severity=Extreme,Severe',
      { ttlMs: 5 * 60 * 1000 }
    );

    return {
      data: (data.features ?? []).slice(0, 20),
      meta: {
        generatedAt: new Date().toISOString(),
      },
    };
  });
}
