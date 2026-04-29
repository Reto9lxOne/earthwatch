const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function normalizeLimit(limit) {
  if (limit == null) return DEFAULT_LIMIT;

  const parsed = Number.parseInt(limit, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return DEFAULT_LIMIT;
  }

  return Math.min(parsed, MAX_LIMIT);
}

export async function listRecentNaturalEvents(db, options = {}) {
  const limit = normalizeLimit(options.limit);
  const result = await db.query(
    `SELECT
       time,
       event_id,
       title,
       category,
       status,
       lat,
       lon
     FROM natural_events
     WHERE time >= NOW() - INTERVAL '30 days'
     ORDER BY time DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows;
}
