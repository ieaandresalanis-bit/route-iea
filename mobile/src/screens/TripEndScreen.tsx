/**
 * TripEndScreen — Mandatory trip completion flow.
 *
 * Steps (all required):
 * 1. Take final odometer photo (expo-camera)
 * 2. Enter final odometer reading
 * 3. Fuel log (optional): camera receipt or manual entry
 * 4. Incident report (optional): description + severity
 * 5. Close trip -> PATCH /api/trips/:id/complete
 *
 * Business rules:
 * - Final odometer must be >= start odometer
 * - GPS tracking stops after trip completion
 * - All data timestamped
 *
 * TODO: Camera for final odometer photo
 * TODO: Odometer input with delta calculation
 * TODO: Optional fuel log form (link to FuelLogScreen)
 * TODO: Optional incident report
 * TODO: PATCH /api/trips/:id/complete
 */

import React from 'react';

export default function TripEndScreen() {
  return null; // Placeholder
}
