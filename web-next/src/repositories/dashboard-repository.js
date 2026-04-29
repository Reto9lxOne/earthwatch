export async function getDashboardSummary(db) {
  const result = await db.query(
    `WITH
      earthquake_stats AS (
        SELECT
          COUNT(*)::int AS count_24h,
          MAX(magnitude) AS max_magnitude
        FROM earthquakes
        WHERE time >= NOW() - INTERVAL '24 hours'
      ),
      strongest_quake AS (
        SELECT place
        FROM earthquakes
        WHERE time >= NOW() - INTERVAL '24 hours'
        ORDER BY magnitude DESC NULLS LAST, time DESC
        LIMIT 1
      ),
      natural_event_stats AS (
        SELECT
          COUNT(*)::int AS count_30d,
          COUNT(*) FILTER (WHERE category = 'wildfires')::int AS wildfires,
          COUNT(*) FILTER (WHERE category = 'severeStorms')::int AS severe_storms,
          COUNT(*) FILTER (WHERE category = 'volcanoes')::int AS volcanoes
        FROM natural_events
        WHERE time >= NOW() - INTERVAL '30 days'
      ),
      solar_stats AS (
        SELECT COUNT(*)::int AS count_7d
        FROM solar_events
        WHERE time >= NOW() - INTERVAL '7 days'
      ),
      collector_stats AS (
        SELECT
          source,
          MAX(time) AS last_run_at,
          BOOL_OR(success) FILTER (WHERE time >= NOW() - INTERVAL '30 minutes') AS healthy
        FROM collector_runs
        GROUP BY source
      )
    SELECT json_build_object(
      'earthquakes24h', earthquake_stats.count_24h,
      'maxMagnitude24h', earthquake_stats.max_magnitude,
      'strongestEarthquakePlace', COALESCE((SELECT place FROM strongest_quake), ''),
      'naturalEvents30d', natural_event_stats.count_30d,
      'wildfires30d', natural_event_stats.wildfires,
      'severeStorms30d', natural_event_stats.severe_storms,
      'volcanoes30d', natural_event_stats.volcanoes,
      'solarEvents7d', solar_stats.count_7d,
      'collectorRuns', COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'source', source,
              'lastRunAt', last_run_at,
              'healthy', COALESCE(healthy, false)
            )
            ORDER BY source
          )
          FROM collector_stats
        ),
        '[]'::json
      )
    ) AS summary
    FROM earthquake_stats, natural_event_stats, solar_stats`
  );

  return result.rows[0]?.summary ?? {};
}
