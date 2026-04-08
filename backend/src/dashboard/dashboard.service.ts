import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

/**
 * Aggregates data from multiple modules for the dashboard overview.
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private prisma: PrismaService) {}

  /** Main dashboard overview with fleet KPIs */
  async getOverview() {
    const [
      totalVehicles,
      activeVehicles,
      maintenanceVehicles,
      totalDrivers,
      activeTrips,
      completedTripsToday,
      incidentsThisMonth,
      fuelThisMonth,
    ] = await Promise.all([
      this.prisma.vehicle.count({ where: { deletedAt: null } }),
      this.prisma.vehicle.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      this.prisma.vehicle.count({ where: { status: 'MAINTENANCE', deletedAt: null } }),
      this.prisma.user.count({ where: { role: 'OPERATOR' as any, isActive: true, deletedAt: null } }),
      this.prisma.trip.count({ where: { status: 'IN_PROGRESS' } }),
      this.prisma.trip.count({
        where: {
          status: 'COMPLETED',
          actualEndTime: { gte: startOfDay() },
        },
      }),
      this.prisma.incident.count({
        where: { createdAt: { gte: startOfMonth() } },
      }),
      this.prisma.fuelLog.aggregate({
        where: { filledAt: { gte: startOfMonth() } },
        _sum: { totalCost: true, liters: true },
        _count: { id: true },
      }),
    ]);

    return {
      fleet: {
        total: totalVehicles,
        active: activeVehicles,
        maintenance: maintenanceVehicles,
        inactive: totalVehicles - activeVehicles - maintenanceVehicles,
      },
      drivers: { total: totalDrivers },
      trips: {
        active: activeTrips,
        completedToday: completedTripsToday,
      },
      incidents: { thisMonth: incidentsThisMonth },
      fuel: {
        costThisMonth: Math.round((fuelThisMonth._sum.totalCost ?? 0) * 100) / 100,
        litersThisMonth: Math.round((fuelThisMonth._sum.liters ?? 0) * 100) / 100,
        fillUpsThisMonth: fuelThisMonth._count.id,
      },
    };
  }

  /** Recent activity feed */
  async getRecentActivity(limit = 20) {
    const [recentTrips, recentIncidents] = await Promise.all([
      this.prisma.trip.findMany({
        take: limit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true, title: true, status: true, updatedAt: true,
          vehicle: { select: { plateNumber: true } },
          driver: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.incident.findMany({
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, title: true, severity: true, createdAt: true,
          vehicle: { select: { plateNumber: true } },
        },
      }),
    ]);

    return { recentTrips, recentIncidents };
  }
}

// Helper functions
function startOfDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}
