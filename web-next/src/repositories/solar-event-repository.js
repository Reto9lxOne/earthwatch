const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 200;

function normalizeLimit(limit) {
  if (limit == null) return DEFAULT_LIMIT;

  const parsed = Number.parseInt(limit, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return DEFAULT_LIMIT;
  }

  return Math.min(parsed, MAX_LIMIT);
}

export async function listRecentSolarEvents(db, options = {}) {
  const limit = normalizeLimit(options.limit);
  const result = await db.query(
    `SELECT
       time,
       event_id,
       event_type,
       class_type,
       kp_index,
       note
     FROM solar_events
     WHERE time >= NOW() - INTERVAL '7 days'
     ORDER BY time DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows;
}
