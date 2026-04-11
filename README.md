# 🌍 Earthwatch

Live planet dashboard — real-time natural events, earthquakes, air quality, solar activity and more.

## Stack

| Service | Description | URL |
|---|---|---|
| **nginx** | Reverse proxy + static files | — |
| **earthwatch-ui** | Live map dashboard | https://earthwatch.9lx.ch |
| **grafana** | Analytics + Alerts | https://grafana.9lx.ch |
| **collector** | API poller → TimescaleDB | internal |
| **proxy** | ADSB CORS proxy | internal |
| **timescaledb** | Time-series database | internal |

## Data Sources

| Layer | API | Poll Interval | Status |
|---|---|---|---|
| 🔴 Earthquakes | USGS GeoJSON Feed | 5 min | ✅ Active |
| 🌋 Natural Events | NASA EONET | 5 min | ✅ Active |
| ☀️ Solar Activity | NASA DONKI | 5 min | ✅ Active |
| 💨 Air Quality | OpenAQ v3 | 5 min | ⏸ Disabled (needs free API key) |
| ✈️ Flights | airplanes.live (via proxy) | live | ✅ Active |

## Quick Start

### 1. VM Setup (Ubuntu 24.04)
```bash
# On fresh VM at 10.75.40.13
sudo ./setup.sh
# Re-login after setup (docker group)
exit && ssh localadmin@10.75.40.13
```

### 2. Clone repo
```bash
sudo mkdir /opt/earthwatch
sudo chown localadmin:localadmin /opt/earthwatch
git clone https://github.com/Reto9lxOne/earthwatch /opt/earthwatch
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
NASA_API_KEY=your_nasa_key        # get free at api.nasa.gov
OPENAQ_API_KEY=your_openaq_key    # get free at explore.openaq.org/register
```

### 4. Configure Telegram in Grafana provisioning

⚠️ **Important:** Grafana provisioning YAML does not read `.env` variables directly.
You must enter the Telegram credentials manually:

```bash
nano grafana/provisioning/alerting/telegram.yml
```

Replace the placeholders with your actual values:
```yaml
bottoken: "1234567890:ABCdefGHI..."   # your bot token from @BotFather
chatid: "31791262"                     # your chat ID
```

To get your Chat ID:
1. Message `@BotFather` on Telegram → `/newbot` → get `BOT_TOKEN`
2. Send `/start` to your new bot
3. Open in browser: `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Find `"chat":{"id":XXXXXXX}` — that number is your Chat ID

### 5. SSL Certificates
```bash
# Copy your *.9lx.ch wildcard cert
cp /opt/nginx/ssl/fullchain.pem /opt/earthwatch/nginx/ssl/
cp /opt/nginx/ssl/privkey.pem   /opt/earthwatch/nginx/ssl/
```

### 6. Fix docker-compose.yml NASA key
Make sure `docker-compose.yml` uses the env variable (not hardcoded):
```yaml
NASA_API_KEY: ${NASA_API_KEY}   # ← must be this, not DEMO_KEY
```

### 7. Start
```bash
docker compose up -d
docker compose logs -f
```

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

## Telegram Alerts

Configured alerts:
- 🔴 Earthquake M5.0+
- 🚨 Major Earthquake M7.0+
- 🌊 Tsunami Warning
- 💨 Poor Air Quality (PM2.5 > 55) — when AQ enabled
- ☀️ Geomagnetic Storm (Kp5+)
- ⚠️ Collector not running for 30 min

## Known Issues & Fixes

### Grafana crashes on start
**Cause:** Telegram Bot Token not set in provisioning file
**Fix:** Edit `grafana/provisioning/alerting/telegram.yml` and set real values (see step 4 above)

### worldmap-panel Angular warning
**Cause:** `grafana-worldmap-panel` uses deprecated Angular framework
**Status:** Non-critical warning, does not affect functionality. Will be replaced with a modern map panel.

### NASA Solar — HTTP 429 Rate Limit
**Cause:** DEMO_KEY hardcoded in `docker-compose.yml`
**Fix:** Change `NASA_API_KEY: DEMO_KEY` to `NASA_API_KEY: ${NASA_API_KEY}` in `docker-compose.yml`

### OpenAQ — HTTP 410 Gone
**Cause:** v2 API was retired January 2025
**Fix:** Collector now uses v3 API — requires free API key from explore.openaq.org

### Flights — ERR
**Cause:** All public ADS-B APIs block direct browser requests (CORS) without account
**Fix:** Proxy running internally at `/api/adsb/` — served via nginx

## VM Specs

| Resource | Value |
|---|---|
| Hostname | prd-eaw01.srv.9lx.io |
| vCPU | 4 |
| RAM | 4 GB |
| Disk | 200 GB |
| IP | 10.75.40.13 |
| VLAN | VLAN40 / SERVER |
| OS | Ubuntu 24.04 LTS |

## Directory Structure

```
earthwatch/
├── docker-compose.yml
├── setup.sh
├── .env.example
├── .gitignore
├── nginx/
│   ├── nginx.conf
│   └── ssl/           ← place certs here (not in git!)
├── collector/
│   ├── Dockerfile
│   ├── index.js
│   └── package.json
├── proxy/
│   ├── Dockerfile
│   ├── index.js
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
│           ├── telegram.yml   ← enter real Telegram credentials here!
│           └── rules.yml
└── dashboard/         ← static HTML dashboard (gitignored build)
```

## Useful Commands

```bash
# Start all services
docker compose up -d

# View all logs
docker compose logs -f

# View specific service logs
docker compose logs -f collector
docker compose logs -f grafana
docker compose logs -f nginx

# Restart single service
docker compose restart grafana

# Rebuild after code changes
docker compose up -d --build collector

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
