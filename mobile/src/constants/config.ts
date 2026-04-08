/**
 * IEA Growth Intelligence Mobile - Configuration constants
 */
export const CONFIG = {
  API_URL: 'http://localhost:3000/api',
  WS_URL: 'http://localhost:3000',

  // Company HQ — Guadalajara, Jalisco
  COMPANY_LAT: 20.6636914,
  COMPANY_LNG: -103.2343897,
  COMPANY_NAME: 'Ingenieria Electrica Alanis',

  // GPS tracking
  GPS_INTERVAL_MS: 15000, // send position every 15 seconds
  GPS_DISTANCE_FILTER: 10, // minimum meters between updates

  // Brand colors
  COLORS: {
    brand: '#F97316',
    brandDark: '#EA580C',
    white: '#FFFFFF',
    background: '#F9FAFB',
    text: '#111827',
    textLight: '#6B7280',
    success: '#22C55E',
    danger: '#EF4444',
    warning: '#F59E0B',
  },
};
