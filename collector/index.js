import pg from 'pg';
import cron from 'node-cron';
import fetch from 'node-fetch';

const { Pool } = pg;

// ── DB Connection ────────────────────────────────────────
const db = new Pool({
  host:     process.env.DB_HOST     || 'timescaledb',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'earthwatch',
  user:     process.env.DB_USER     || 'earthwatch',
  password: process.env.DB_PASSWORD,
});

const NASA_KEY      = process.env.NASA_API_KEY || 'DEMO_KEY';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MINUTES || '5');

console.log(`🌍 Earthwatch Collector starting — poll every ${POLL_INTERVAL} min`);

// ── Helpers ──────────────────────────────────────────────
async function logRun(source, records, durationMs, success, error = null) {
  await db.query(
    `INSERT INTO collector_runs (source, records, duration_ms, success, error)
     VALUES ($1, $2, $3, $4, $5)`,
    [source, records, durationMs, success, error]
  );
}

async function safeFetch(url) {
  const r = await fetch(url, { timeout: 15000 });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  return r.json();
}

// ── USGS Earthquakes ─────────────────────────────────────
async function collectEarthquakes() {
  const start = Date.now();
  try {
    const data = await safeFetch(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson'
    );
    const features = data.features || [];
    let inserted = 0;

    for (const f of features) {
      const p = f.properties;
      const [lon, lat, depth] = f.geometry.coordinates;
      const time = new Date(p.time);

      await db.query(
        `INSERT INTO earthquakes
           (time, event_id, magnitude, place, lat, lon, depth_km, tsunami, alert, significance, url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (time, event_id) DO NOTHING`,
        [time, f.id, p.mag, p.place, lat, lon, depth / 1000,
         p.tsunami === 1, p.alert, p.sig, p.url]
      );
      inserted++;
    }

    const ms = Date.now() - start;
    await logRun('usgs_earthquakes', inserted, ms, true);
    console.log(`✅ Earthquakes: ${inserted} records (${ms}ms)`);
  } catch (e) {
    await logRun('usgs_earthquakes', 0, Date.now() - start, false, e.message);
    console.error('❌ Earthquakes failed:', e.message);
  }
}

// ── NASA EONET ───────────────────────────────────────────
async function collectEonet() {
  const start = Date.now();
  try {
    const data = await safeFetch(
      'https://eonet.gsfc.nasa.gov/api/v3/events?limit=200&days=2&status=all'
    );
    const events = data.events || [];
    let inserted = 0;

    for (const ev of events) {
      const geo = ev.geometry;
      if (!geo?.length) continue;
      const latest = geo[geo.length - 1];
      const [lon, lat] = latest.coordinates;
      const time = new Date(latest.date);
      const category = ev.categories?.[0]?.id || 'other';
      const status   = ev.closed ? 'closed' : 'open';

      await db.query(
        `INSERT INTO natural_events (time, event_id, title, category, status, lat, lon)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (time, event_id) DO UPDATE
           SET status = EXCLUDED.status`,
        [time, ev.id, ev.title, category, status, lat, lon]
      );
      inserted++;
    }

    const ms = Date.now() - start;
    await logRun('nasa_eonet', inserted, ms, true);
    console.log(`✅ EONET: ${inserted} records (${ms}ms)`);
  } catch (e) {
    await logRun('nasa_eonet', 0, Date.now() - start, false, e.message);
    console.error('❌ EONET failed:', e.message);
  }
}

// ── OpenAQ Air Quality ───────────────────────────────────
async function collectAirQuality() {
  const start = Date.now();
  try {
    const data = await safeFetch(
      'https://api.openaq.org/v3/measurements?limit=200&parameters_id=2&has_geo=true&order_by=datetime&sort=desc'
    );
    const results = data.results || [];
    let inserted = 0;

    for (const loc of results) {
      const { latitude, longitude } = loc.coordinates || {};
      if (!latitude || !longitude) continue;

      for (const m of loc.measurements || []) {
        const time = new Date(m.lastUpdated);
        await db.query(
          `INSERT INTO air_quality
             (time, station_id, station_name, city, country, lat, lon, parameter, value, unit)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (time, station_id, parameter) DO NOTHING`,
          [time, String(loc.id), loc.name, loc.city, loc.country,
           latitude, longitude, m.parameter, m.value, m.unit]
        );
        inserted++;
      }
    }

    const ms = Date.now() - start;
    await logRun('openaq', inserted, ms, true);
    console.log(`✅ Air Quality: ${inserted} records (${ms}ms)`);
  } catch (e) {
    await logRun('openaq', 0, Date.now() - start, false, e.message);
    console.error('❌ Air Quality failed:', e.message);
  }
}

