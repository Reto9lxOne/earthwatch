export async function listRecentRadiation(db) {
  // Latest measurement per ~1° grid cell from the last 7 days
  const result = await db.query(
    `SELECT DISTINCT ON (round(lat::numeric, 0), round(lon::numeric, 0))
       time, source, station_id,
       lat, lon, value_usv
     FROM radiation_measurements
     WHERE time >= NOW() - INTERVAL '7 days'
     ORDER BY round(lat::numeric, 0), round(lon::numeric, 0), time DESC
     LIMIT 500`
  );
  return result.rows;
}
