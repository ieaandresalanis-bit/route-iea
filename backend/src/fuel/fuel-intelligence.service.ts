import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { FuelStatsDto, FuelAnomalyItem } from './dto/fuel-stats.dto';

/** Reasonable km/L range for most vehicles */
const MIN_KM_PER_LITER = 3;
const MAX_KM_PER_LITER = 25;

/** Anomaly threshold: entries beyond this many standard deviations */
const ANOMALY_THRESHOLD = 2;

/**
 * Intelligence layer for fuel data.
 * Handles validation, efficiency calculations, and anomaly detection.
 */
@Injectable()
export class FuelIntelligenceService {
  private readonly logger = new Logger(FuelIntelligenceService.name);

  constructor(private prisma: PrismaService) {}

  // ── Validation ──────────────────────────────────────────────

  /** Ensure the new odometer reading is greater than the vehicle's current odometer */
  async validateOdometer(vehicleId: string, newOdometer: number): Promise<void> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { currentOdometer: true, plateNumber: true },
    });

    if (!vehicle) {
      throw new BadRequestException(`Vehicle ${vehicleId} not found`);
    }

    if (newOdometer <= vehicle.currentOdometer) {
      throw new BadRequestException(
        `Odometer ${newOdometer} km must be greater than current reading ${vehicle.currentOdometer} km ` +
        `for vehicle ${vehicle.plateNumber}`,
      );
    }
  }

  /**
   * Validate that fuel consumption is within a reasonable range.
   * Only called when we have a previous fill-up to compare against.
   */
  validateConsumption(kmDriven: number, liters: number): void {
    if (kmDriven <= 0 || liters <= 0) return; // skip if data is incomplete

    const kmPerLiter = kmDriven / liters;

    if (kmPerLiter < MIN_KM_PER_LITER) {
      this.logger.warn(`Suspiciously low efficiency: ${kmPerLiter.toFixed(1)} km/L`);
      // We warn but don't reject — the user might be filling a nearly empty tank
    }

    if (kmPerLiter > MAX_KM_PER_LITER) {
      this.logger.warn(`Suspiciously high efficiency: ${kmPerLiter.toFixed(1)} km/L — possible odometer error`);
    }
  }

  // ── Efficiency Calculations ──────────────────────────────────

  /** Calculate km/L and cost/km for a vehicle */
  async calculateEfficiency(vehicleId: string) {
    const logs = await this.prisma.fuelLog.findMany({
      where: { vehicleId },
      orderBy: { odometerAt: 'asc' },
    });

    if (logs.length < 2) {
      return { kmPerLiter: null, costPerKm: null, message: 'Need at least 2 fill-ups to calculate efficiency' };
    }

    const firstOdometer = logs[0].odometerAt;
    const lastOdometer = logs[logs.length - 1].odometerAt;
    const totalKm = lastOdometer - firstOdometer;

    // Exclude first fill-up liters (unknown starting fuel level)
    const totalLiters = logs.slice(1).reduce((sum, l) => sum + l.liters, 0);
    const totalCost = logs.slice(1).reduce((sum, l) => sum + l.totalCost, 0);

    const kmPerLiter = totalLiters > 0 ? Math.round((totalKm / totalLiters) * 100) / 100 : 0;
    const costPerKm = totalKm > 0 ? Math.round((totalCost / totalKm) * 100) / 100 : 0;

    return {
      kmPerLiter,
      costPerKm,
      totalKm: Math.round(totalKm),
      totalLiters: Math.round(totalLiters * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      fillUps: logs.length,
    };
  }

  // ── Anomaly Detection ────────────────────────────────────────

  /**
   * Detect anomalous fuel entries using standard deviation.
   * An anomaly is a fill-up where km/L is more than 2 standard deviations
   * away from the vehicle's average.
   */
  async detectAnomalies(vehicleId: string): Promise<FuelAnomalyItem[]> {
    const logs = await this.prisma.fuelLog.findMany({
      where: { vehicleId },
      orderBy: { odometerAt: 'asc' },
    });

    // Need at least 3 data points for meaningful standard deviation
    if (logs.length < 3) return [];

    // Calculate per-segment km/L
    const segments: { id: string; kmPerLiter: number; liters: number; filledAt: Date }[] = [];

    for (let i = 1; i < logs.length; i++) {
      const kmDriven = logs[i].odometerAt - logs[i - 1].odometerAt;
      if (kmDriven > 0 && logs[i].liters > 0) {
        segments.push({
          id: logs[i].id,
          kmPerLiter: kmDriven / logs[i].liters,
          liters: logs[i].liters,
          filledAt: logs[i].filledAt,
        });
      }
    }

    if (segments.length < 3) return [];

    // Calculate mean and standard deviation
    const values = segments.map((s) => s.kmPerLiter);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // Flag entries beyond threshold
    const anomalies = segments
      .filter((s) => Math.abs(s.kmPerLiter - mean) > ANOMALY_THRESHOLD * stdDev)
      .map((s) => ({
        id: s.id,
        kmPerLiter: Math.round(s.kmPerLiter * 100) / 100,
        liters: s.liters,
        filledAt: s.filledAt,
      }));

    if (anomalies.length > 0) {
      this.logger.warn(`Vehicle ${vehicleId}: ${anomalies.length} fuel anomalies detected`);
    }

    return anomalies;
  }

  // ── Comprehensive Stats ──────────────────────────────────────

  /** Get full fuel statistics for a vehicle */
  async getVehicleFuelStats(vehicleId: string): Promise<FuelStatsDto> {
    const [efficiency, anomalies, aggregates] = await Promise.all([
      this.calculateEfficiency(vehicleId),
      this.detectAnomalies(vehicleId),
      this.prisma.fuelLog.aggregate({
        where: { vehicleId },
        _sum: { totalCost: true, liters: true },
        _count: { id: true },
      }),
    ]);

    return {
      avgKmPerLiter: efficiency.kmPerLiter,
      costPerKm: efficiency.costPerKm,
      totalSpent: Math.round((aggregates._sum.totalCost ?? 0) * 100) / 100,
      totalLiters: Math.round((aggregates._sum.liters ?? 0) * 100) / 100,
      totalFillUps: aggregates._count.id,
      anomalyCount: anomalies.length,
      anomalies,
    };
  }
}
