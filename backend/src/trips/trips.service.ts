import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { TripStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateTripDto } from './dto/create-trip.dto';

@Injectable()
export class TripsService {
  private readonly logger = new Logger(TripsService.name);

  constructor(private prisma: PrismaService) {}

  /** Create a new trip with optional waypoints */
  async create(dto: CreateTripDto) {
    const { waypoints, ...tripData } = dto;

    const trip = await this.prisma.trip.create({
      data: {
        ...tripData,
        plannedStartTime: dto.plannedStartTime ? new Date(dto.plannedStartTime) : undefined,
        waypoints: waypoints
          ? { createMany: { data: waypoints } }
          : undefined,
      },
      include: { waypoints: true },
    });

    this.logger.log(`Trip created: ${trip.id} — ${trip.title}`);
    return trip;
  }

  /** List trips with optional status filter */
  async findAll(status?: TripStatus) {
    return this.prisma.trip.findMany({
      where: {
        deletedAt: null,
        ...(status ? { status } : {}),
      },
      include: {
        vehicle: { select: { id: true, plateNumber: true, brand: true, model: true } },
        driver: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Get a single trip with all details */
  async findOne(id: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      include: {
        vehicle: true,
        driver: { select: { id: true, firstName: true, lastName: true, phone: true } },
        waypoints: { orderBy: { order: 'asc' } },
      },
    });
    if (!trip) throw new NotFoundException(`Trip ${id} not found`);
    return trip;
  }

  /** Start a trip — changes status to IN_PROGRESS */
  async start(id: string) {
    const trip = await this.findOne(id);
    if (trip.status !== 'PLANNED') {
      throw new BadRequestException(`Trip is ${trip.status}, can only start PLANNED trips`);
    }

    const updated = await this.prisma.trip.update({
      where: { id },
      data: { status: 'IN_PROGRESS', actualStartTime: new Date() },
    });

    this.logger.log(`Trip ${id} started`);
    return updated;
  }

  /** Complete a trip */
  async complete(id: string, actualDistanceKm?: number) {
    const trip = await this.findOne(id);
    if (trip.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Trip must be IN_PROGRESS to complete');
    }

    const updated = await this.prisma.trip.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        actualEndTime: new Date(),
        actualDistanceKm,
      },
    });

    this.logger.log(`Trip ${id} completed`);
    return updated;
  }

  /** Cancel a trip */
  async cancel(id: string) {
    const trip = await this.findOne(id);
    if (trip.status === 'COMPLETED') {
      throw new BadRequestException('Cannot cancel a completed trip');
    }

    const updated = await this.prisma.trip.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    this.logger.log(`Trip ${id} cancelled`);
    return updated;
  }
}
