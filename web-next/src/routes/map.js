import { fetchJsonWithCache } from '../lib/fetch-cache.js';
import { getDashboardSummary } from '../repositories/dashboard-repository.js';
import { listRecentEarthquakes } from '../repositories/earthquake-repository.js';
import { listRecentNaturalEvents, listRecentVolcanoes } from '../repositories/natural-event-repository.js';
import { listRecentSolarEvents } from '../repositories/solar-event-repository.js';

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
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${bLats.join(',')}&longitude=${bLons.join(',')}&hourly=lightning_potential&forecast_days=1&timezone=UTC`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status}`);
      const data = await resp.json();

      const entries = Array.isArray(data) ? data : [data];
      for (const entry of entries) {
        const times = entry.hourly?.time ?? [];
        const values = entry.hourly?.lightning_potential ?? [];
        const idx = times.indexOf(currentHourStr);
        const value = idx >= 0 ? (values[idx] ?? 0) : 0;
        if (value > 0) {
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
