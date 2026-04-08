import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateOdometerLogDto } from './dto/create-odometer-log.dto';

@Injectable()
export class OdometerService {
  private readonly logger = new Logger(OdometerService.name);

  constructor(private prisma: PrismaService) {}

  /** Record a new odometer reading */
  async create(userId: string, dto: CreateOdometerLogDto) {
    // Validate reading is not less than current odometer
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: dto.vehicleId },
    });

    if (vehicle && dto.reading < vehicle.currentOdometer) {
      throw new BadRequestException(
        `Reading ${dto.reading} km is less than current odometer ${vehicle.currentOdometer} km`,
      );
    }

    const log = await this.prisma.odometerLog.create({
      data: {
        vehicleId: dto.vehicleId,
        userId,
        reading: dto.reading,
        source: dto.source ?? 'manual',
        notes: dto.notes,
        recordedAt: new Date(),
      },
    });

    // Update the vehicle's current odometer
    await this.prisma.vehicle.update({
      where: { id: dto.vehicleId },
      data: { currentOdometer: dto.reading },
    });

    this.logger.log(`Odometer: ${dto.vehicleId} = ${dto.reading} km`);
    return log;
  }

  /** Get odometer history for a vehicle */
  async findByVehicle(vehicleId: string) {
    return this.prisma.odometerLog.findMany({
      where: { vehicleId },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { recordedAt: 'desc' },
    });
  }
}
