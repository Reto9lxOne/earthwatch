import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    throw new Error(`${name} must be an integer`);
  }

  return value;
}

function readString(name, fallback) {
  const value = process.env[name];
  return value && value.trim() ? value : fallback;
}

export const env = Object.freeze({
  nodeEnv: readString('NODE_ENV', 'development'),
  host: readString('HOST', '0.0.0.0'),
  port: readInt('PORT', 3001),
  logLevel: readString('LOG_LEVEL', 'info'),
  publicDir: path.resolve(__dirname, '../../public'),
  dbHost: readString('DB_HOST', '127.0.0.1'),
  dbPort: readInt('DB_PORT', 5432),
  dbName: readString('DB_NAME', 'earthwatch'),
  dbUser: readString('DB_USER', 'earthwatch'),
  dbPassword: readString('DB_PASSWORD', ''),
  requestTimeoutMs: readInt('REQUEST_TIMEOUT_MS', 10000),
  externalCacheTtlMs: readInt('EXTERNAL_CACHE_TTL_MS', 60000),
  publicBaseUrl: readString('PUBLIC_BASE_URL', ''),
  windyWebcamsKey: readString('WINDY_WEBCAMS_KEY', ''),
  waqiToken: readString('WAQI_TOKEN', ''),
  cesiumIonToken: readString('CESIUM_ION_TOKEN', ''),
  openskyUser: readString('OPENSKY_USER', ''),
  openskyPass: readString('OPENSKY_PASS', ''),
});
