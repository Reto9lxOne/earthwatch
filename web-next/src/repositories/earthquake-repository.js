const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 1000;

function normalizeLimit(limit) {
  if (limit == null) return DEFAULT_LIMIT;

  const parsed = Number.parseInt(limit, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return DEFAULT_LIMIT;
  }

  return Math.min(parsed, MAX_LIMIT);
}

function normalizeHours(hours) {
  if (hours == null) return 24;

  const parsed = Number.parseInt(hours, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return 24;
  }

  return Math.min(parsed, 24 * 30);
}

export async function listRecentEarthquakes(db, options = {}) {
  const limit = normalizeLimit(options.limit);
  const sinceHours = normalizeHours(options.sinceHours);

  const result = await db.query(
    `SELECT
       time,
       event_id,
       magnitude,
       place,
       lat,
       lon,
       depth_km,
       tsunami,
       alert,
       significance,
       url
     FROM earthquakes
     WHERE time >= NOW() - ($1::int * INTERVAL '1 hour')
     ORDER BY time DESC
     LIMIT $2`,
    [sinceHours, limit]
  );

  return result.rows;
}
