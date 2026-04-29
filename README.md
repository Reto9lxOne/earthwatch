# Earthwatch

Earthwatch is a Docker-based live monitoring stack for earthquakes, natural events, ships, solar activity, NOAA alerts, and ISS position tracking.

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

| Layer | API | Mode | Status |
|---|---|---|---|
| 🔴 Earthquakes | USGS GeoJSON Feed | Poll 5min | ✅ Active |
| 🌋 Natural Events | NASA EONET | Poll 5min | ✅ Active |
| ☀️ Solar Activity | NASA DONKI (via proxy) | Poll 30min | ✅ Active |
| 🚢 Ships | aisstream.io (via WebSocket proxy) | Live | ✅ Active |
| 🛸 ISS | wheretheiss.at | Poll 10s | ✅ Active |
| 🌩 NOAA Alerts | api.weather.gov | Poll 5min | ✅ Active |
| 💨 Air Quality | OpenAQ v3 | Poll 5min | ⏸ Disabled (needs free API key) |

## Architecture

`web-next` is the primary web service for the Earthwatch dashboard.

Request flow:
```text
browser -> nginx -> web-next -> TimescaleDB / cached upstream APIs
browser -> nginx -> proxy -> AIS stream / NASA DONKI proxy
collector -> upstream APIs -> TimescaleDB
```

Why this is the preferred shape:
- the dashboard is no longer a single static HTML file with direct browser calls to multiple third-party APIs
- frontend assets and API routes live in one deployable Node.js service
- most map layers are now served from local data in TimescaleDB for better performance and consistency
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

Fill in all values:
```env
DB_PASSWORD=strong_password
GRAFANA_PASSWORD=strong_password
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
NASA_API_KEY=your_nasa_key          # get free at api.nasa.gov
OPENAQ_API_KEY=your_openaq_key      # get free at explore.openaq.org/register
AISSTREAM_TOKEN=your_aisstream_key  # get free at aisstream.io
```

### 4. Configure Grafana alerting

By default, the repository keeps Telegram alert settings in Grafana provisioning.

Important:
- keep real credentials in `.env`, never in git
- verify whether your Grafana provisioning path resolves env vars correctly in your environment
- if your setup does not expand them, replace the placeholders locally on the host, not in the repo

```bash
nano grafana/provisioning/alerting/telegram.yml
```

Expected values:
```yaml
bottoken: "your_bot_token"   # from @BotFather on Telegram
chatid: "your_chat_id"       # must be a string with quotes!
```

To get your Chat ID:
1. Message `@BotFather` on Telegram → `/newbot` → get `BOT_TOKEN`
2. Send `/start` to your new bot
3. Open in browser: `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Find `"chat":{"id":XXXXXXX}` — that number is your Chat ID

### 5. SSL Certificates

If you are terminating TLS with nginx in this repo, place your certs in `nginx/ssl/`.

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

**Endpoints provided by proxy:**
- `/ws/ships` — live WebSocket stream
- `/api/ships/snapshot` — REST snapshot
- `/api/health` — proxy health check

---

## Web Service

Main routes:
- `/` — Earthwatch dashboard served by `web-next`
- `/health` — application and database health
- `/api/v1/map/summary` — dashboard summary metrics
- `/api/v1/map/layers/earthquakes` — earthquake layer from TimescaleDB
- `/api/v1/map/layers/natural-events` — natural event layer from TimescaleDB
- `/api/v1/map/layers/solar-events` — solar event feed from TimescaleDB
- `/api/v1/external/iss` — cached ISS status
- `/api/v1/external/noaa-alerts` — cached NOAA alerts

Current frontend notes:
- the live dashboard uses a tuned Leaflet map with server-backed layers
- ships load from `/api/ships/snapshot` first and then continue over `/ws/ships`
- the crew/astronaut panel has been removed from the UI

Operational commands:
```bash
docker compose up -d --build web-next nginx
docker compose logs -f web-next nginx
docker compose exec web-next wget -qO- http://127.0.0.1:3001/health
```

---

## NASA DONKI Solar Proxy

Solar activity data is fetched server-side — the NASA API key never appears in the browser or in git.

**How it works:**
```
dashboard → /api/donki/{type} → proxy → api.nasa.gov (with key) → dashboard
```

**Endpoint:** `/api/donki/{CME|FLR|GST|SEP}?startDate=...&endDate=...`

---

## Enable Air Quality (OpenAQ)

Air quality is disabled by default. To enable:

1. Register at **explore.openaq.org/register** (free)
2. Get your API key from account settings
3. Add to `.env`: `OPENAQ_API_KEY=your_key`
4. Add to `docker-compose.yml` under collector environment:
   ```yaml
   OPENAQ_API_KEY: ${OPENAQ_API_KEY}
   ```
5. In `collector/index.js` uncomment in `runAll()`:
   ```js
   await collectAirQuality();
   ```
6. Rebuild: `docker compose up -d --build collector`

---

## Telegram Alerts

Configured alerts:
- 🔴 Earthquake M5.0+
- 🚨 Major Earthquake M7.0+
- 🌊 Tsunami Warning
- ☀️ Geomagnetic Storm (Kp5+)
- ⚠️ Collector not running for 30 min
- 💨 Poor Air Quality (PM2.5 > 55) — when AQ enabled

---

## Known Issues & Fixes

| Issue | Cause | Fix |
|---|---|---|
| Grafana crashes on start | Telegram token not set in `telegram.yml` | Enter token manually (see step 4) |
| `chatid` parse error in Grafana | chatid must be a string | Use quotes: `chatid: "123456"` |
| worldmap-panel Angular warning | Deprecated Angular plugin | Non-critical, ignore |
| OpenAQ HTTP 410 Gone | v2 API retired Jan 2025 | v3 used now, needs free API key |
| Map scaling and wrap edge can still look imperfect | Leaflet world wrap limitation | Known issue, evaluate a non-tiled renderer in a later pass |
| Alert rules YAML error | Invalid time range in provisioning | `rules.yml` disabled, configure via Grafana UI |

---

## Directory Structure

```
earthwatch/
├── docker-compose.yml
├── setup.sh
├── .env.example
├── .gitignore
├── nginx/
│   ├── nginx.conf
│   └── ssl/              ← place certs here (not in git!)
├── collector/
│   ├── Dockerfile
│   ├── index.js          ← polls USGS, EONET, DONKI, OpenAQ
│   └── package.json
├── proxy/
│   ├── Dockerfile
│   ├── index.js          ← AIS WebSocket + NASA DONKI proxy
│   └── package.json
├── db/
│   └── init.sql
├── grafana/
│   └── provisioning/
│       ├── datasources/
│       │   └── timescaledb.yml
│       ├── dashboards/
│       │   └── dashboards.yml
│       └── alerting/
│           ├── telegram.yml      ← enter real credentials here!
│           └── rules.yml.disabled
└── web-next/
    ├── public/
    │   ├── index.html
    │   └── assets/
    └── src/
        ├── routes/
        ├── repositories/
        └── plugins/
