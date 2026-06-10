const MAX_SHIPS = 600;
const SHIP_STALE_MS = 30 * 60 * 1000;

const state = {
  layers: {
    earthquakes: true,
    events: true,
    ships: false,
    alerts: true,
    volcanoes: true,
    lightning: true,
    radiation: true,
    nuclear: false,
    webcams: false,
    flights: false,
    aurora: false,
    outages: true,
    sst: false,
    airquality: false,
  },
  markers: {
    earthquakes: [],
    events: [],
    alerts: [],
    volcanoes: [],
    radiation: [],
    nuclear: [],
    webcams: [],
    flights: [],
    outages: [],
    airquality: [],
  },
  ships: new Map(),
  feed: [],
  shipSocket: null,
  rawData: {
    earthquakes: [],
    flights: [],
  },
};

// ── Satellite Layers ──────────────────────────────────────
const SAT_GROUPS = {
  starlink: { color: '#67d4ff', markers: [], data: null, timer: null },
  weather:  { color: '#ffd166', markers: [], data: null, timer: null },
  stations: { color: '#7ef7b8', markers: [], data: null, timer: null },
};

function satPosition(tle1, tle2, date) {
  const lib = window.satellite;
  if (!lib) return null;
  try {
    const satrec = lib.twoline2satrec(tle1, tle2);
    const pv = lib.propagate(satrec, date);
    if (!pv || !pv.position) return null;
    const gmst = lib.gstime(date);
    const geo = lib.eciToGeodetic(pv.position, gmst);
    return {
      lat: lib.degreesLat(geo.latitude),
      lon: lib.degreesLong(geo.longitude),
      alt: Math.round(geo.height),
    };
  } catch { return null; }
}

function renderSatGroup(group) {
  const g = SAT_GROUPS[group];
  g.markers.forEach(m => m.remove());
  g.markers = [];
  if (!g.data) return;
  const date = new Date();
  const isStation = group === 'stations';
  g.data.forEach(sat => {
    const pos = satPosition(sat.tle1, sat.tle2, date);
    if (!pos || pos.lat < -85 || pos.lat > 85) return;
    let marker;
    if (isStation) {
      marker = L.marker([pos.lat, pos.lon], {
        icon: createDivIcon('event-icon-wrap', `<div class="event-icon" aria-hidden="true">🛰️</div>`, 28),
      });
    } else {
      marker = L.circleMarker([pos.lat, pos.lon], {
        renderer: canvasRenderer,
        radius: group === 'starlink' ? 2 : 3,
        color: g.color,
        weight: 0,
        fillColor: g.color,
        fillOpacity: group === 'starlink' ? 0.6 : 0.85,
      });
    }
    bindHover(marker, sat.name, `Alt: ${pos.alt} km`);
    marker.addTo(map);
    g.markers.push(marker);
  });
}

async function enableSatGroup(group) {
  const g = SAT_GROUPS[group];
  if (!g.data) {
    const btn = document.querySelector(`[data-satellite="${group}"]`);
    if (btn) btn.textContent = '…';
    try {
      g.data = await fetchJson(`/api/satellites/${group}`);
    } catch (e) {
      reportError(`satellites:${group}`, e);
      if (btn) btn.textContent = { starlink: 'Starlink', weather: 'Weather Sats', stations: 'Space Stations' }[group];
      return;
    }
    if (btn) btn.textContent = { starlink: 'Starlink', weather: 'Weather Sats', stations: 'Space Stations' }[group];
  }
  renderSatGroup(group);
  g.timer = setInterval(() => renderSatGroup(group), 30000);
}

function disableSatGroup(group) {
  const g = SAT_GROUPS[group];
  g.markers.forEach(m => m.remove());
  g.markers = [];
  if (g.timer) { clearInterval(g.timer); g.timer = null; }
}

document.querySelectorAll('[data-satellite]').forEach(btn => {
  btn.addEventListener('click', () => {
    const group = btn.dataset.satellite;
    const active = btn.classList.toggle('is-active');
    if (active) {
      enableSatGroup(group);
    } else {
      disableSatGroup(group);
    }
  });
});

const canvasRenderer = L.canvas({ padding: 0.4 });

const map = L.map('map', {
  center: [22, 8],
  zoom: 2.2,
  zoomControl: false,
  preferCanvas: true,
  worldCopyJump: true,
  zoomSnap: 0.25,
  zoomDelta: 0.5,
  minZoom: 1.75,
  maxZoom: 7,
  maxBounds: [
    [-85, -220],
    [85, 220],
  ],
  maxBoundsViscosity: 0.2,
});

L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap &copy; CARTO',
  subdomains: 'abcd',
  minZoom: 1,
  maxZoom: 7,
  keepBuffer: 4,
  updateWhenZooming: false,
  updateWhenIdle: true,
}).addTo(map);

const popup = L.popup({
  closeButton: false,
  offset: [0, -8],
});