// ── NASA DONKI Solar Events ──────────────────────────────
async function collectSolar() {
  const start = Date.now();
  try {
    const end   = new Date().toISOString().slice(0, 10);
    const begin = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
    const types = ['CME', 'FLR', 'GST', 'SEP'];
    let inserted = 0;

    for (const type of types) {
      const url  = `https://api.nasa.gov/DONKI/${type}?startDate=${begin}&endDate=${end}&api_key=${NASA_KEY}`;
      const data = await safeFetch(url);
      if (!Array.isArray(data)) continue;

      for (const ev of data) {
        const time = new Date(ev.beginTime || ev.startTime || ev.eventTime);
        if (isNaN(time)) continue;

        const eventId  = ev.activityID || ev.flrID || ev.gstID || ev.sepID || `${type}-${time.getTime()}`;
        const classType = ev.classType || null;
        const kpIndex  = ev.allKpIndex?.[0]?.kpIndex || null;
        const note     = ev.note || ev.instruments?.[0]?.displayName || null;

        await db.query(
          `INSERT INTO solar_events (time, event_id, event_type, class_type, kp_index, note)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (time, event_id) DO NOTHING`,
          [time, eventId, type, classType, kpIndex, note]
        );
        inserted++;
      }
    }

    const ms = Date.now() - start;
    await logRun('nasa_donki', inserted, ms, true);
    console.log(`✅ Solar: ${inserted} records (${ms}ms)`);
  } catch (e) {
    await logRun('nasa_donki', 0, Date.now() - start, false, e.message);
    console.error('❌ Solar failed:', e.message);
  }
}

// ── Safecast Radiation ───────────────────────────────────
async function collectRadiation() {
  const start = Date.now();
  try {
    let inserted = 0;
    for (let page = 1; page <= 20; page++) {
      const data = await safeFetch(
        `https://api.safecast.org/measurements.json?unit=usv&order=captured_at&sort=desc&limit=100&page=${page}`
      );
      if (!Array.isArray(data) || !data.length) break;

      for (const m of data) {
        if (!m.latitude || !m.longitude || !m.value || !m.captured_at) continue;
        const time      = new Date(m.captured_at);
        const stationId = m.device_id ? `device-${m.device_id}` : `pos-${Math.round(m.latitude * 10)}-${Math.round(m.longitude * 10)}`;

        await db.query(
          `INSERT INTO radiation_measurements (time, source, station_id, lat, lon, value_usv)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (time, source, station_id) DO NOTHING`,
          [time, 'safecast', stationId, m.latitude, m.longitude, m.value]
        );
        inserted++;
      }
    }

    await logRun('safecast_radiation', inserted, Date.now() - start, true);
    console.log(`✅ Radiation: ${inserted} records`);
  } catch (e) {
    await logRun('safecast_radiation', 0, Date.now() - start, false, e.message);
    console.error('❌ Radiation failed:', e.message);
  }
}

// ── Run all collectors ───────────────────────────────────
async function runAll() {
  console.log(`\n🔄 [${new Date().toISOString()}] Running all collectors...`);
  await Promise.allSettled([
    collectEarthquakes(),
    collectEonet(),
    collectSolar(),
  ]);
  // AQ after to avoid hammering APIs simultaneously
  // AQ temporarily disabled — openaq.org account issues  
  // await collectAirQuality();
  console.log('✅ All collectors done\n');
}

// ── Wait for DB then start ───────────────────────────────
async function start() {
  // Wait for DB to be ready
  for (let i = 0; i < 30; i++) {
    try {
      await db.query('SELECT 1');
      console.log('✅ Database connected');
      break;
    } catch {
      console.log(`⏳ Waiting for database... (${i + 1}/30)`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Run immediately on start
  await runAll();
  await collectRadiation();

  // Then on schedule
  cron.schedule(`*/${POLL_INTERVAL} * * * *`, runAll);
  cron.schedule('0 */4 * * *', collectRadiation);
  console.log(`⏱  Scheduled every ${POLL_INTERVAL} minutes (radiation every 4h)`);
}

start().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
