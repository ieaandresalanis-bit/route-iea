/**
 * GPS location service for the mobile app.
 *
 * Uses expo-location to track the device position
 * and sends updates to the backend via WebSocket.
 *
 * TODO: Install expo-location and implement:
 * - Location.requestForegroundPermissionsAsync()
 * - Location.watchPositionAsync() with CONFIG.GPS_INTERVAL_MS
 * - Emit 'gps:position' via socket on each update
 * - Location.Accuracy.Balanced for battery efficiency
 */

import { CONFIG } from '../constants/config';

export interface LocationUpdate {
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  timestamp: number;
}

/**
 * Start watching the device location.
 * In production, this would use expo-location.
 */
export function startLocationTracking(
  vehicleId: string,
  onUpdate: (location: LocationUpdate) => void,
): () => void {
  console.log(`[GPS] Starting tracking for vehicle ${vehicleId}`);
  console.log(`[GPS] Interval: ${CONFIG.GPS_INTERVAL_MS}ms, Distance filter: ${CONFIG.GPS_DISTANCE_FILTER}m`);

  // TODO: Replace with expo-location watchPositionAsync
  // For now, return a no-op cleanup function
  return () => {
    console.log(`[GPS] Stopped tracking for vehicle ${vehicleId}`);
  };
}