```

---

## Useful Commands

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f
docker compose logs -f collector
docker compose logs -f proxy
docker compose logs -f grafana

# Restart single service
docker compose restart proxy
docker compose restart nginx
docker compose restart web-next

# Rebuild after code changes
docker compose up -d --build proxy
docker compose up -d --build collector
docker compose up -d --build web-next nginx

# Check proxy health
curl -k https://<your-domain>/api/health

# Check web health
curl -k https://<your-domain>/health

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

The recommended deployment model is Docker Compose with nginx in front of `web-next`, `proxy`, Grafana, and TimescaleDB.

Suggested approach:
- keep `web-next` internal-only and route traffic through nginx
- keep browser-facing secrets out of frontend code
- use `/health` for application checks and `/api/health` for proxy checks
- treat `.env` as host-local runtime config and never commit it

### Health Checks

There are three health layers:

1. Application health:
   - `GET /health` inside `web-next`
2. Container health:
   - Compose healthcheck against `http://127.0.0.1:3001/health`
3. Edge reachability:
   - `https://<your-domain>/health`

Quick verification:

```bash
curl -k https://<your-domain>/health
curl -k https://<your-domain>/api/v1/map/layers/earthquakes
docker compose ps web-next
```

### Logging Strategy

`web-next` logs to stdout/stderr using Fastify's built-in structured logger.

Production usage:

```bash
docker compose logs -f web-next
docker compose logs -f nginx
```

Current strategy:
- structured JSON logs in production
- no file-based logging in container
- rely on Docker log collection
- keep secrets out of logs

### Rollback Plan

The rollout is additive, so rollback is simple and non-destructive.

1. Revert the nginx root routing change back to the previous static dashboard or prior commit.
2. Restart nginx and web-next:
   ```bash
   docker compose up -d --build nginx web-next
   ```
3. Optionally stop `web-next`:
   ```bash
   docker compose stop web-next
   ```

Rollback does not require:
- deleting volumes
- changing database data
- touching existing dashboard files
- changing secrets

### Important Safety Notes

- `web-next` is internal-only; it does not bind a host port directly
- existing routes `/api/health`, `/api/donki/*`, `/api/ships/*`, and `/ws/ships` remain unchanged
- no existing persistent data paths are modified

## Open TODOs

- [ ] Revisit the world map renderer if Leaflet wrap/scaling remains a product issue
- [ ] Build Grafana dashboards with TimescaleDB data
- [ ] Set up automated DB backup to NAS
- [ ] Enable OpenAQ air quality when account works
- [ ] Add Watchtower for automatic container updates
