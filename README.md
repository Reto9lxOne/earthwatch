# 🌍 Earthwatch

Live planet dashboard — real-time natural events, earthquakes, air quality, solar activity and more.

## Stack

| Service | Description | URL |
|---|---|---|
| **nginx** | Reverse proxy + static files | — |
| **earthwatch-ui** | Live map dashboard | https://earthwatch.9lx.io |
| **grafana** | Analytics + Alerts | https://grafana.9lx.io |
| **collector** | API poller → TimescaleDB | internal |
| **proxy** | ADSB + AIS Ship Proxy | internal |
| **timescaledb** | Time-series database | internal |

## Data Sources

| Layer | API | Mode | Status |
|---|---|---|---|
| 🔴 Earthquakes | USGS GeoJSON Feed | Poll 5min | ✅ Active |
| 🌋 Natural Events | NASA EONET | Poll 5min | ✅ Active |
| ☀️ Solar Activity | NASA DONKI | Poll 5min | ✅ Active |
| ✈️ Flights | airplanes.live (via proxy) | Poll 2min | ✅ Active |
| 🚢 Ships | aisstream.io (via WebSocket proxy) | Live | ✅ Active |
| 🛸 ISS | wheretheiss.at | Poll 10s | ✅ Active |
| 🌩 NOAA Alerts | api.weather.gov | Poll 5min | ✅ Active |
| 💨 Air Quality | OpenAQ v3 | Poll 5min | ⏸ Disabled (needs free API key) |

## Quick Start

### 1. VM Setup (Ubuntu 24.04)
```bash
sudo ./setup.sh
# Re-login after setup (docker group)
exit && ssh localadmin@<VM-IP>
```

### 2. Clone repo
```bash
sudo mkdir /opt/earthwatch
sudo chown localadmin:localadmin /opt/earthwatch
git clone https://github.com/<USERNAME>/earthwatch /opt/earthwatch
cd /opt/earthwatch
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

### 4. Configure Telegram in Grafana provisioning

⚠️ **Important:** Grafana provisioning YAML does not read `.env` variables directly.
You must enter the Telegram credentials manually:

```bash
nano grafana/provisioning/alerting/telegram.yml
```

Replace the placeholders with your actual values:
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
```bash
cp /opt/nginx/ssl/fullchain.pem /opt/earthwatch/nginx/ssl/
cp /opt/nginx/ssl/privkey.pem   /opt/earthwatch/nginx/ssl/
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
- `wss://earthwatch.9lx.io/ws/ships` — live WebSocket stream
- `https://earthwatch.9lx.io/api/ships/snapshot` — REST snapshot
- `https://earthwatch.9lx.io/api/health` — proxy health check

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
| NASA Solar HTTP 429 | `DEMO_KEY` hardcoded in compose | Use `NASA_API_KEY: ${NASA_API_KEY}` |
| OpenAQ HTTP 410 Gone | v2 API retired Jan 2025 | v3 used now, needs free API key |
| Flights show `—` | airplanes.live rate limit | Auto-retry every 2 min |
| Map shows border/gap | Leaflet world wrap limitation | Known issue, TODO: D3.js map |
| Alert rules YAML error | Invalid time range in provisioning | `rules.yml` disabled, configure via Grafana UI |

---

## VM Specs

| Resource | Value |
|---|---|
| vCPU | 4 |
| RAM | 4 GB |
| Disk | 200 GB |
| OS | Ubuntu 24.04 LTS |

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
│   ├── index.js          ← ADSB REST + AIS WebSocket proxy
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
└── dashboard/
    └── index.html                ← live map dashboard
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

# Rebuild after code changes
docker compose up -d --build proxy
docker compose up -d --build collector

# Check proxy health
curl -k https://localhost/api/health

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

## Open TODOs

- [ ] Replace Leaflet map with D3.js — fix world wrap border issue
- [ ] Build Grafana dashboards with TimescaleDB data
- [ ] Add satellite layer (KeepTrack API — no key needed)
- [ ] Set up automated DB backup to NAS
- [ ] Enable OpenAQ air quality when account works
- [ ] Add Watchtower for automatic container updates
