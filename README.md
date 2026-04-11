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

| Layer | API | Poll Interval |
|---|---|---|
| 🔴 Earthquakes | USGS GeoJSON Feed | 5 min |
| 🌋 Natural Events | NASA EONET | 5 min |
| 💨 Air Quality | OpenAQ | 5 min |
| ☀️ Solar Activity | NASA DONKI | 5 min |
| ✈️ Flights | airplanes.live (via proxy) | live |

## Quick Start

### 1. VM Setup (Ubuntu 24.04)
```bash
# On fresh VM at 10.75.40.13
sudo ./setup.sh
```

### 2. Configure
```bash
cp .env.example .env
nano .env   # Fill in DB_PASSWORD, GRAFANA_PASSWORD, TELEGRAM tokens
```

### 3. SSL Certificates
Place your `*.9lx.ch` wildcard certificate in `nginx/ssl/`:
```
nginx/ssl/fullchain.pem
nginx/ssl/privkey.pem
```

### 4. Start
```bash
docker compose up -d
docker compose logs -f
```

## Telegram Alerts

To set up Telegram alerts:
1. Message `@BotFather` → `/newbot` → get your `BOT_TOKEN`
2. Start a chat with your bot or add to a group
3. Get your `CHAT_ID`: visit `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Add both to your `.env`

Configured alerts:
- 🔴 Earthquake M5.0+
- 🚨 Major Earthquake M7.0+
- 🌊 Tsunami Warning
- 💨 Poor Air Quality (PM2.5 > 55)
- ☀️ Geomagnetic Storm (Kp5+)
- ⚠️ Collector Health Check

## VM Specs

| Resource | Value |
|---|---|
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
│       ├── dashboards/
│       └── alerting/
└── dashboard/         ← static HTML dashboard (gitignored build)
```

## Useful Commands

```bash
# Start
docker compose up -d

# View logs
docker compose logs -f collector
docker compose logs -f

# Restart single service
docker compose restart collector

# DB shell
docker exec -it earthwatch-db psql -U earthwatch

# Check data
docker exec -it earthwatch-db psql -U earthwatch -c \
  "SELECT COUNT(*), MAX(magnitude) FROM earthquakes WHERE time > NOW() - INTERVAL '24h';"

# Update
git pull && docker compose up -d --build
```
