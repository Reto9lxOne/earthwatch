# Earthwatch

Earthwatch is a Docker-based live monitoring stack for earthquakes, volcanic activity, natural events, ships, solar activity, space stations, NOAA alerts, storm potential, radiation, nuclear plants, air quality, flights, aurora, internet outages, sea surface temperature, CO₂, and webcams.

It combines a Node.js dashboard/API service, a TimescaleDB-backed collector pipeline, a small proxy service for external feeds, and Grafana for analytics and alerting.

## Stack

| Service | Description | URL |
|---|---|---|
| **nginx** | Reverse proxy + TLS entrypoint | configurable |
| **web-next** | Node.js dashboard + read-only API | configurable |
| **grafana** | Analytics + alerts | configurable |
| **collector** | API poller → TimescaleDB | internal |
| **proxy** | AIS ship + NASA DONKI proxy | internal |
| **timescaledb** | Time-series database | internal |

## Data Sources

| Layer | API | Mode | Default | Status |
|---|---|---|---|---|
| 🔴 Earthquakes | USGS GeoJSON Feed | Poll 5min | ✅ on | ✅ Active |
| 🌪 Natural events | NASA EONET (excl. volcanoes) | Poll 5min | ✅ on | ✅ Active |
| 🌋 Volcanoes | NASA EONET (direct, 365d) | Cache 6h | ✅ on | ✅ Active |
| ☀️ Solar activity | NASA DONKI (via proxy) | Poll 30min | ✅ on | ✅ Active |
| 🌩 NOAA Alerts | api.weather.gov | Poll 5min | ✅ on | ✅ Active |
| ☢️ Radiation | Safecast µSv/h (crowd-sourced) | Poll 4h | ✅ on | ✅ Active (sparse) |
| 🌐 Internet outages | IODA (Georgia Tech), country-level | Poll 15min | ✅ on | ✅ Active |
| 🛰️ Space Stations | TLE propagation (ISS + Tiangong) | Animate 30s | ✅ on | ✅ Active |
| ⛈ Storm potential | Open-Meteo CAPE (15° grid) | Cache 1h | ☐ off | ✅ Active |
| 🚢 Ships | aisstream.io (WebSocket proxy) | Live | ☐ off | ✅ Active |
| ✈️ Flights | OpenSky Network | Cache 60s | ☐ off | ✅ Active |
| ⚛️ Nuclear plants | OpenStreetMap Overpass | Cache 24h | ☐ off | ✅ Active |
| 🌊 Sea surface temp | NOAA ERDDAP blended SST | Cache 24h | ☐ off | ✅ Active |
| 🌌 Aurora | NOAA SWPC ovation oval | Cache 1h | ☐ off | ✅ Active |
| 📷 Webcams | Windy Webcams (top 100) | Cache 1h | ☐ off | ✅ Active (needs key) |
| 💨 Air quality | WAQI (~1800 stations, AQI) | Cache 1h | ☐ off | ✅ Active (needs token) |
| 🛰 Starlink | CelesTrak TLE | Cache 1h | ☐ off | ✅ Active |
| 🌤 Weather Sats | CelesTrak TLE (NOAA/GOES/MetOp) | Cache 1h | ☐ off | ✅ Active |

**Panel stats (always visible, no toggle):**
- 🌑 Moon phase — calculated client-side, no API
- CO₂ — NOAA Mauna Loa daily reading, cache 6h
- ISS position panel — wheretheiss.at, poll 10s

## Architecture

`web-next` is the primary web service for the Earthwatch dashboard.

Request flow:
```text
browser -> nginx -> web-next -> TimescaleDB / cached upstream APIs
browser -> nginx -> proxy -> AIS stream / NASA DONKI proxy
collector -> upstream APIs -> TimescaleDB
```

- frontend assets and API routes live in one deployable Node.js service
- most map layers are served from local data in TimescaleDB or short-lived server-side caches
- `/health` is provided by the app and is suitable for Docker and edge checks

## Requirements

- Docker Engine with Docker Compose
- a Linux host or VM
- outbound internet access for the collector/proxy services
- TLS certificates if you want HTTPS through nginx

## Quick Start

### 1. Host setup
```bash
sudo ./setup.sh
# Re-login after setup if your user was added to the docker group
```

### 2. Clone repo
```bash
git clone https://github.com/<your-org-or-user>/earthwatch.git
cd earthwatch
```

### 3. Configure .env
```bash
cp .env.example .env
nano .env
```

Required values:
```env
DB_PASSWORD=strong_password
GRAFANA_PASSWORD=strong_password
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id         # must be a string with quotes in telegram.yml!
NASA_API_KEY=your_nasa_key            # free at api.nasa.gov
AISSTREAM_TOKEN=your_aisstream_key    # free at aisstream.io
```

