/**
 * FuelLogScreen — Fuel logging with camera OCR or manual entry.
 *
 * Two modes:
 *
 * Option A — Camera (smart):
 * 1. Take photo of fuel receipt
 * 2. POST /api/fuel/receipt with imageUrl
 * 3. Show extracted data (station, liters, amount, confidence)
 * 4. User confirms or edits
 * 5. POST /api/fuel with source: CAMERA
 *
 * Option B — Manual:
 * 1. Fill form: liters, amount, fuel type, odometer, station
 * 2. POST /api/fuel with source: MANUAL
 *
 * Fields:
 * - vehicleId (auto from assigned vehicle)
 * - liters
 * - amount (MXN)
 * - pricePerLiter (calculated)
 * - odometerAt
 * - fuelType
 * - station
 * - latitude/longitude (auto from device)
 * - filledAt
 *
 * Validations:
 * - Odometer must be > previous
 * - Consumption must be reasonable (3-25 km/L)
 *
 * TODO: expo-camera for receipt photo
 * TODO: OCR integration via /api/fuel/receipt
 * TODO: Manual form with validation
 * TODO: expo-location for automatic coordinates
 */

import React from 'react';

export default function FuelLogScreen() {
  return null; // Placeholder
}
