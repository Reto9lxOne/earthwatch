-- ═══════════════════════════════════════════════════════
-- EARTHWATCH — TimescaleDB Schema
-- ═══════════════════════════════════════════════════════

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ── Earthquakes (USGS) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS earthquakes (
    time        TIMESTAMPTZ     NOT NULL,
    event_id    TEXT            NOT NULL,
    magnitude   DECIMAL(4,2),
    place       TEXT,
    lat         DECIMAL(9,6),
    lon         DECIMAL(9,6),
    depth_km    DECIMAL(8,3),
    tsunami     BOOLEAN         DEFAULT FALSE,
    alert       TEXT,           -- green/yellow/orange/red
    significance INTEGER,
    url         TEXT,
    UNIQUE (time, event_id)
);
SELECT create_hypertable('earthquakes', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_earthquakes_magnitude ON earthquakes (magnitude DESC, time DESC);
CREATE INDEX IF NOT EXISTS idx_earthquakes_location  ON earthquakes (lat, lon);

-- ── Natural Events (NASA EONET) ─────────────────────────
CREATE TABLE IF NOT EXISTS natural_events (
    time        TIMESTAMPTZ     NOT NULL,
    event_id    TEXT            NOT NULL,
    title       TEXT,
    category    TEXT,
    status      TEXT,           -- open / closed
    lat         DECIMAL(9,6),
    lon         DECIMAL(9,6),
    UNIQUE (time, event_id)
);
SELECT create_hypertable('natural_events', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_events_category ON natural_events (category, time DESC);

-- ── Air Quality (OpenAQ) ────────────────────────────────
CREATE TABLE IF NOT EXISTS air_quality (
    time        TIMESTAMPTZ     NOT NULL,
    station_id  TEXT            NOT NULL,
    station_name TEXT,
    city        TEXT,
    country     TEXT,
    lat         DECIMAL(9,6),
    lon         DECIMAL(9,6),
    parameter   TEXT,           -- pm25, pm10, o3, no2, etc.
    value       DECIMAL(10,4),
    unit        TEXT,
    UNIQUE (time, station_id, parameter)
);
SELECT create_hypertable('air_quality', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_air_station  ON air_quality (station_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_air_location ON air_quality (lat, lon);

-- ── Solar Events (NASA DONKI) ───────────────────────────
CREATE TABLE IF NOT EXISTS solar_events (
    time        TIMESTAMPTZ     NOT NULL,
    event_id    TEXT            NOT NULL,
    event_type  TEXT,           -- CME, FLR, GST, SEP, etc.
    class_type  TEXT,           -- for solar flares: C1.5, M2.0, X1.0, etc.
    kp_index    DECIMAL(4,2),   -- for geomagnetic storms
    note        TEXT,
    UNIQUE (time, event_id)
);
SELECT create_hypertable('solar_events', 'time', if_not_exists => TRUE);

-- ── Collector Run Log ───────────────────────────────────
CREATE TABLE IF NOT EXISTS collector_runs (
    time        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    source      TEXT            NOT NULL,
    records     INTEGER         DEFAULT 0,
    duration_ms INTEGER,
    success     BOOLEAN         DEFAULT TRUE,
    error       TEXT
);
SELECT create_hypertable('collector_runs', 'time', if_not_exists => TRUE);

-- ── Continuous Aggregates (for fast Grafana queries) ────

-- Hourly earthquake summary
CREATE MATERIALIZED VIEW IF NOT EXISTS earthquakes_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    COUNT(*)                    AS count,
    MAX(magnitude)              AS max_magnitude,
    AVG(magnitude)              AS avg_magnitude,
    COUNT(*) FILTER (WHERE tsunami) AS tsunami_count
FROM earthquakes
GROUP BY bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('earthquakes_hourly',
    start_offset => INTERVAL '3 days',
    end_offset   => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

-- Daily air quality summary per station
CREATE MATERIALIZED VIEW IF NOT EXISTS air_quality_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS bucket,
    station_id,
    station_name,
    country,
    parameter,
    AVG(value)  AS avg_value,
    MAX(value)  AS max_value,
    MIN(value)  AS min_value,
    lat, lon
FROM air_quality
GROUP BY bucket, station_id, station_name, country, parameter, lat, lon
WITH NO DATA;

SELECT add_continuous_aggregate_policy('air_quality_daily',
    start_offset => INTERVAL '7 days',
    end_offset   => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- ── Retention Policies ──────────────────────────────────
-- Keep raw data for 1 year, aggregates kept indefinitely
SELECT add_retention_policy('air_quality',   INTERVAL '1 year',  if_not_exists => TRUE);
SELECT add_retention_policy('collector_runs', INTERVAL '30 days', if_not_exists => TRUE);
