/**
 * HomeScreen — Main screen with embedded Google Map and trip status.
 *
 * Layout:
 * ┌──────────────────────────┐
 * │      Google Maps          │  (60% of screen)
 * │   [current location]      │
 * │                           │
 * ├──────────────────────────┤
 * │  Active Trip Card         │  (if trip in progress)
 * │  - destination            │
 * │  - ETA                    │
 * │  - speed                  │
 * ├──────────────────────────┤
 * │  [Iniciar Viaje] button   │  (if no active trip)
 * └──────────────────────────┘
 *
 * TODO:
 * - react-native-maps MapView centered on user location
 * - Show current position marker
 * - If active trip: show route polyline, destination marker, ETA
 * - WebSocket: send GPS position every 15-30 seconds
 * - "Iniciar Viaje" button navigates to TripStartScreen
 */

import React from 'react';

export default function HomeScreen() {
  // TODO: useLocation() hook for current position
  // TODO: useActiveTrip() hook for current trip state
  // TODO: MapView with current location marker
  // TODO: Active trip overlay card

  return null; // Placeholder
}
