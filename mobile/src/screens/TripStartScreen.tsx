/**
 * TripStartScreen — Mandatory trip start flow.
 *
 * Steps (all required):
 * 1. Select vehicle (from assigned vehicles)
 * 2. Confirm destination (map picker or address search)
 * 3. Take odometer photo (expo-camera)
 * 4. Enter odometer reading (manual input)
 * 5. Confirm vehicle status (checklist)
 * 6. Start trip -> POST /api/trips + begin GPS tracking
 *
 * Business rules:
 * - No trip without assigned vehicle
 * - No trip without odometer capture
 * - Odometer must be >= vehicle.currentOdometer
 * - GPS tracking starts immediately after trip creation
 *
 * TODO: Implement step-by-step wizard UI
 * TODO: Camera integration for odometer photo
 * TODO: Google Maps destination picker
 */

import React from 'react';

export default function TripStartScreen() {
  // TODO: Multi-step wizard state
  // TODO: Vehicle selection from GET /api/vehicles
  // TODO: Destination map picker or address input
  // TODO: Camera for odometer photo
  // TODO: Odometer input with validation
  // TODO: Vehicle status checklist
  // TODO: POST /api/trips to create trip
  // TODO: Start location tracking

  return null; // Placeholder
}
