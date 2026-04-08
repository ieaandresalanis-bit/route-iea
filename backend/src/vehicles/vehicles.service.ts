import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(private prisma: PrismaService) {}

  /** Create a new vehicle */
  async create(dto: CreateVehicleDto) {
    const existing = await this.prisma.vehicle.findUnique({
      where: { plateNumber: dto.plateNumber },
    });
    if (existing) throw new ConflictException(`Plate ${dto.plateNumber} already registered`);

    const vehicle = await this.prisma.vehicle.create({ data: dto });
    this.logger.log(`Vehicle created: ${vehicle.plateNumber}`);
    return vehicle;
  }

  /** List all vehicles with optional status filter */
  async findAll(status?: string) {
    return this.prisma.vehicle.findMany({
      where: {
        deletedAt: null,
        ...(status ? { status: status as any } : {}),
      },
      include: {
        driver: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { plateNumber: 'asc' },
    });
  }

  /** Get one vehicle with full details */
  async findOne(id: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      include: {
        driver: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        gpsLogs: { orderBy: { recordedAt: 'desc' }, take: 1 }, // latest GPS position
      },
    });
    if (!vehicle) throw new NotFoundException(`Vehicle ${id} not found`);
    return vehicle;
  }

  /** Update vehicle */
  async update(id: string, dto: UpdateVehicleDto) {
    await this.findOne(id);
    const updated = await this.prisma.vehicle.update({ where: { id }, data: dto });
    this.logger.log(`Vehicle ${id} updated`);
    return updated;
  }

  /** Soft-delete vehicle */
  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.vehicle.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
    this.logger.log(`Vehicle ${id} deactivated`);
  }

  /** Get fleet summary for dashboard */
  async getFleetSummary() {
    const [total, active, maintenance, inactive] = await Promise.all([
      this.prisma.vehicle.count({ where: { deletedAt: null } }),
      this.prisma.vehicle.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      this.prisma.vehicle.count({ where: { status: 'MAINTENANCE', deletedAt: null } }),
      this.prisma.vehicle.count({ where: { status: 'INACTIVE', deletedAt: null } }),
    ]);
    return { total, active, maintenance, inactive };
  }
}
