import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { FuelOcrService } from './fuel-ocr.service';
import { FuelIntelligenceService } from './fuel-intelligence.service';
import { CreateFuelLogDto } from './dto/create-fuel-log.dto';
import { OcrResultDto } from './dto/ocr-result.dto';

@Injectable()
export class FuelService {
  private readonly logger = new Logger(FuelService.name);

  constructor(
    private prisma: PrismaService,
    private ocrService: FuelOcrService,
    private intelligence: FuelIntelligenceService,
  ) {}

  // ── Create ──────────────────────────────────────────────────

  /**
   * Create a fuel log with full validation.
   * 1. Validate odometer is greater than current
   * 2. Validate consumption is in reasonable range
   * 3. Save the log with all fields
   * 4. Update the vehicle's current odometer
   */
  async create(userId: string, dto: CreateFuelLogDto) {
    // 1. Validate odometer
    await this.intelligence.validateOdometer(dto.vehicleId, dto.odometerAt);

    // 2. Check consumption against previous fill-up
    const previousLog = await this.prisma.fuelLog.findFirst({
      where: { vehicleId: dto.vehicleId },
      orderBy: { odometerAt: 'desc' },
    });

    if (previousLog) {
      const kmDriven = dto.odometerAt - previousLog.odometerAt;
      this.intelligence.validateConsumption(kmDriven, dto.liters);
    }

    // 3. Save the fuel log (map DTO "amount" to DB "totalCost")
    const log = await this.prisma.fuelLog.create({
      data: {
        vehicleId: dto.vehicleId,
        userId,
        liters: dto.liters,
        pricePerLiter: dto.pricePerLiter,
        totalCost: dto.amount, // DTO uses "amount", DB uses "totalCost"
        odometerAt: dto.odometerAt,
        fuelType: dto.fuelType,
        station: dto.station,
        notes: dto.notes,
        latitude: dto.latitude,
        longitude: dto.longitude,
        imageUrl: dto.imageUrl,
        source: dto.source ?? 'MANUAL',
        filledAt: new Date(dto.filledAt),
      },
    });

    // 4. Update vehicle odometer
    await this.prisma.vehicle.update({
      where: { id: dto.vehicleId },
      data: { currentOdometer: dto.odometerAt },
    });

    this.logger.log(
      `Fuel log: ${dto.liters}L / $${dto.amount} MXN for vehicle ${dto.vehicleId} ` +
      `(odometer: ${dto.odometerAt} km, source: ${dto.source ?? 'MANUAL'})`,
    );

    return log;
  }

  // ── Read ────────────────────────────────────────────────────

  /** List all fuel logs with pagination and optional vehicle filter */
  async findAll(page = 1, limit = 20, vehicleId?: string) {
    const skip = (page - 1) * limit;

    const where = vehicleId ? { vehicleId } : {};

    const [items, total] = await Promise.all([
      this.prisma.fuelLog.findMany({
        where,
        include: {
          vehicle: { select: { plateNumber: true, brand: true, model: true } },
          user: { select: { firstName: true, lastName: true } },
        },
        orderBy: { filledAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.fuelLog.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** Get fuel history for a specific vehicle */
  async findByVehicle(vehicleId: string) {
    return this.prisma.fuelLog.findMany({
      where: { vehicleId },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { filledAt: 'desc' },
    });
  }

  // ── OCR ─────────────────────────────────────────────────────

  /** Process a receipt image and return extracted data for user confirmation */
  async processReceipt(imageUrl: string): Promise<OcrResultDto> {
    return this.ocrService.processReceipt(imageUrl);
  }

  // ── Intelligence (delegated) ─────────────────────────────────

  /** Get km/L and cost/km for a vehicle */
  async getEfficiency(vehicleId: string) {
    return this.intelligence.calculateEfficiency(vehicleId);
  }

  /** Get comprehensive fuel stats with anomaly detection */
  async getVehicleStats(vehicleId: string) {
    return this.intelligence.getVehicleFuelStats(vehicleId);
  }

  // ── Dashboard ───────────────────────────────────────────────

  /** Fleet-wide fuel dashboard data */
  async getFleetDashboard() {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Total fuel cost this month
    const monthlyAgg = await this.prisma.fuelLog.aggregate({
      where: { filledAt: { gte: startOfMonth } },
      _sum: { totalCost: true, liters: true },
      _count: { id: true },
    });

    // Get vehicles with recent fuel activity for average efficiency
    const activeVehicles = await this.prisma.fuelLog.groupBy({
      by: ['vehicleId'],
      _count: { id: true },
      having: { id: { _count: { gte: 2 } } }, // need at least 2 logs
    });

    // Calculate average fleet efficiency
    let totalEfficiency = 0;
    let vehicleCount = 0;

    for (const v of activeVehicles) {
      const eff = await this.intelligence.calculateEfficiency(v.vehicleId);
      if (eff.kmPerLiter && eff.kmPerLiter > 0) {
        totalEfficiency += eff.kmPerLiter;
        vehicleCount++;
      }
    }

    const averageFleetEfficiency = vehicleCount > 0
      ? Math.round((totalEfficiency / vehicleCount) * 100) / 100
      : null;

    // Last fuel load across fleet
    const lastFuelLog = await this.prisma.fuelLog.findFirst({
      orderBy: { filledAt: 'desc' },
      include: {
        vehicle: { select: { plateNumber: true, brand: true, model: true } },
        user: { select: { firstName: true, lastName: true } },
      },
    });

    return {
      thisMonth: {
        totalCost: Math.round((monthlyAgg._sum.totalCost ?? 0) * 100) / 100,
        totalLiters: Math.round((monthlyAgg._sum.liters ?? 0) * 100) / 100,
        fillUps: monthlyAgg._count.id,
      },
      averageFleetEfficiency,
      lastFuelLog,
    };
  }
}
