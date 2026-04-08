import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { RouteStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { GoogleDirectionsService } from './google-directions.service';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';

@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name);

  constructor(
    private prisma: PrismaService,
    private directions: GoogleDirectionsService,
  ) {}

  async create(dto: CreateRouteDto) {
    const { stops, ...routeData } = dto;

    const route = await this.prisma.visitRoute.create({
      data: {
        ...routeData,
        plannedDate: dto.plannedDate ? new Date(dto.plannedDate) : undefined,
        stops: stops?.length
          ? { createMany: { data: stops } }
          : undefined,
      },
      include: { stops: { include: { lead: true }, orderBy: { order: 'asc' } } },
    });

    this.logger.log(`Route created: ${route.id} — ${route.name}`);
    return route;
  }

  async findAll(status?: RouteStatus) {
    return this.prisma.visitRoute.findMany({
      where: {
        deletedAt: null,
        ...(status ? { status } : {}),
      },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { stops: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const route = await this.prisma.visitRoute.findUnique({
      where: { id },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        vehicle: { select: { id: true, plateNumber: true, brand: true, model: true } },
        stops: {
          include: {
            lead: {
              select: {
                id: true, companyName: true, contactName: true, contactPhone: true,
                latitude: true, longitude: true, address: true, zone: true, status: true,
              },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });
    if (!route || route.deletedAt) throw new NotFoundException(`Route ${id} not found`);
    return route;
  }

  async update(id: string, dto: UpdateRouteDto) {
    await this.findOne(id);
    const { stops, ...data } = dto;
    const updated = await this.prisma.visitRoute.update({
      where: { id },
      data: {
        ...data,
        plannedDate: dto.plannedDate ? new Date(dto.plannedDate) : undefined,
      },
    });
    this.logger.log(`Route updated: ${id}`);
    return updated;
  }

  async addStop(routeId: string, leadId: string, order: number) {
    await this.findOne(routeId);
    return this.prisma.routeStop.create({
      data: { routeId, leadId, order },
      include: { lead: true },
    });
  }

  async removeStop(routeId: string, stopId: string) {
    const stop = await this.prisma.routeStop.findUnique({ where: { id: stopId } });
    if (!stop || stop.routeId !== routeId) {
      throw new NotFoundException('Stop not found in this route');
    }
    await this.prisma.routeStop.delete({ where: { id: stopId } });
    this.logger.log(`Stop ${stopId} removed from route ${routeId}`);
  }

  /** Call Google Directions API and save optimized route */
  async optimize(id: string) {
    const route = await this.findOne(id);
    if (route.stops.length < 1) {
      throw new BadRequestException('Route needs at least 1 stop to optimize');
    }

    const origin = { lat: route.originLat, lng: route.originLng };
    const waypoints = route.stops.map((s) => ({
      lat: s.lead.latitude,
      lng: s.lead.longitude,
    }));

    const result = await this.directions.optimizeRoute({
      origin,
      waypoints,
      optimizeWaypoints: true,
    });

    // Update route with directions data
    const updated = await this.prisma.visitRoute.update({
      where: { id },
      data: {
        totalDistanceKm: result.totalDistanceKm,
        totalDurationMins: result.totalDurationMins,
        directionsPolyline: result.polyline,
        optimizedOrder: result.waypointOrder,
      },
    });

    // Update each stop with its optimized order and estimated times
    for (let i = 0; i < result.waypointOrder.length; i++) {
      const originalIndex = result.waypointOrder[i];
      const stop = route.stops[originalIndex];
      const leg = result.legs[i]; // leg i = origin/prev stop → this waypoint
      if (stop && leg) {
        await this.prisma.routeStop.update({
          where: { id: stop.id },
          data: {
            optimizedOrder: i + 1,
            estimatedDistanceKm: leg.distanceKm,
            estimatedDurationMins: leg.durationMins,
          },
        });
      }
    }

    this.logger.log(
      `Route ${id} optimized: ${result.totalDistanceKm} km, ${result.totalDurationMins} mins`,
    );

    return { ...updated, directions: result };
  }
}
