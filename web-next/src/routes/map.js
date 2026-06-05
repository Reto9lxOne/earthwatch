import { fetchJsonWithCache } from '../lib/fetch-cache.js';
import { env } from '../config/env.js';
import { getDashboardSummary } from '../repositories/dashboard-repository.js';
import { listRecentEarthquakes } from '../repositories/earthquake-repository.js';
import { listRecentNaturalEvents, listRecentVolcanoes } from '../repositories/natural-event-repository.js';
import { listRecentSolarEvents } from '../repositories/solar-event-repository.js';
import { listRecentRadiation } from '../repositories/radiation-repository.js';

// ── Webcams (Windy + TfL + Caltrans) ────────────────────
let webcamCache = null;
let webcamCacheTs = 0;
const WEBCAM_TTL = 60 * 60 * 1000; // 60 min

async function fetchWindyWebcams() {
  if (!env.windyWebcamsKey) return [];
  const limit = 500;
  const pages = 4; // 2000 most-viewed cameras
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

  const [windy, tfl, caltrans] = await Promise.allSettled([
    fetchWindyWebcams(),
    fetchTflWebcams(),
    fetchCaltransWebcams(),
  ]);

  const all = [
    ...(windy.status === 'fulfilled' ? windy.value : []),
    ...(tfl.status === 'fulfilled' ? tfl.value : []),
    ...(caltrans.status === 'fulfilled' ? caltrans.value : []),
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
