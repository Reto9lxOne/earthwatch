import { fetchJsonWithCache } from '../lib/fetch-cache.js';
import { getDashboardSummary } from '../repositories/dashboard-repository.js';
import { listRecentEarthquakes } from '../repositories/earthquake-repository.js';
import { listRecentNaturalEvents, listRecentVolcanoes } from '../repositories/natural-event-repository.js';
import { listRecentSolarEvents } from '../repositories/solar-event-repository.js';

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
