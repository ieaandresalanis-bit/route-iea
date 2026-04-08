import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

/** Closed/terminal statuses excluded from active pipeline */
const CLOSED_STATUSES = ['CERRADO_GANADO', 'CERRADO_PERDIDO', 'LEAD_BASURA', 'CONTACTAR_FUTURO'];

/** Pipeline stages that count toward active pipeline value */
const PIPELINE_STATUSES = [
  'AGENDAR_CITA',
  'ESPERANDO_COTIZACION',
  'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO',
  'PENDIENTE_PAGO',
];

@Injectable()
export class SalesDashboardService {
  private readonly logger = new Logger(SalesDashboardService.name);

  constructor(private prisma: PrismaService) {}

  /** Main KPI panel */
  async getKpis() {
    const [total, won, pipeline, visits30d, avgDeal] = await Promise.all([
      this.prisma.lead.count({ where: { deletedAt: null, isHistorical: false } }),
      this.prisma.lead.count({ where: { deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO' } }),
      this.prisma.lead.aggregate({
        where: { deletedAt: null, isHistorical: false, status: { in: PIPELINE_STATUSES as any } },
        _sum: { estimatedValue: true },
      }),
      this.prisma.visit.count({
        where: { visitDate: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      }),
      this.prisma.lead.aggregate({
        where: { deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO', estimatedValue: { not: null } },
        _avg: { estimatedValue: true },
      }),
    ]);

    // Conversion = Cerrado Ganado / (all leads except Lead Basura)
    const validLeads = await this.prisma.lead.count({
      where: { deletedAt: null, isHistorical: false, status: { notIn: ['LEAD_BASURA'] } },
    });

    return {
      totalLeads: total,
      totalClients: won,
      conversionRate: validLeads > 0 ? Math.round((won / validLeads) * 10000) / 100 : 0,
      pipelineValue: pipeline._sum.estimatedValue ?? 0,
      avgDealSize: Math.round(avgDeal._avg.estimatedValue ?? 0),
      visitsLast30Days: visits30d,
    };
  }

  /** Leads and pipeline grouped by zone */
  async getByZone() {
    const zones = await this.prisma.lead.groupBy({
      by: ['zone'],
      where: { deletedAt: null, isHistorical: false },
      _count: true,
      _sum: { estimatedValue: true },
    });

    const wonByZone = await this.prisma.lead.groupBy({
      by: ['zone'],
      where: { deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO' },
      _count: true,
    });

    const wonMap = new Map(wonByZone.map((c) => [c.zone, c._count]));

    return zones.map((z) => ({
      zone: z.zone,
      totalLeads: z._count,
      pipelineValue: z._sum.estimatedValue ?? 0,
      clients: wonMap.get(z.zone) ?? 0,
      conversionRate:
        z._count > 0
          ? Math.round(((wonMap.get(z.zone) ?? 0) / z._count) * 10000) / 100
          : 0,
    }));
  }

  /** Lead funnel: count by status stage */
  async getByStatus() {
    const stages = await this.prisma.lead.groupBy({
      by: ['status'],
      where: { deletedAt: null, isHistorical: false },
      _count: true,
      _sum: { estimatedValue: true },
    });

    return stages.map((s) => ({
      status: s.status,
      count: s._count,
      value: s._sum.estimatedValue ?? 0,
    }));
  }

  /** Advisor performance */
  async getAdvisors() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const advisors = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        assignedLeads: { some: {} },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        _count: {
          select: {
            assignedLeads: true,
            visits: true,
          },
        },
      },
    });

    const results = await Promise.all(
      advisors.map(async (advisor) => {
        const [won, pipeline, recentVisits] = await Promise.all([
          this.prisma.lead.count({
            where: { assignedToId: advisor.id, deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO' },
          }),
          this.prisma.lead.aggregate({
            where: {
              assignedToId: advisor.id,
              deletedAt: null,
              isHistorical: false,
              status: { in: PIPELINE_STATUSES as any },
            },
            _sum: { estimatedValue: true },
          }),
          this.prisma.visit.count({
            where: { visitedById: advisor.id, visitDate: { gte: thirtyDaysAgo } },
          }),
        ]);

        const totalLeads = advisor._count.assignedLeads;
        return {
          id: advisor.id,
          name: `${advisor.firstName} ${advisor.lastName}`,
          totalLeads,
          clients: won,
          conversionRate: totalLeads > 0 ? Math.round((won / totalLeads) * 10000) / 100 : 0,
          pipelineValue: pipeline._sum.estimatedValue ?? 0,
          visitsLast30Days: recentVisits,
        };
      }),
    );

    return results.sort((a, b) => b.pipelineValue - a.pipelineValue);
  }

  /** Pipeline view: unified funnel stages with counts and values */
  async getPipelineView() {
    const stageOrder = [
      'PENDIENTE_CONTACTAR',
      'INTENTANDO_CONTACTAR',
      'EN_PROSPECCION',
      'AGENDAR_CITA',
      'ESPERANDO_COTIZACION',
      'COTIZACION_ENTREGADA',
      'ESPERANDO_CONTRATO',
      'PENDIENTE_PAGO',
      'CERRADO_GANADO',
    ];
    const stageLabels: Record<string, string> = {
      PENDIENTE_CONTACTAR: 'Pendiente de Contactar',
      INTENTANDO_CONTACTAR: 'Intentando Contactar',
      EN_PROSPECCION: 'En Prospeccion',
      AGENDAR_CITA: 'Agendar Cita',
      ESPERANDO_COTIZACION: 'Esperando Cotizacion',
      COTIZACION_ENTREGADA: 'Cotizacion Entregada',
      ESPERANDO_CONTRATO: 'Esperando Contrato',
      PENDIENTE_PAGO: 'Pendiente de Pago',
      CERRADO_GANADO: 'Cerrado Ganado',
    };

    const stages = await Promise.all(
      stageOrder.map(async (status) => {
        const [count, sum] = await Promise.all([
          this.prisma.lead.count({ where: { deletedAt: null, isHistorical: false, status: status as any } }),
          this.prisma.lead.aggregate({
            where: { deletedAt: null, isHistorical: false, status: status as any },
            _sum: { estimatedValue: true },
          }),
        ]);
        return {
          status,
          label: stageLabels[status] ?? status,
          count,
          value: sum._sum.estimatedValue ?? 0,
        };
      }),
    );

    return stages;
  }

  /** Trends: leads created per week for last 12 weeks */
  async getTrends() {
    const twelveWeeksAgo = new Date(Date.now() - 12 * 7 * 24 * 60 * 60 * 1000);

    const leads = await this.prisma.lead.findMany({
      where: { deletedAt: null, createdAt: { gte: twelveWeeksAgo } },
      select: { createdAt: true, status: true },
    });

    const weeks: Record<string, { created: number; converted: number }> = {};
    leads.forEach((lead) => {
      const d = new Date(lead.createdAt);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = weekStart.toISOString().slice(0, 10);
      if (!weeks[key]) weeks[key] = { created: 0, converted: 0 };
      weeks[key].created++;
      if (lead.status === 'CERRADO_GANADO') weeks[key].converted++;
    });

    return Object.entries(weeks)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, data]) => ({ week, ...data }));
  }
}
