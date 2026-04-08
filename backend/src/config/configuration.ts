/**
 * Central configuration factory for IEA Growth Intelligence.
 * Reads environment variables and provides typed defaults.
 */
export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  database: {
    url: process.env.DATABASE_URL,
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
    user: process.env.DATABASE_USER ?? 'postgres',
    password: process.env.DATABASE_PASSWORD ?? 'postgres',
    name: process.env.DATABASE_NAME ?? 'route_iea',
  },

  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '24h',
  },

  googleMaps: {
    apiKey: process.env.GOOGLE_MAPS_API_KEY ?? '',
  },

  company: {
    name: process.env.COMPANY_NAME ?? 'Ingenieria Electrica Alanis',
    lat: parseFloat(process.env.COMPANY_LAT ?? '20.6636914'),
    lng: parseFloat(process.env.COMPANY_LNG ?? '-103.2343897'),
  },

  cors: {
    origins: (process.env.CORS_ORIGINS ?? 'http://localhost:3001').split(','),
  },

  gps: {
    updateIntervalMs: parseInt(process.env.GPS_UPDATE_INTERVAL_MS ?? '5000', 10),
    historyRetentionDays: parseInt(process.env.GPS_HISTORY_RETENTION_DAYS ?? '90', 10),
  },

  logging: {
    level: process.env.LOG_LEVEL ?? 'debug',
  },
});