function createDivIcon(className, html, size = 22) {
  return L.divIcon({
    className,
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function setHtml(id, html) {
  const element = document.getElementById(id);
  if (element) {
    element.innerHTML = html;
  }
}

function updateMoonPhase() {
  const SYNODIC = 29.530588853; // days
  // Known new moon: 2000-01-06T18:14:00Z
  const REF = new Date('2000-01-06T18:14:00Z').getTime();
  const age = ((Date.now() - REF) / 86400000) % SYNODIC;
  const illumination = (1 - Math.cos(2 * Math.PI * age / SYNODIC)) / 2;

  let emoji, name;
  if (age < 1.85)        { emoji = '🌑'; name = 'New Moon'; }
  else if (age < 7.38)   { emoji = '🌒'; name = 'Waxing Crescent'; }
  else if (age < 9.22)   { emoji = '🌓'; name = 'First Quarter'; }
  else if (age < 14.77)  { emoji = '🌔'; name = 'Waxing Gibbous'; }
  else if (age < 16.61)  { emoji = '🌕'; name = 'Full Moon'; }
  else if (age < 22.15)  { emoji = '🌖'; name = 'Waning Gibbous'; }
  else if (age < 23.99)  { emoji = '🌗'; name = 'Last Quarter'; }
  else                   { emoji = '🌘'; name = 'Waning Crescent'; }

  setText('moon-emoji', emoji);
  setText('moon-phase-name', name);
  setText('moon-illumination', `${Math.round(illumination * 100)}%`);
  setText('moon-age', `${age.toFixed(1)}d`);
}

function updateClock() {
  const now = new Date();
  setText('clock-value', now.toISOString().slice(11, 19));
}

function hideLoader() {
  document.getElementById('map-loading')?.classList.add('is-hidden');
}

function formatShortDate(value) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

function addFeedItem(item) {
  const key = `${item.title}|${item.meta}`;
  state.feed = state.feed.filter((entry) => `${entry.title}|${entry.meta}` !== key);
  state.feed.unshift(item);
  state.feed = state.feed.slice(0, 20);

  setHtml(
    'activity-feed',
    state.feed
      .map(
        (entry) => `
          <article class="feed-item">
            <strong>${entry.title}</strong>
            <span>${entry.meta}</span>
          </article>
        `
      )
      .join('')
  );
}

function clearMarkers(key) {
  state.markers[key].forEach((marker) => marker.remove());
  state.markers[key] = [];
}

function markerVisible(layerKey) {
  return Boolean(state.layers[layerKey]);
}

function bindHover(marker, title, meta) {
  marker.on('mouseover', () => {
    popup
      .setLatLng(marker.getLatLng())
      .setContent(`<strong>${title}</strong><br>${meta}`)
      .openOn(map);
  });
  marker.on('mouseout', () => map.closePopup(popup));
}

function earthquakeColor(magnitude) {
  if (magnitude >= 7) return '#ff6b6b';
  if (magnitude >= 6) return '#ff8f5c';
  if (magnitude >= 5) return '#ffd166';
  return '#7ef7b8';
}

function naturalEventVisual(category) {
  switch (category) {
    case 'wildfires':
      return { emoji: '🔥', label: 'Wildfire' };
    case 'severeStorms':
      return { emoji: '⛈️', label: 'Severe storm' };
    case 'volcanoes':
      return { emoji: '🌋', label: 'Volcano' };
    case 'seaLakeIce':
      return { emoji: '🧊', label: 'Sea or lake ice' };
    case 'drought':
      return { emoji: '☀️', label: 'Drought' };
    case 'floods':
      return { emoji: '🌊', label: 'Flood' };
    case 'dustHaze':
      return { emoji: '🌫️', label: 'Dust / Haze' };
    default:
      return { emoji: '🌐', label: 'Natural event' };
  }
}

function alertVisual(alert) {
  const eventName = (alert.properties?.event ?? '').toLowerCase();
  const severity = (alert.properties?.severity ?? '').toLowerCase();

  if (eventName.includes('hurricane') || eventName.includes('tropical storm') || eventName.includes('typhoon')) {
    return { emoji: '🌀', label: 'Cyclone alert' };
  }

  if (eventName.includes('tornado')) {
    return { emoji: '🌪️', label: 'Tornado alert' };
  }

  if (eventName.includes('thunderstorm') || eventName.includes('storm')) {
    return { emoji: '⛈️', label: 'Storm alert' };
  }

  if (eventName.includes('flood')) {
    return { emoji: '🌊', label: 'Flood alert' };
  }

  if (severity === 'extreme' || severity === 'severe') {
    return { emoji: '⚠️', label: 'Severe alert' };
  }

  return { emoji: '🔔', label: 'Alert' };
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }

  return response.json();
}

function reportError(scope, error) {
  console.error(scope, error);
}

function schedule(ms, task, options = {}) {
  const skipWhenHidden = options.skipWhenHidden ?? true;
  return window.setInterval(() => {
    if (skipWhenHidden && document.hidden) {
      return;
    }

    Promise.resolve(task()).catch((error) => reportError(`scheduled:${ms}`, error));
  }, ms);
}

function setShipStreamStatus(label) {
  setText('ship-stream-status', label);
}

async function loadSummary() {
  const payload = await fetchJson('/api/v1/map/summary');
  const summary = payload.data;
  const collectorRuns = summary.collectorRuns ?? [];
  const healthyCount = collectorRuns.filter((run) => run.healthy).length;

  setText('collector-health', `${healthyCount}/${collectorRuns.length || 0}`);
  setText('last-refresh', formatShortDate(payload.meta.generatedAt));
  setText('quake-count', summary.earthquakes24h ?? 0);
  setText('quake-max', summary.maxMagnitude24h ? `M${Number(summary.maxMagnitude24h).toFixed(1)}` : '--');
  setText('quake-place', summary.strongestEarthquakePlace || 'No recent high-magnitude event');
  setText('event-count', summary.naturalEvents30d ?? 0);
  setText('wildfire-count', summary.wildfires30d ?? 0);
  setText('storm-count', summary.severeStorms30d ?? 0);
  setText('volcano-count', summary.volcanoes30d ?? 0);
  setText('solar-count', summary.solarEvents7d ?? 0);

  setHtml(
    'collector-list',
    collectorRuns
      .map(
        (run) => `
          <span class="collector-chip ${run.healthy ? 'is-healthy' : 'is-unhealthy'}">
            ${run.source.replaceAll('_', ' ')}
          </span>
        `
      )
      .join('')
  );

  const maxMagnitude = Number(summary.maxMagnitude24h ?? 0);
  const eventCount = Number(summary.naturalEvents30d ?? 0);
  let status = 'Stable';

  if (maxMagnitude >= 7 || eventCount >= 150) {
    status = 'High activity';
  } else if (maxMagnitude >= 6 || eventCount >= 80) {
    status = 'Elevated';
  }

  setText('global-status', status);
}

async function loadEarthquakes() {
  const payload = await fetchJson('/api/v1/map/layers/earthquakes?sinceHours=24&limit=250');
  const features = payload.data.features ?? [];

  clearMarkers('earthquakes');
  state.rawData.earthquakes = features;

  features.forEach((feature) => {
    const [lng, lat] = feature.geometry.coordinates;
    const magnitude = feature.properties.magnitude ?? 0;
    const color = earthquakeColor(magnitude);
    const marker = L.circleMarker([lat, lng], {
      renderer: canvasRenderer,
      radius: Math.max(3, Math.min(12, magnitude * 1.8)),
      color,
      weight: 1.2,
      fillColor: color,
      fillOpacity: 0.18,
    });

    bindHover(
      marker,
      `M${magnitude.toFixed(1)} ${feature.properties.place ?? 'Unknown'}`,
      `${formatShortDate(feature.properties.time)} UTC`
    );

    if (markerVisible('earthquakes')) {
      marker.addTo(map);
    }

    state.markers.earthquakes.push(marker);
  });

  const strongest = features[0];
  if (strongest) {
    addFeedItem({
      title: `Earthquake ${strongest.properties.place ?? 'Unknown'}`,
      meta: `M${(strongest.properties.magnitude ?? 0).toFixed(1)} at ${formatShortDate(strongest.properties.time)} UTC`,
    });
  }
}

async function loadNaturalEvents() {
  const payload = await fetchJson('/api/v1/map/layers/natural-events?limit=200');
  const features = payload.data.features ?? [];

  clearMarkers('events');

  features.forEach((feature) => {
    const [lng, lat] = feature.geometry.coordinates;
    const visual = naturalEventVisual(feature.properties.category);
    const marker = L.marker([lat, lng], {
      icon: createDivIcon(
        'event-icon-wrap',
        `<div class="event-icon" aria-hidden="true">${visual.emoji}</div>`,
        28
      ),
    });

    bindHover(
      marker,
      feature.properties.title ?? 'Natural event',
      `${visual.label} • ${formatShortDate(feature.properties.time)} UTC`
    );

    if (markerVisible('events')) {
      marker.addTo(map);
    }

    state.markers.events.push(marker);
  });
}

async function loadVolcanoes() {
  const payload = await fetchJson('/api/v1/map/layers/volcanoes?limit=100');
  const features = payload.data.features ?? [];

  clearMarkers('volcanoes');

  features.forEach((feature) => {
    const [lng, lat] = feature.geometry.coordinates;
    const marker = L.marker([lat, lng], {
      icon: createDivIcon(
        'event-icon-wrap',
        '<div class="event-icon" aria-hidden="true">🌋</div>',
        28
      ),
    });

    bindHover(
      marker,
      feature.properties.title ?? 'Volcanic activity',
      `Volcano • ${formatShortDate(feature.properties.time)} UTC`
    );

    if (markerVisible('volcanoes')) {
      marker.addTo(map);
    }

    state.markers.volcanoes.push(marker);
  });
}

function radiationColor(usv) {
  if (usv >= 1.0)  return '#ff2222';
  if (usv >= 0.3)  return '#ff8800';
  if (usv >= 0.1)  return '#ffdd00';
  return '#44dd44';
}

async function loadRadiation() {
  const payload = await fetchJson('/api/v1/map/layers/radiation');
  const features = payload.data.features ?? [];

  clearMarkers('radiation');

  let maxUsv = 0;
  features.forEach((feature) => {
    const [lng, lat] = feature.geometry.coordinates;
    const usv   = feature.properties.valueUsv ?? 0;
    const color = radiationColor(usv);
    if (usv > maxUsv) maxUsv = usv;

    const marker = L.circleMarker([lat, lng], {
      renderer: canvasRenderer,
      radius: 7,
      color,
      weight: 1.5,
      fillColor: color,
      fillOpacity: 0.55,
    });

    bindHover(
      marker,
      `☢️ ${usv.toFixed(4)} µSv/h`,
      `${feature.properties.source} • ${formatShortDate(feature.properties.time)} UTC`
    );

    if (markerVisible('radiation')) marker.addTo(map);
    state.markers.radiation.push(marker);
  });

  setText('radiation-count', features.length);
  setText('radiation-stations', features.length);
  setText('radiation-max', maxUsv > 0 ? `${maxUsv.toFixed(4)} µSv/h` : '--');
}

async function loadNuclearPlants() {
  const payload = await fetchJson('/api/v1/map/layers/nuclear-plants');
  const features = payload.data.features ?? [];

  clearMarkers('nuclear');

  features.forEach((feature) => {
    const [lng, lat] = feature.geometry.coordinates;
    const p = feature.properties;
    const marker = L.marker([lat, lng], {
      icon: createDivIcon(
        'event-icon-wrap',
        '<div class="event-icon" aria-hidden="true">⚛️</div>',
        24
      ),
    });

    const cap  = p.capacity ? ` • ${p.capacity}` : '';
    const year = p.started  ? ` since ${p.started}` : '';
    bindHover(marker, p.name, `${p.operator ?? 'Unknown operator'}${cap}${year}`);

    if (markerVisible('nuclear')) marker.addTo(map);
    state.markers.nuclear.push(marker);
  });
}

function webcamSourceLabel(source) {
  if (source === 'tfl')      return 'TfL JamCam';
  if (source === 'caltrans') return 'Caltrans';
  if (source === 'windy')    return 'Windy';
  return source;
}

async function loadWebcams() {
  const payload = await fetchJson('/api/v1/map/layers/webcams');
  const features = payload.data.features ?? [];

  clearMarkers('webcams');

  features.forEach((feature) => {
    const [lng, lat] = feature.geometry.coordinates;
    const p = feature.properties;

    const marker = L.marker([lat, lng], {
      icon: createDivIcon(
        'event-icon-wrap',
        '<div class="event-icon" aria-hidden="true">📷</div>',
        22
      ),
    });

    const sourceLabel = webcamSourceLabel(p.source);
    const location = [p.city, p.country].filter(Boolean).join(', ');

    marker.on('mouseover', () => {
      const img = p.imageUrl
        ? `<img src="${p.imageUrl}" style="width:200px;height:112px;object-fit:cover;display:block;margin-top:6px;border-radius:3px;" loading="lazy" onerror="this.style.display='none'">`
        : '';
      popup
        .setLatLng(marker.getLatLng())
        .setContent(`<strong>${p.name}</strong><br><span style="opacity:.7">${sourceLabel}${location ? ' · ' + location : ''}</span>${img}`)
        .openOn(map);
    });
    marker.on('mouseout', () => map.closePopup(popup));

    if (markerVisible('webcams')) marker.addTo(map);
    state.markers.webcams.push(marker);
  });
}

function aqiColor(aqi) {
  if (aqi <= 50)  return '#00e400';
  if (aqi <= 100) return '#ffff00';
  if (aqi <= 150) return '#ff7e00';
  if (aqi <= 200) return '#ff0000';
  if (aqi <= 300) return '#8f3f97';
  return '#7e0023';
}

function aqiLabel(aqi) {
  if (aqi <= 50)  return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy (sensitive)';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

async function loadAirQuality() {
  const payload = await fetchJson('/api/v1/map/layers/air-quality');
  const features = payload.data.features ?? [];

  clearMarkers('airquality');

  features.forEach((feature) => {
    const [lng, lat] = feature.geometry.coordinates;
    const { aqi, name } = feature.properties;
    const color = aqiColor(aqi);

    const marker = L.circleMarker([lat, lng], {
      renderer: canvasRenderer,
      radius: aqi > 150 ? 6 : 4,
      color,
      weight: 1,
      fillColor: color,
      fillOpacity: 0.7,
    });

    bindHover(marker, `💨 AQI ${aqi} — ${aqiLabel(aqi)}`, name || '');
    if (markerVisible('airquality')) marker.addTo(map);
    state.markers.airquality.push(marker);
  });
}

async function loadFlights() {
  const payload = await fetchJson('/api/v1/map/layers/flights');
  const features = payload.data.features ?? [];

  clearMarkers('flights');
  state.rawData.flights = features;

  features.forEach((feature) => {
    const [lng, lat] = feature.geometry.coordinates;
    const p = feature.properties;
    const alt = p.altM != null ? `${Math.round(p.altM / 0.3048 / 100) * 100} ft` : '--';
    const spd = p.speedMs != null ? `${Math.round(p.speedMs * 1.94)} kn` : '--';

    const marker = L.marker([lat, lng], {
      icon: createDivIcon(
        'event-icon-wrap',
        `<div class="event-icon" style="font-size:14px;transform:rotate(${p.heading ?? 0}deg)" aria-hidden="true">✈️</div>`,
        20
      ),
    });

    bindHover(marker, p.callsign || p.icao || 'Unknown', `${p.country || ''} · ${alt} · ${spd}`);
    if (markerVisible('flights')) marker.addTo(map);
    state.markers.flights.push(marker);
  });
}

let auroraHeatLayer = null;

async function loadAurora() {
  const payload = await fetchJson('/api/v1/map/layers/aurora');
  const points = payload.data ?? [];

  const heatPoints = points.map(p => [p.lat, p.lon, p.prob / 100]);

  if (auroraHeatLayer) {
    auroraHeatLayer.setLatLngs(heatPoints);
    return;
  }

  auroraHeatLayer = L.heatLayer(heatPoints, {
    radius: 4,
    blur: 3,
    maxZoom: 5,
    max: 1,
    gradient: { 0.1: '#001133', 0.3: '#003366', 0.5: '#006644', 0.75: '#00cc66', 1.0: '#aaffcc' },
  });

  if (markerVisible('aurora')) {
    auroraHeatLayer.addTo(map);
    if (auroraHeatLayer._canvas) auroraHeatLayer._canvas.style.pointerEvents = 'none';
  }
}

async function loadOutages() {
  const payload = await fetchJson('/api/v1/map/layers/internet-outages');
  const features = payload.data.features ?? [];

  clearMarkers('outages');

  const criticals = features.filter(f => f.properties.level === 'critical');
  setText('outage-count', criticals.length || features.length);

  setHtml('outage-list', features.length
    ? features
        .sort((a, b) => b.properties.time - a.properties.time)
        .slice(0, 8)
        .map(f => {
          const p = f.properties;
          const isCritical = p.level === 'critical';
          return `<article class="alert-item">
            <strong>${isCritical ? '🔴' : '🟡'} ${p.name}</strong>
            <span>${p.level} · ${formatShortDate(new Date(p.time * 1000).toISOString())} UTC</span>
          </article>`;
        }).join('')
    : '<p class="empty-state">No active outages</p>'
  );

  features.forEach((feature) => {
    const [lng, lat] = feature.geometry.coordinates;
    const p = feature.properties;
    const emoji = p.level === 'critical' ? '🔴' : '🟡';

    const marker = L.marker([lat, lng], {
      icon: createDivIcon('event-icon-wrap', `<div class="event-icon" aria-hidden="true">${emoji}</div>`, 24),
    });

    bindHover(marker, `${emoji} ${p.name}`, `Internet ${p.level} · ${p.source} · ${formatShortDate(new Date(p.time * 1000).toISOString())} UTC`);
    if (markerVisible('outages')) marker.addTo(map);
    state.markers.outages.push(marker);
  });
}

let sstHeatLayer = null;

async function loadSST() {
  const payload = await fetchJson('/api/v1/map/layers/sst');
  const points = payload.data ?? [];

  // Map -2°C to 34°C → 0 to 1
  const heatPoints = points.map(p => [p.lat, p.lon, Math.max(0, Math.min(1, (p.temp + 2) / 36))]);

  if (sstHeatLayer) {
    sstHeatLayer.setLatLngs(heatPoints);
    return;
  }

  sstHeatLayer = L.heatLayer(heatPoints, {
    radius: 35,
    blur: 25,
    maxZoom: 4,
    max: 1,
    gradient: { 0: '#000066', 0.15: '#0033cc', 0.35: '#00aaff', 0.55: '#00cc88', 0.72: '#ffdd00', 0.87: '#ff6600', 1.0: '#cc0000' },
  });

  if (markerVisible('sst')) {
    sstHeatLayer.addTo(map);
    if (sstHeatLayer._canvas) sstHeatLayer._canvas.style.pointerEvents = 'none';
  }
}

async function loadCO2() {
  const payload = await fetchJson('/api/v1/external/co2');
  const d = payload.data;
  if (d?.ppm) {
    setText('co2-value', d.ppm.toFixed(2));
  }
}

let heatLayer = null;

async function loadLightningPotential() {
  const payload = await fetchJson('/api/v1/lightning/potential');
  const points = payload.data ?? [];

  const heatPoints = points.map(p => [p.lat, p.lon, Math.min(p.value / 4000, 1)]);

  setText('lightning-count', points.length);
  setText('lightning-visible', points.length);

  if (heatLayer) {
    heatLayer.setLatLngs(heatPoints);
    return;
  }

  heatLayer = L.heatLayer(heatPoints, {
    radius: 55,
    blur: 45,
    maxZoom: 4,
    gradient: { 0.2: '#003388', 0.5: '#66aaff', 0.75: '#ffee00', 1.0: '#ff4400' },
  });

  if (markerVisible('lightning')) {
    heatLayer.addTo(map);
    // Prevent the heatmap canvas from blocking mouse events on markers below
    if (heatLayer._canvas) heatLayer._canvas.style.pointerEvents = 'none';
  }
}

async function loadSolar() {
  const payload = await fetchJson('/api/v1/map/layers/solar-events?limit=12');
  const entries = payload.data ?? [];
  setText('solar-feed-count', entries.length);
  setHtml(
    'solar-list',
    entries.length
      ? entries
          .slice(0, 6)
          .map(
            (entry) => `
              <article class="solar-item">
                <strong>${entry.eventType}${entry.classType ? ` ${entry.classType}` : ''}</strong>
                <span>${formatShortDate(entry.time)} UTC</span>
              </article>
            `
          )
          .join('')
      : '<p class="empty-state">No recent solar events in the database</p>'
  );
}

function alertCoordinates(alert) {
  const geometry = alert.geometry;
  if (!geometry) return null;

  if (geometry.type === 'Point') {
    return [geometry.coordinates[1], geometry.coordinates[0]];
  }

  const points =
    geometry.type === 'Polygon'
      ? geometry.coordinates[0]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates[0][0]
        : null;

  if (!points?.length) {
    return null;
  }

  const lat = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  const lng = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  return [lat, lng];
}

async function loadNoaaAlerts() {
  const payload = await fetchJson('/api/v1/external/noaa-alerts');
  const alerts = payload.data ?? [];

  clearMarkers('alerts');
  setText('alert-count', alerts.length);
  setText('alert-feed-count', alerts.length);
  setHtml(
    'alert-list',
    alerts.length
      ? alerts
          .slice(0, 6)
          .map(
            (alert) => `
              <article class="alert-item">
                <strong>${alert.properties?.event ?? 'Alert'}</strong>
                <span>${(alert.properties?.areaDesc ?? '').split(';')[0]}</span>
              </article>
            `
          )
          .join('')
      : '<p class="empty-state">No active severe NOAA alerts</p>'
  );

  alerts.forEach((alert) => {
    const coordinates = alertCoordinates(alert);
    if (!coordinates) return;
    const visual = alertVisual(alert);
    const marker = L.marker(coordinates, {
      icon: createDivIcon(
        'event-icon-wrap',
        `<div class="event-icon" aria-hidden="true">${visual.emoji}</div>`,
        28
      ),
    });

    bindHover(
      marker,
      `${visual.label}: ${alert.properties?.event ?? 'Alert'}`,
      `${(alert.properties?.areaDesc ?? '').split(';')[0]}`
    );

    if (markerVisible('alerts')) {
      marker.addTo(map);
    }

    state.markers.alerts.push(marker);
  });
}

async function loadIss() {
  const payload = await fetchJson('/api/v1/external/iss');
  const iss = payload.data;
  setText('iss-lat', `${Number(iss.latitude).toFixed(2)}°`);
  setText('iss-lon', `${Number(iss.longitude).toFixed(2)}°`);
  setText('iss-alt', `${Math.round(iss.altitude)} km`);
  setText('iss-vel', `${Math.round(iss.velocity).toLocaleString()} km/h`);
  setText('iss-visibility', iss.visibility ?? '--');
}


function updateShipCount() {
  setText('ship-count', state.ships.size);
}

function pruneShips() {
  const threshold = Date.now() - SHIP_STALE_MS;

  state.ships.forEach((entry, mmsi) => {
    if (entry.lastSeen < threshold) {
      entry.marker.remove();
      state.ships.delete(mmsi);
    }
  });

  while (state.ships.size > MAX_SHIPS) {
    const oldest = [...state.ships.entries()].sort((left, right) => left[1].lastSeen - right[1].lastSeen)[0];
    if (!oldest) break;
    oldest[1].marker.remove();
    state.ships.delete(oldest[0]);
  }
}

function shipMeta(ship) {
  const route = ship.destination || 'Unknown route';
  const speed = ship.sog == null ? 'speed --' : `${Number(ship.sog).toFixed(1)} kn`;
  return `${route} • ${speed}`;
}

function upsertShip(ship) {
  if (ship.lat == null || ship.lon == null) return;

  const now = Date.now();
  const existing = state.ships.get(ship.mmsi);

  if (!existing) {
    const marker = L.marker([ship.lat, ship.lon], {
      icon: createDivIcon(
        'event-icon-wrap',
        '<div class="ship-icon" aria-hidden="true">🚢</div>',
        18
      ),
    });

    bindHover(marker, ship.name || ship.mmsi || 'Ship', shipMeta(ship));

    state.ships.set(ship.mmsi, {
      marker,
      ship,
      lastSeen: ship.ts ?? now,
    });

    if (markerVisible('ships')) {
      marker.addTo(map);
    }
  } else {
    existing.ship = { ...existing.ship, ...ship };
    existing.lastSeen = ship.ts ?? now;
    existing.marker.setLatLng([ship.lat, ship.lon]);
    existing.marker.off('mouseover');
    existing.marker.off('mouseout');
    bindHover(existing.marker, existing.ship.name || existing.ship.mmsi || 'Ship', shipMeta(existing.ship));
  }

  pruneShips();

  if (globeState.active && globeState.initialized) {
    upsertShipOnGlobe(ship);
  }
}

async function loadShipSnapshot() {
  const payload = await fetchJson('/api/ships/snapshot');
  const ships = payload.ships ?? [];
  ships.forEach(upsertShip);
  updateShipCount();
  setShipStreamStatus(ships.length ? 'Snapshot ready' : 'No live ships');
}

function connectShips() {
  if (state.shipSocket && state.shipSocket.readyState === WebSocket.OPEN) {
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws/ships`);
  state.shipSocket = socket;
  setShipStreamStatus('Connecting');

  socket.addEventListener('open', () => {
    setShipStreamStatus('Streaming');
  });

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'snapshot') {
      payload.ships.forEach(upsertShip);
    }
    if (payload.type === 'ship') {
      upsertShip(payload.data);
    }
    updateShipCount();
  });

  socket.addEventListener('error', async () => {
    setShipStreamStatus('Fallback');
    try {
      await loadShipSnapshot();
    } catch (error) {
      reportError('ships:fallback', error);
    }
  });

  socket.addEventListener('close', () => {
    setShipStreamStatus('Reconnecting');
    window.setTimeout(async () => {
      try {
        await loadShipSnapshot();
      } catch (error) {
        reportError('ships:snapshot', error);
      }

      connectShips();
    }, 10000);
  });
}

document.querySelectorAll('[data-layer]').forEach((button) => {
  button.addEventListener('click', () => {
    const layer = button.dataset.layer;
    state.layers[layer] = !state.layers[layer];
    button.classList.toggle('is-active', state.layers[layer]);

    if (layer === 'ships') {
      state.ships.forEach((entry) => {
        if (state.layers.ships) {
          entry.marker.addTo(map);
        } else {
          entry.marker.remove();
        }
      });
      return;
    }

    if (layer === 'sst' && sstHeatLayer) {
      if (state.layers.sst) {
        sstHeatLayer.addTo(map);
        if (sstHeatLayer._canvas) sstHeatLayer._canvas.style.pointerEvents = 'none';
      } else {
        sstHeatLayer.remove();
      }
      return;
    }

    if (layer === 'aurora' && auroraHeatLayer) {
      if (state.layers.aurora) {
        auroraHeatLayer.addTo(map);
        if (auroraHeatLayer._canvas) auroraHeatLayer._canvas.style.pointerEvents = 'none';
      } else {
        auroraHeatLayer.remove();
      }
      return;
    }

    if (layer === 'lightning' && heatLayer) {
      if (state.layers.lightning) {
        heatLayer.addTo(map);
        if (heatLayer._canvas) heatLayer._canvas.style.pointerEvents = 'none';
      } else {
        heatLayer.remove();
      }
      return;
    }

    const markerSet = state.markers[layer] ?? [];
    markerSet.forEach((marker) => {
      if (state.layers[layer]) {
        marker.addTo(map);
      } else {
        marker.remove();
      }
    });
  });
});

async function init() {
  updateClock();
  updateMoonPhase();
  window.setInterval(updateClock, 1000);
  window.setInterval(updateMoonPhase, 3600000);

  await Promise.all([
    loadSummary(),
    loadEarthquakes(),
    loadNaturalEvents(),
    loadVolcanoes(),
    loadLightningPotential(),
    loadRadiation(),
    loadNuclearPlants(),
    loadWebcams(),
    loadAurora(),
    loadOutages(),
    loadFlights(),
    loadAirQuality(),
    loadSST(),
    loadCO2(),
    loadSolar(),
    loadNoaaAlerts(),
    loadIss(),
    loadShipSnapshot(),
  ]);

  connectShips();
  enableSatGroup('stations');
  hideLoader();

  schedule(60000, loadSummary);
  schedule(300000, loadEarthquakes);
  schedule(300000, loadNaturalEvents);
  schedule(300000, loadVolcanoes);
  schedule(3600000, loadLightningPotential);
  schedule(3600000, loadAurora);
  schedule(900000, loadOutages);
  schedule(60000, loadFlights, { skipWhenHidden: true });
  schedule(86400000, loadSST);
  schedule(21600000, loadCO2);
  schedule(14400000, loadRadiation);
  schedule(3600000, loadAirQuality);
  schedule(86400000, loadNuclearPlants);
  schedule(3600000, loadWebcams);
  schedule(1800000, loadSolar);
  schedule(300000, loadNoaaAlerts);
  schedule(10000, loadIss);
  schedule(60000, async () => {
    pruneShips();
    updateShipCount();
  });
}

init().catch((error) => {
  reportError('init', error);
  setText('global-status', 'Degraded');
  setShipStreamStatus('Unavailable');
  hideLoader();
});

// ── Globe View ──────────────────────────────────────────────────────────────

const globeState = {
  viewer: null,
  tooltip: null,
  initialized: false,
  initializing: false,
  active: false,
  entities: {
    earthquakes: [],
    flights: [],
    ships: new Map(),
  },
};

function eqColorCesium(mag) {
  if (mag >= 7) return Cesium.Color.fromCssColorString('#ff6b6b');
  if (mag >= 6) return Cesium.Color.fromCssColorString('#ff8f5c');
  if (mag >= 5) return Cesium.Color.fromCssColorString('#ffd166');
  return Cesium.Color.fromCssColorString('#7ef7b8');
}

function createGlobeTooltip() {
  const el = document.createElement('div');
  el.className = 'globe-tooltip';
  el.style.display = 'none';
  document.body.appendChild(el);
  return el;
}

function showGlobeTooltip(tooltip, title, meta, canvasX, canvasY, canvas) {
  const rect = canvas.getBoundingClientRect();
  tooltip.innerHTML = `<strong>${title}</strong><br>${meta}`;
  tooltip.style.display = 'block';
  tooltip.style.left = `${rect.left + canvasX + 16}px`;
  tooltip.style.top  = `${rect.top  + canvasY - 36}px`;
}

function hideGlobeTooltip(tooltip) {
  tooltip.style.display = 'none';
}

function attachGlobeHover(viewer, tooltip) {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((movement) => {
    const picked = viewer.scene.pick(movement.endPosition);
    if (
      Cesium.defined(picked) &&
      Cesium.defined(picked.id) &&
      picked.id._ewTitle
    ) {
      showGlobeTooltip(
        tooltip,
        picked.id._ewTitle,
        picked.id._ewMeta,
        movement.endPosition.x,
        movement.endPosition.y,
        viewer.scene.canvas
      );
    } else {
      hideGlobeTooltip(tooltip);
    }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
}

async function initGlobe() {
  if (globeState.initializing || globeState.initialized) return;
  globeState.initializing = true;

  const globeLoading = document.getElementById('globe-loading');
  if (globeLoading) globeLoading.classList.remove('is-hidden');

  try {
    const config = await fetchJson('/api/config');
    Cesium.Ion.defaultAccessToken = config.cesiumIonToken;

    const creditEl = document.createElement('div');

    const viewer = new Cesium.Viewer('cesium-container', {
      terrain: Cesium.Terrain.fromWorldTerrain(),
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      creditContainer: creditEl,
    });

    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#07131d');
    viewer.scene.globe.enableLighting = false;
    viewer.scene.globe.atmosphereHueShift = -0.05;
    viewer.scene.globe.atmosphereSaturationShift = -0.3;
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#071822');

    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(8, 20, 18000000),
    });

    const tooltip = createGlobeTooltip();
    globeState.tooltip = tooltip;
    attachGlobeHover(viewer, tooltip);

    globeState.viewer = viewer;
    globeState.initialized = true;
  } catch (err) {
    reportError('globe:init', err);
  } finally {
    globeState.initializing = false;
    if (globeLoading) globeLoading.classList.add('is-hidden');
  }
}

function clearGlobeLayer(key) {
  if (!globeState.viewer) return;
  const list = globeState.entities[key];
  if (Array.isArray(list)) {
    list.forEach(e => globeState.viewer.entities.remove(e));
    globeState.entities[key] = [];
  }
}

function renderEarthquakesOnGlobe() {
  if (!globeState.viewer) return;
  clearGlobeLayer('earthquakes');
  const visible = state.layers.earthquakes !== false;
  (state.rawData.earthquakes ?? []).forEach(feature => {
    const [lng, lat] = feature.geometry.coordinates;
    const mag = feature.properties.magnitude ?? 0;
    const color = eqColorCesium(mag);
    const radius = Math.max(50000, mag * 95000);
    const entity = globeState.viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lng, lat),
      show: visible,
      ellipse: {
        semiMinorAxis: radius,
        semiMajorAxis: radius,
        material: color.withAlpha(0.2),
        outline: true,
        outlineColor: color.withAlpha(0.85),
        outlineWidth: 1.5,
        height: 0,
      },
    });
    entity._ewTitle = `M${mag.toFixed(1)} – ${feature.properties.place ?? 'Unknown'}`;
    entity._ewMeta  = formatShortDate(feature.properties.time) + ' UTC';
    globeState.entities.earthquakes.push(entity);
  });
}

function renderFlightsOnGlobe() {
  if (!globeState.viewer) return;
  clearGlobeLayer('flights');
  const visible = state.layers.flights !== false;
  (state.rawData.flights ?? []).forEach(feature => {
    const [lng, lat] = feature.geometry.coordinates;
    const p = feature.properties;
    const alt = Math.max(500, p.altM ?? 10000);
    const altFt = p.altM != null ? `${Math.round(p.altM / 0.3048 / 100) * 100} ft` : '--';
    const spd   = p.speedMs != null ? `${Math.round(p.speedMs * 1.94)} kn` : '--';
    const entity = globeState.viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lng, lat, alt),
      show: visible,
      point: {
        pixelSize: 4,
        color: Cesium.Color.fromCssColorString('#67d4ff'),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.5),
        outlineWidth: 1,
        heightReference: Cesium.HeightReference.NONE,
      },
    });
    entity._ewTitle = p.callsign || p.icao || 'Unknown';
    entity._ewMeta  = `${p.country || ''} · ${altFt} · ${spd}`.replace(/^·\s*/, '');
    globeState.entities.flights.push(entity);
  });
}

function upsertShipOnGlobe(ship) {
  if (!globeState.viewer || ship.lat == null || ship.lon == null) return;
  const visible = state.layers.ships !== false;
  const pos = Cesium.Cartesian3.fromDegrees(ship.lon, ship.lat, 5);
  const existing = globeState.entities.ships.get(ship.mmsi);
  if (existing) {
    existing.position  = new Cesium.ConstantPositionProperty(pos);
    existing._ewTitle  = ship.name || String(ship.mmsi) || 'Ship';
    existing._ewMeta   = shipMeta(ship);
  } else {
    const entity = globeState.viewer.entities.add({
      position: pos,
      show: visible,
      point: {
        pixelSize: 5,
        color: Cesium.Color.fromCssColorString('#3fb950'),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.5),
        outlineWidth: 1,
      },
    });
    entity._ewTitle = ship.name || String(ship.mmsi) || 'Ship';
    entity._ewMeta  = shipMeta(ship);
    globeState.entities.ships.set(ship.mmsi, entity);
  }
}

// Sync globe layer visibility when a layer toggle button is clicked.
// This runs as a second listener alongside the existing Leaflet handler.
document.querySelectorAll('[data-layer]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!globeState.active || !globeState.initialized) return;
    const layer   = button.dataset.layer;
    const visible = state.layers[layer]; // already flipped by the first listener

    if (layer === 'earthquakes') {
      globeState.entities.earthquakes.forEach(e => { e.show = visible; });
    } else if (layer === 'flights') {
      globeState.entities.flights.forEach(e => { e.show = visible; });
    } else if (layer === 'ships') {
      globeState.entities.ships.forEach(entity => { entity.show = visible; });
    }
  });
});

async function activateGlobe() {
  document.getElementById('map').style.display = 'none';
  document.getElementById('cesium-container').style.display = 'block';
  document.getElementById('view-map-btn').classList.remove('is-active');
  document.getElementById('view-globe-btn').classList.add('is-active');
  const modeLabel = document.getElementById('map-mode-label');
  if (modeLabel) modeLabel.textContent = 'Globe 3D';
  globeState.active = true;

  if (!globeState.initialized) {
    await initGlobe();
  }

  if (globeState.viewer) {
    renderEarthquakesOnGlobe();
    renderFlightsOnGlobe();
    state.ships.forEach(entry => upsertShipOnGlobe(entry.ship));
  }
}

function deactivateGlobe() {
  document.getElementById('map').style.display = '';
  document.getElementById('cesium-container').style.display = 'none';
  document.getElementById('view-map-btn').classList.add('is-active');
  document.getElementById('view-globe-btn').classList.remove('is-active');
  const modeLabel = document.getElementById('map-mode-label');
  if (modeLabel) modeLabel.textContent = 'Wrapped';
  globeState.active = false;
  if (globeState.tooltip) hideGlobeTooltip(globeState.tooltip);
}

document.getElementById('view-globe-btn').addEventListener('click', () => {
  activateGlobe().catch(err => reportError('globe:activate', err));
});
document.getElementById('view-map-btn').addEventListener('click', deactivateGlobe);
