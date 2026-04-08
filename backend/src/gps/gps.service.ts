import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { GpsPositionDto } from './dto/gps-position.dto';

@Injectable()
export class GpsService {
  private readonly logger = new Logger(GpsService.name);

  constructor(private prisma: PrismaService) {}

  /** Record a new GPS position for a vehicle */
  async recordPosition(dto: GpsPositionDto) {
    const log = await this.prisma.gpsLog.create({
      data: {
        vehicleId: dto.vehicleId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        altitude: dto.altitude,
        speed: dto.speed,
        heading: dto.heading,
        accuracy: dto.accuracy,
        engineOn: dto.engineOn,
        recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
      },
    });

    this.logger.debug(`GPS: ${dto.vehicleId} -> ${dto.latitude},${dto.longitude}`);
    return log;
  }

  /** Batch-record multiple positions (efficient for bulk uploads) */
  async recordBatch(positions: GpsPositionDto[]) {
    const data = positions.map((p) => ({
      vehicleId: p.vehicleId,
      latitude: p.latitude,
      longitude: p.longitude,
      altitude: p.altitude,
      speed: p.speed,
      heading: p.heading,
      accuracy: p.accuracy,
      engineOn: p.engineOn,
      recordedAt: p.recordedAt ? new Date(p.recordedAt) : new Date(),
    }));

    const result = await this.prisma.gpsLog.createMany({ data });
    this.logger.log(`GPS batch: ${result.count} positions recorded`);
    return { count: result.count };
  }

  /** Get the latest position for each active vehicle */
  async getLatestPositions() {
    // Raw query for best performance — gets latest GPS per vehicle
    const positions = await this.prisma.$queryRaw`
      SELECT DISTINCT ON (g.vehicle_id)
        g.id, g.vehicle_id, g.latitude, g.longitude, g.speed,
        g.heading, g.engine_on, g.recorded_at,
        v.plate_number, v.brand, v.model
      FROM gps_logs g
      JOIN vehicles v ON v.id = g.vehicle_id
      WHERE v.status = 'ACTIVE' AND v.deleted_at IS NULL
      ORDER BY g.vehicle_id, g.recorded_at DESC
    `;
    return positions;
  }

  /** Get GPS history for a vehicle within a time range */
  async getVehicleHistory(vehicleId: string, from: Date, to: Date) {
    return this.prisma.gpsLog.findMany({
      where: {
        vehicleId,
        recordedAt: { gte: from, lte: to },
      },
      orderBy: { recordedAt: 'asc' },
    });
  }

  /** Get latest single position for one vehicle */
  async getVehicleLatest(vehicleId: string) {
    return this.prisma.gpsLog.findFirst({
      where: { vehicleId },
      orderBy: { recordedAt: 'desc' },
    });
  }
}
