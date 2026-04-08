// Shared types — same as dashboard/src/types/index.ts
// In production, extract to a shared package

export type UserRole = 'ADMIN' | 'SUPERVISOR' | 'OPERATOR' | 'VIEWER';
export type VehicleStatus = 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE' | 'DECOMMISSIONED';
export type TripStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type FuelType = 'GASOLINE' | 'DIESEL' | 'ELECTRIC' | 'HYBRID';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  phone?: string;
}

export interface Vehicle {
  id: string;
  plateNumber: string;
  brand: string;
  model: string;
  year: number;
  type: string;
  currentOdometer: number;
}

export interface Trip {
  id: string;
  title: string;
  status: TripStatus;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  destAddress: string;
  vehicleId: string;
  driverId: string;
}

export interface GpsPosition {
  vehicleId: string;
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
  engineOn?: boolean;
}