Optional (enables additional layers):
```env
WINDY_WEBCAMS_KEY=your_key            # free at api.windy.com — select Webcams API
WAQI_TOKEN=your_token                 # free at aqicn.org/data-platform/token/
VITE_CESIUM_ION_TOKEN=your_token      # free at ion.cesium.com — enables 3D Globe view with World Terrain
```

### 4. Configure Grafana alerting

```bash
nano grafana/provisioning/alerting/telegram.yml
```

Expected values:
```yaml
bottoken: "your_bot_token"   # from @BotFather on Telegram
chatid: !!str 123456789      # must use !!str tag to prevent YAML number coercion
```

To get your Chat ID:
1. Message `@BotFather` on Telegram → `/newbot` → get `BOT_TOKEN`
2. Send `/start` to your new bot
3. Open: `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Find `"chat":{"id":XXXXXXX}` — that number is your Chat ID

### 5. SSL Certificates

```bash
mkdir -p nginx/ssl
# copy your own fullchain.pem and privkey.pem here
```

### 6. Start
```bash
docker compose up -d
docker compose logs -f
```

---

## Ship Tracking (aisstream.io)

Ships are tracked via a WebSocket proxy — the AIS token stays on the server, never exposed in the browser.

**How it works:**
```
aisstream.io WebSocket → proxy container → /ws/ships → nginx → dashboard
```

**Setup:**
1. Register free at **aisstream.io**
2. Get your API token from account settings
3. Add to `.env`: `AISSTREAM_TOKEN=your_token`
4. Rebuild proxy: `docker compose up -d --build proxy`

---

## Web Service

Main API routes:
```
GET /health                               app + database health
GET /api/v1/map/summary                   dashboard summary metrics
GET /api/v1/map/layers/earthquakes        USGS earthquakes (TimescaleDB, last 24h)
GET /api/v1/map/layers/natural-events     EONET events excl. volcanoes (TimescaleDB, 30d)
GET /api/v1/map/layers/volcanoes          EONET volcanic activity (direct, 365d, 6h cache)
GET /api/v1/map/layers/solar-events       NASA DONKI events (TimescaleDB)
GET /api/v1/map/layers/radiation          Safecast µSv/h (TimescaleDB, latest per ~1° cell)
GET /api/v1/map/layers/nuclear-plants     OSM Overpass nuclear facilities (24h cache)
GET /api/v1/map/layers/air-quality        WAQI AQI stations global (1h cache)
GET /api/v1/map/layers/flights            OpenSky airborne aircraft (60s cache)
GET /api/v1/map/layers/aurora             NOAA aurora oval (1h cache)
GET /api/v1/map/layers/internet-outages   IODA country-level outages (15min cache)
GET /api/v1/map/layers/webcams            Windy top-100 webcams (1h cache)
GET /api/v1/map/layers/sst                NOAA ERDDAP blended SST (24h cache)
GET /api/v1/lightning/potential           Open-Meteo CAPE grid (1h cache)
GET /api/v1/external/iss                  ISS position via wheretheiss.at
GET /api/v1/external/noaa-alerts          NOAA severe weather alerts
GET /api/v1/external/co2                  NOAA Mauna Loa CO₂ (6h cache)
GET /api/config                           Frontend config (Cesium Ion token)
```

---

## Globe View (3D)

The **Globe** button in the map toolbar switches from the Leaflet 2D map to an interactive 3D Earth powered by [CesiumJS](https://cesium.com/) with Cesium World Terrain.

### Layers on the globe

| Layer | Visual | Tooltip on hover |
|---|---|---|
| 🔴 Earthquakes | Colour-coded ellipse scaled by magnitude | `M5.2 – Southern Japan · Jun 10, 14:22 UTC` |
| ✈️ Flights | Cyan point at actual altitude | `SWA1234 · USA · 35,000 ft · 452 kn` |
| 🚢 Ships | Green point at sea level, live WebSocket | `MAERSK TIANJIN · Rotterdam → Shanghai · 14.5 kn` |

### How it works

- CesiumJS 1.122 is loaded from the jsDelivr CDN (no local build step needed).
- On first click the viewer lazy-initialises: fetches the Ion token from `GET /api/config`, loads World Terrain, and renders current data.
- The **same layer toggle chips** that control the 2D map also show/hide entities on the globe (`entity.show`).
- Ships update in real time via the existing `/ws/ships` WebSocket — no second connection needed.
- The Ion token flows `VITE_CESIUM_ION_TOKEN (.env) → docker-compose → Fastify env → GET /api/config → JS` and is never hard-coded in frontend assets.

### Setup

1. Create a free account at [ion.cesium.com](https://ion.cesium.com) and copy your default access token.
2. Add to `.env`:
   ```env
   VITE_CESIUM_ION_TOKEN=your_token_here
   ```
3. Rebuild `web-next`: `docker compose up -d --build web-next`

---

## NASA DONKI Solar Proxy

Solar activity data is fetched server-side — the NASA API key never appears in the browser or in git.

```
dashboard → /api/donki/{type} → proxy → api.nasa.gov (with key) → dashboard
```

Endpoint: `/api/donki/{CME|FLR|GST|SEP}?startDate=...&endDate=...`

---

## Telegram Alerts

Configured alerts:
- 🔴 Earthquake M5.0+
- 🚨 Major Earthquake M7.0+
- 🌊 Tsunami Warning
- ☀️ Geomagnetic Storm (Kp5+)
- ⚠️ Collector not running for 30 min

---

## Layer Notes

### Radiation
Safecast crowd-sourced µSv/h measurements. Coverage is sparse (typically 2–5 active stations globally). Collector runs every 4 hours.

Color scale: 🟢 ≤0.1 · 🟡 0.1–0.3 · 🟠 0.3–1.0 · 🔴 >1.0 µSv/h

### Storm Potential (CAPE)
Open-Meteo CAPE on a ~10° global grid. CAPE > 500 J/kg = thunderstorm potential, > 2500 J/kg = severe storms likely. Updates hourly.

### Sea Surface Temperature
NOAA blended SST, stride-40 query from ERDDAP (~13k ocean points). Color: dark blue (-2°C) → red (34°C). Updates daily.

### Air Quality
WAQI global bounding-box query. ~1800 stations, AQI scale: 🟢 0–50 (Good) · 🟡 51–100 (Moderate) · 🟠 101–150 (Unhealthy/sensitive) · 🔴 151–200 (Unhealthy) · 🟣 201–300 (Very Unhealthy) · ⬛ 301+ (Hazardous). Requires free token at aqicn.org/data-platform/token/.

### Internet Outages
IODA (Georgia Tech) country-level outage alerts from the last 48 hours. 🔴 = critical, 🟡 = degraded.

### Volcanoes
Direct EONET fetch (last 365 days) rather than TimescaleDB, since the collector only started recently and has no historical backfill.

---

## Known Issues & Fixes

| Issue | Cause | Fix |
|---|---|---|
| Grafana crashes on start | Telegram token not set in `telegram.yml` | Enter token manually (see setup step 4) |
| `chatid` parse error in Grafana | chatid must be a string | Use `!!str` tag: `chatid: !!str 123456` |
| worldmap-panel Angular warning | Deprecated Angular plugin | Non-critical, ignore |
| Map edge wrap imperfect | Leaflet world wrap limitation | Known, evaluate non-tiled renderer later |
| Alert rules YAML error | Invalid time range in provisioning | `rules.yml` disabled, configure via Grafana UI |

---

## Useful Commands

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f
docker compose logs -f collector
docker compose logs -f web-next

# Rebuild after code changes
docker compose up -d --build web-next
docker compose up -d --build collector
docker compose up -d --build proxy

# Check health
curl -k https://<your-domain>/health
curl -k https://<your-domain>/api/health

# DB shell
docker exec -it earthwatch-db psql -U earthwatch

# Check collected data
docker exec -it earthwatch-db psql -U earthwatch -c \
  "SELECT COUNT(*), MAX(magnitude) FROM earthquakes WHERE time > NOW() - INTERVAL '24h';"

docker exec -it earthwatch-db psql -U earthwatch -c \
  "SELECT source, records, success, time FROM collector_runs ORDER BY time DESC LIMIT 20;"

# Pull latest & redeploy
git pull && docker compose up -d --build
```

---

## Deployment Notes

- keep `web-next` internal-only and route traffic through nginx
- keep browser-facing secrets out of frontend code
- treat `.env` as host-local runtime config and never commit it
- `WINDY_WEBCAMS_KEY` and `WAQI_TOKEN` are optional — layers simply stay empty without them

### Health Checks

```bash
curl -k https://<your-domain>/health           # app + DB
curl -k https://<your-domain>/api/health       # proxy (AIS stream status)
docker compose ps
```

---

## Open TODOs

- [ ] Build Grafana dashboards with TimescaleDB data
- [x] Add Watchtower for automatic container updates
- [x] 3D Globe view (CesiumJS, World Terrain, earthquakes / flights / ships)
- [ ] Grafana alerts for new layers (Aurora, Internet Outages)
- [ ] History slider — browse 30 days of events (deferred, needs more data)
- [ ] Revisit map renderer if Leaflet wrap/scaling remains a problem
- [ ] Expand radiation coverage when more Safecast stations come online
- [ ] Globe: natural events, volcanoes, aurora layers
