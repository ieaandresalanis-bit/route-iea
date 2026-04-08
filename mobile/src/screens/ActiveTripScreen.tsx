/**
 * ActiveTripScreen — Live trip tracking with map and controls.
 *
 * Layout:
 * ┌──────────────────────────┐
 * │      Google Maps          │  Full map with:
 * │   [route polyline]        │  - Current position
 * │   [destination marker]    │  - Route to destination
 * │                           │  - ETA + distance remaining
 * ├──────────────────────────┤
 * │  Trip Info Bar            │
 * │  Speed: 65 km/h           │
 * │  ETA: 15 min              │
 * │  Distance: 12.3 km        │
 * ├──────────────────────────┤
 * │  [Llegue] [Completar]     │  Action buttons
 * └──────────────────────────┘
 *
 * Background behaviors:
 * - GPS sent every 15-30 seconds via WebSocket (gps:position)
 * - Geofencing: auto-detect arrival at destination
 * - Notify backend when: near destination (10 min), arrived, left
 * - Route deviation detection (compare actual vs planned route)
 *
 * TODO: Implement react-native-maps with route drawing
 * TODO: Background location tracking
 * TODO: Geofence arrival detection
 */

import React from 'react';

export default function ActiveTripScreen() {
  return null; // Placeholder
}
