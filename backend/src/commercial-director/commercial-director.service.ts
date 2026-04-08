import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PriorityEngineService } from '../priority-engine/priority-engine.service';

const TERMINAL_STATUSES: any[] = ['CERRADO_GANADO', 'CERRADO_PERDIDO', 'LEAD_BASURA', 'CONTACTAR_FUTURO'];
const PIPELINE_STATUSES: any[] = [
  'PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR', 'EN_PROSPECCION', 'AGENDAR_CITA',
  'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO',
];
const LATE_STAGES = ['COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO'];
const EARLY_STAGES = ['PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR'];
const MID_STAGES = ['EN_PROSPECCION', 'AGENDAR_CITA', 'ESPERANDO_COTIZACION'];

const STATUS_LABELS: Record<string, string> = {
  PENDIENTE_CONTACTAR: 'Pendiente de Contactar',
  INTENTANDO_CONTACTAR: 'Intentando Contactar',
  EN_PROSPECCION: 'En Prospeccion',
  AGENDAR_CITA: 'Agendar Cita',
  ESPERANDO_COTIZACION: 'Esperando Cotizacion',
  COTIZACION_ENTREGADA: 'Cotizacion Entregada',
  ESPERANDO_CONTRATO: 'Esperando Contrato',
  PENDIENTE_PAGO: 'Pendiente de Pago',
  CERRADO_GANADO: 'Cerrado Ganado',
  CERRADO_PERDIDO: 'Cerrado Perdido',
  CONTACTAR_FUTURO: 'Contactar Futuro',
  LEAD_BASURA: 'Lead Basura',
};

const ZONE_LABELS: Record<string, string> = {
  BAJIO: 'Bajio',
  OCCIDENTE: 'Occidente',
  CENTRO: 'Centro',
  NORTE: 'Norte',
  OTROS: 'Otros',
};

const STAGE_ORDER: Record<string, number> = {
  PENDIENTE_CONTACTAR: 0,
  INTENTANDO_CONTACTAR: 1,
  EN_PROSPECCION: 2,
  AGENDAR_CITA: 3,
  ESPERANDO_COTIZACION: 4,
  COTIZACION_ENTREGADA: 5,
  ESPERANDO_CONTRATO: 6,
  PENDIENTE_PAGO: 7,
  CERRADO_GANADO: 8,
  CERRADO_PERDIDO: 9,
};

// ─── Types ─────────────────────────────────────────────

export interface AdvisorAnalysis {
  id: string;
  name: string;
  totalLeads: number;
  activeLeads: number;
  wonDeals: number;
  lostDeals: number;
  conversionRate: number;
  pipelineValue: number;
  weightedPipeline: number;
  visitsLast7d: number;
  visitsLast30d: number;
  avgDaysBetweenContacts: number | null;
  leadsWithoutContact7d: number;
  dealsPushing: number;
  performance: 'excellent' | 'good' | 'average' | 'low' | 'critical';
  issues: string[];
}

export interface ZoneAnalysis {
  zone: string;
  label: string;
  totalLeads: number;
  activeLeads: number;
  pipelineValue: number;
  weightedPipeline: number;
  wonDeals: number;
  lostDeals: number;
  conversionRate: number;
  avgDealSize: number | null;
  visitsLast30d: number;
  potential: 'high' | 'medium' | 'low';
  insights: string[];
}

export interface StageConversion {
  from: string;
  fromLabel: string;
  to: string;
  toLabel: string;
  count: number;
  dropoff: number;
  dropoffRate: number;
  avgDaysInStage: number | null;
  bottleneck: boolean;
  value: number;
}

export interface Bottleneck {
  type: 'stage' | 'advisor' | 'zone' | 'process';
  severity: 'critical' | 'high' | 'medium';
  title: string;
  description: string;
  impact: string;
  recommendation: string;
}

export interface RiskAlert {
  severity: 'critical' | 'high' | 'medium';
  category: string;
  title: string;
  description: string;
  metric: string;
  recommendation: string;
}

export interface StrategicRecommendation {
  priority: number;
  category: string;
  title: string;
  rationale: string;
  expectedImpact: string;
  actions: string[];
}

@Injectable()
export class CommercialDirectorService {
  private readonly logger = new Logger(CommercialDirectorService.name);

  constructor(
    private prisma: PrismaService,
    private priorityEngine: PriorityEngineService,
  ) {}

  // ═══════════════════════════════════════════════════════
  // EXECUTIVE DAILY SUMMARY
  // ═══════════════════════════════════════════════════════

  async getDailySummary() {
    const now = new Date();
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      allLeads,
      pipelineAgg,
      wonThisWeek,
      lostThisWeek,
      newThisWeek,
      visitsToday,
      visitsYesterday,
      visitsThisWeek,
      followUpsDueToday,
      overdueFollowUps,
      alertStats,
    ] = await Promise.all([
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false },
        select: {
          id: true, companyName: true, contactName: true, contactPhone: true,
          zone: true, status: true, source: true, estimatedValue: true,
          lastContactedAt: true, createdAt: true, convertedAt: true,
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.lead.aggregate({
        where: { deletedAt: null, isHistorical: false, status: { in: PIPELINE_STATUSES } },
        _sum: { estimatedValue: true },
        _count: true,
      }),
      this.prisma.lead.count({
        where: { deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO', convertedAt: { gte: weekAgo } },
      }),
      this.prisma.lead.count({
        where: { deletedAt: null, isHistorical: false, status: 'CERRADO_PERDIDO', updatedAt: { gte: weekAgo } },
      }),
      this.prisma.lead.count({
        where: { deletedAt: null, isHistorical: false, createdAt: { gte: weekAgo } },
      }),
      this.prisma.visit.count({ where: { visitDate: { gte: today } } }),
      this.prisma.visit.count({ where: { visitDate: { gte: yesterday, lt: today } } }),
      this.prisma.visit.count({ where: { visitDate: { gte: weekAgo } } }),
      this.prisma.visit.count({
        where: {
          followUpDate: { gte: today, lt: new Date(today.getTime() + 24 * 60 * 60 * 1000) },
          lead: { deletedAt: null, isHistorical: false, status: { notIn: TERMINAL_STATUSES } },
        },
      }),
      this.prisma.visit.count({
        where: {
          followUpDate: { lt: today },
          lead: { deletedAt: null, isHistorical: false, status: { notIn: TERMINAL_STATUSES } },
        },
      }),
      this.prisma.salesAlert.count({ where: { status: 'open' } }),
    ]);

    // Score all leads
    const scored = this.priorityEngine.scoreLeads(allLeads);
    const activeLeads = scored.filter((l: any) => !TERMINAL_STATUSES.includes(l.status));
    const criticalLeads = activeLeads.filter((l: any) => l.urgency === 'critical');
    const highValueAtRisk = activeLeads.filter(
      (l) => (l.estimatedValue || 0) >= 200000 && (l.daysSinceContact === null || l.daysSinceContact >= 7),
    );

    // Pipeline by stage
    const pipelineByStage = PIPELINE_STATUSES.map((status: any) => {
      const leads = activeLeads.filter((l: any) => l.status === status);
      const value = leads.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0);
      const weighted = leads.reduce((s: any, l: any) => s + (l.estimatedValue || 0) * l.probability, 0);
      return { status, label: STATUS_LABELS[status], count: leads.length, value, weighted };
    });

    // Top 5 deals by weighted value
    const topDeals = [...activeLeads]
      .sort((a: any, b: any) => (b.estimatedValue || 0) * b.probability - (a.estimatedValue || 0) * a.probability)
      .slice(0, 5)
      .map((l: any) => ({
        id: l.id,
        companyName: l.companyName,
        status: l.status,
        statusLabel: STATUS_LABELS[l.status] || l.status,
        estimatedValue: l.estimatedValue,
        probability: l.probability,
        weightedValue: (l.estimatedValue || 0) * l.probability,
        urgency: l.urgency,
        daysSinceContact: l.daysSinceContact,
        advisor: l.assignedTo ? `${l.assignedTo.firstName} ${l.assignedTo.lastName}` : null,
      }));

    // Executive narrative
    const totalPipeline = pipelineAgg._sum?.estimatedValue || 0;
    const weightedPipeline = pipelineByStage.reduce((s: any, p: any) => s + p.weighted, 0);

    const narrative = this.buildDailyNarrative({
      activeLeads: activeLeads.length,
      totalPipeline,
      weightedPipeline,
      wonThisWeek,
      lostThisWeek,
      newThisWeek,
      criticalCount: criticalLeads.length,
      highValueAtRisk: highValueAtRisk.length,
      visitsToday,
      visitsYesterday,
      overdueFollowUps,
      alertStats,
    });

    return {
      date: now.toISOString(),
      narrative,
      kpis: {
        activeLeads: activeLeads.length,
        totalPipeline,
        weightedPipeline,
        wonThisWeek,
        lostThisWeek,
        newThisWeek,
        visitsToday,
        visitsThisWeek,
        followUpsDueToday,
        overdueFollowUps,
        criticalLeads: criticalLeads.length,
        highValueAtRisk: highValueAtRisk.length,
        openAlerts: alertStats,
      },
      pipelineByStage,
      topDeals,
      criticalLeads: criticalLeads.slice(0, 5).map((l: any) => ({
        id: l.id,
        companyName: l.companyName,
        status: STATUS_LABELS[l.status] || l.status,
        estimatedValue: l.estimatedValue,
        daysSinceContact: l.daysSinceContact,
        urgency: l.urgency,
        advisor: l.assignedTo ? `${l.assignedTo.firstName} ${l.assignedTo.lastName}` : null,
      })),
      highValueAtRisk: highValueAtRisk.slice(0, 5).map((l: any) => ({
        id: l.id,
        companyName: l.companyName,
        estimatedValue: l.estimatedValue,
        daysSinceContact: l.daysSinceContact,
        status: STATUS_LABELS[l.status] || l.status,
        advisor: l.assignedTo ? `${l.assignedTo.firstName} ${l.assignedTo.lastName}` : null,
      })),
    };
  }

  // ═══════════════════════════════════════════════════════
  // WEEKLY PERFORMANCE SUMMARY
  // ═══════════════════════════════════════════════════════

  async getWeeklySummary() {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      allLeads,
      wonThisWeek,
      wonLastWeek,
      lostThisWeek,
      lostLastWeek,
      newThisWeek,
      newLastWeek,
      visitsThisWeek,
      visitsLastWeek,
      wonDeals,
    ] = await Promise.all([
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false },
        select: {
          id: true, companyName: true, contactName: true, contactPhone: true,
          zone: true, status: true, source: true, estimatedValue: true,
          lastContactedAt: true, createdAt: true, convertedAt: true,
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.lead.count({ where: { deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO', convertedAt: { gte: weekAgo } } }),
      this.prisma.lead.count({ where: { deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO', convertedAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
      this.prisma.lead.count({ where: { deletedAt: null, isHistorical: false, status: 'CERRADO_PERDIDO', updatedAt: { gte: weekAgo } } }),
      this.prisma.lead.count({ where: { deletedAt: null, isHistorical: false, status: 'CERRADO_PERDIDO', updatedAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
      this.prisma.lead.count({ where: { deletedAt: null, isHistorical: false, createdAt: { gte: weekAgo } } }),
      this.prisma.lead.count({ where: { deletedAt: null, isHistorical: false, createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
      this.prisma.visit.count({ where: { visitDate: { gte: weekAgo } } }),
      this.prisma.visit.count({ where: { visitDate: { gte: twoWeeksAgo, lt: weekAgo } } }),
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO', convertedAt: { gte: weekAgo } },
        select: { id: true, companyName: true, estimatedValue: true, zone: true, convertedAt: true,
          assignedTo: { select: { firstName: true, lastName: true } } },
      }),
    ]);

    const scored = this.priorityEngine.scoreLeads(allLeads);
    const active = scored.filter((l: any) => !TERMINAL_STATUSES.includes(l.status));

    // Revenue this week
    const revenueThisWeek = wonDeals.reduce((s: any, d: any) => s + (d.estimatedValue || 0), 0);

    // Deltas
    const delta = (curr: number, prev: number) => prev === 0 ? null : Math.round(((curr - prev) / prev) * 100);

    const weekOverWeek = {
      won: { current: wonThisWeek, previous: wonLastWeek, delta: delta(wonThisWeek, wonLastWeek) },
      lost: { current: lostThisWeek, previous: lostLastWeek, delta: delta(lostThisWeek, lostLastWeek) },
      newLeads: { current: newThisWeek, previous: newLastWeek, delta: delta(newThisWeek, newLastWeek) },
      visits: { current: visitsThisWeek, previous: visitsLastWeek, delta: delta(visitsThisWeek, visitsLastWeek) },
    };

    // Pipeline health indicators
    const inactiveCount = active.filter((l: any) => l.daysSinceContact !== null && l.daysSinceContact >= 7).length;
    const staleDeals = active.filter(
      (l) => LATE_STAGES.includes(l.status) && (l.daysSinceContact === null || l.daysSinceContact >= 5),
    );

    const narrative = this.buildWeeklyNarrative({
      wonThisWeek, lostThisWeek, newThisWeek, visitsThisWeek, revenueThisWeek,
      weekOverWeek, inactiveCount, staleDeals: staleDeals.length, totalActive: active.length,
    });

    return {
      weekOf: weekAgo.toISOString().split('T')[0],
      narrative,
      weekOverWeek,
      revenue: {
        thisWeek: revenueThisWeek,
        deals: wonDeals.map((d: any) => ({
          companyName: d.companyName,
          value: d.estimatedValue,
          zone: d.zone,
          advisor: d.assignedTo ? `${d.assignedTo.firstName} ${d.assignedTo.lastName}` : null,
        })),
      },
      pipelineHealth: {
        totalActive: active.length,
        totalValue: active.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0),
        weightedValue: active.reduce((s: any, l: any) => s + (l.estimatedValue || 0) * l.probability, 0),
        inactiveLeads: inactiveCount,
        inactiveRate: active.length > 0 ? Math.round((inactiveCount / active.length) * 100) : 0,
        staleDeals: staleDeals.length,
        criticalLeads: active.filter((l: any) => l.urgency === 'critical').length,
      },
      staleDeals: staleDeals.slice(0, 5).map((l: any) => ({
        id: l.id,
        companyName: l.companyName,
        status: STATUS_LABELS[l.status] || l.status,
        estimatedValue: l.estimatedValue,
        daysSinceContact: l.daysSinceContact,
        advisor: l.assignedTo ? `${l.assignedTo.firstName} ${l.assignedTo.lastName}` : null,
      })),
    };
  }

  // ═══════════════════════════════════════════════════════
  // BOTTLENECK DETECTION
  // ═══════════════════════════════════════════════════════

  async detectBottlenecks(): Promise<Bottleneck[]> {
    const bottlenecks: Bottleneck[] = [];

    const allLeads = await this.prisma.lead.findMany({
      where: { deletedAt: null, isHistorical: false },
      select: {
        id: true, companyName: true, contactName: true, contactPhone: true,
        zone: true, status: true, source: true, estimatedValue: true,
        lastContactedAt: true, createdAt: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const scored = this.priorityEngine.scoreLeads(allLeads);
    const active = scored.filter((l: any) => !TERMINAL_STATUSES.includes(l.status));

    // 1. Stage bottlenecks — where leads pile up
    const byStage: Record<string, typeof active> = {};
    for (const l of active) {
      if (!byStage[l.status]) byStage[l.status] = [];
      byStage[l.status].push(l);
    }

    for (const status of PIPELINE_STATUSES) {
      const leads = byStage[status] || [];
      if (leads.length === 0) continue;

      const avgDays = leads.reduce((s: any, l: any) => {
        const days = this.priorityEngine.daysSince(l.createdAt);
        return s + (days || 0);
      }, 0) / leads.length;

      const stageValue = leads.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0);

      // Bottleneck: too many leads stuck in early/mid stages
      if (EARLY_STAGES.includes(status) && leads.length >= 5) {
        bottlenecks.push({
          type: 'stage',
          severity: leads.length >= 10 ? 'critical' : 'high',
          title: `Acumulacion en ${STATUS_LABELS[status]}`,
          description: `${leads.length} leads acumulados en "${STATUS_LABELS[status]}" con valor total de $${stageValue.toLocaleString('es-MX')}. Promedio ${Math.round(avgDays)} dias en esta etapa.`,
          impact: `Pipeline estancado — $${stageValue.toLocaleString('es-MX')} sin avanzar`,
          recommendation: `Asignar y contactar los ${leads.length} leads pendientes. Priorizar los de mayor valor.`,
        });
      }

      // Bottleneck: leads stuck too long in late stages
      if (LATE_STAGES.includes(status)) {
        const stuckLeads = leads.filter((l: any) => l.daysSinceContact === null || l.daysSinceContact >= 5);
        if (stuckLeads.length > 0) {
          const stuckValue = stuckLeads.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0);
          bottlenecks.push({
            type: 'stage',
            severity: 'critical',
            title: `Deals estancados en ${STATUS_LABELS[status]}`,
            description: `${stuckLeads.length} deals en "${STATUS_LABELS[status]}" sin contacto reciente. Valor: $${stuckValue.toLocaleString('es-MX')}.`,
            impact: `Riesgo de perder $${stuckValue.toLocaleString('es-MX')} en deals casi cerrados`,
            recommendation: `Contactar inmediatamente: ${stuckLeads.slice(0, 3).map((l: any) => l.companyName).join(', ')}.`,
          });
        }
      }
    }

    // 2. Conversion bottleneck — mid-stage stagnation
    const midStageLeads = active.filter((l: any) => MID_STAGES.includes(l.status));
    const midStageInactive = midStageLeads.filter(
      (l) => l.daysSinceContact !== null && l.daysSinceContact >= 10,
    );
    if (midStageInactive.length >= 3) {
      const value = midStageInactive.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0);
      bottlenecks.push({
        type: 'process',
        severity: 'high',
        title: 'Prospeccion estancada',
        description: `${midStageInactive.length} leads en prospeccion/cita/cotizacion inactivos 10+ dias. Valor: $${value.toLocaleString('es-MX')}.`,
        impact: `El mid-pipeline no avanza — futuros deals no se estan generando`,
        recommendation: `Reactivar contacto con los ${midStageInactive.length} leads inactivos en etapas medias. Revisar proceso de seguimiento.`,
      });
    }

    // 3. Advisor bottlenecks
    const advisorAnalysis = await this.analyzeAdvisors();
    for (const advisor of advisorAnalysis) {
      if (advisor.performance === 'critical') {
        bottlenecks.push({
          type: 'advisor',
          severity: 'critical',
          title: `Asesor critico: ${advisor.name}`,
          description: `${advisor.name} tiene ${advisor.activeLeads} leads activos pero ${advisor.issues.join(', ')}.`,
          impact: `${advisor.activeLeads} leads en riesgo de perderse. Pipeline: $${advisor.pipelineValue.toLocaleString('es-MX')}.`,
          recommendation: `Reunion urgente con ${advisor.name}. Reasignar leads de alto valor si no mejora en 48h.`,
        });
      }
    }

    // 4. No-advisor bottleneck
    const unassigned = active.filter((l: any) => !l.assignedTo);
    if (unassigned.length > 0) {
      const value = unassigned.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0);
      bottlenecks.push({
        type: 'process',
        severity: unassigned.length >= 5 ? 'critical' : 'high',
        title: `${unassigned.length} leads sin asesor`,
        description: `Hay ${unassigned.length} leads activos sin asesor asignado. Valor total: $${value.toLocaleString('es-MX')}.`,
        impact: `Leads sin seguimiento = oportunidades perdidas`,
        recommendation: `Asignar inmediatamente. Los de mayor valor: ${unassigned.sort((a: any, b: any) => (b.estimatedValue || 0) - (a.estimatedValue || 0)).slice(0, 3).map((l: any) => l.companyName).join(', ')}.`,
      });
    }

    // Sort by severity
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2 };
    bottlenecks.sort((a: any, b: any) => severityOrder[a.severity] - severityOrder[b.severity]);

    return bottlenecks;
  }

  // ═══════════════════════════════════════════════════════
  // ADVISOR PERFORMANCE ANALYSIS
  // ═══════════════════════════════════════════════════════

  async analyzeAdvisors(): Promise<AdvisorAnalysis[]> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const advisors = await this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true, assignedLeads: { some: { deletedAt: null } } },
      select: {
        id: true, firstName: true, lastName: true,
        assignedLeads: {
          where: { deletedAt: null, isHistorical: false },
          select: {
            id: true, companyName: true, contactName: true, contactPhone: true,
            zone: true, status: true, source: true, estimatedValue: true,
            lastContactedAt: true, createdAt: true,
          },
        },
      },
    });

    const results: AdvisorAnalysis[] = [];

    for (const advisor of advisors) {
      const [visits7d, visits30d] = await Promise.all([
        this.prisma.visit.count({ where: { visitedById: advisor.id, visitDate: { gte: weekAgo } } }),
        this.prisma.visit.count({ where: { visitedById: advisor.id, visitDate: { gte: thirtyDaysAgo } } }),
      ]);

      const leads = advisor.assignedLeads;
      const active = leads.filter((l: any) => !TERMINAL_STATUSES.includes(l.status));
      const won = leads.filter((l: any) => l.status === 'CERRADO_GANADO');
      const lost = leads.filter((l: any) => l.status === 'CERRADO_PERDIDO');
      const totalDecided = won.length + lost.length;
      const conversionRate = totalDecided > 0 ? Math.round((won.length / totalDecided) * 100) : 0;

      const pipelineValue = active.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0);

      // Score active leads for weighted pipeline
      const scoredActive = active.map((l: any) => ({
        ...l, contactPhone: l.contactPhone || undefined,
        assignedTo: { id: advisor.id, firstName: advisor.firstName, lastName: advisor.lastName },
      }));
      const scoredLeads = this.priorityEngine.scoreLeads(scoredActive);
      const weightedPipeline = scoredLeads.reduce((s: any, l: any) => s + (l.estimatedValue || 0) * l.probability, 0);

      // Leads without contact in 7d
      const noContact7d = active.filter((l: any) => {
        const days = this.priorityEngine.daysSince(l.lastContactedAt);
        return days === null || days >= 7;
      });

      // Avg days between contacts
      const contactDays = active
        .map((l: any) => this.priorityEngine.daysSince(l.lastContactedAt))
        .filter((d): d is number => d !== null);
      const avgDays = contactDays.length > 0 ? contactDays.reduce((s: any, d: any) => s + d, 0) / contactDays.length : null;

      const dealsPushing = active.filter((l: any) => LATE_STAGES.includes(l.status)).length;

      // Performance rating
      const issues: string[] = [];
      let performance: AdvisorAnalysis['performance'] = 'good';

      if (visits7d === 0 && active.length > 0) {
        issues.push('0 visitas en 7 dias');
        performance = 'critical';
      } else if (visits7d < 2 && active.length >= 5) {
        issues.push(`solo ${visits7d} visita(s) en 7 dias con ${active.length} leads`);
        performance = 'low';
      }

      if (noContact7d.length > active.length * 0.5 && active.length >= 3) {
        issues.push(`${noContact7d.length}/${active.length} leads sin contacto en 7d`);
        if (performance === 'good') performance = 'average';
      }

      if (conversionRate < 15 && totalDecided >= 3) {
        issues.push(`tasa de conversion baja (${conversionRate}%)`);
        if (performance === 'good') performance = 'average';
      }

      if (issues.length === 0 && conversionRate >= 30 && visits7d >= 3) {
        performance = 'excellent';
      }

      results.push({
        id: advisor.id,
        name: `${advisor.firstName} ${advisor.lastName}`,
        totalLeads: leads.length,
        activeLeads: active.length,
        wonDeals: won.length,
        lostDeals: lost.length,
        conversionRate,
        pipelineValue,
        weightedPipeline,
        visitsLast7d: visits7d,
        visitsLast30d: visits30d,
        avgDaysBetweenContacts: avgDays !== null ? Math.round(avgDays) : null,
        leadsWithoutContact7d: noContact7d.length,
        dealsPushing,
        performance,
        issues,
      });
    }

    // Sort: critical first, then by weighted pipeline desc
    const perfOrder: Record<string, number> = { critical: 0, low: 1, average: 2, good: 3, excellent: 4 };
    results.sort((a: any, b: any) => perfOrder[a.performance] - perfOrder[b.performance] || b.weightedPipeline - a.weightedPipeline);

    return results;
  }

  // ═══════════════════════════════════════════════════════
  // ZONE ANALYSIS — HIGH POTENTIAL IDENTIFICATION
  // ═══════════════════════════════════════════════════════

  async analyzeZones(): Promise<ZoneAnalysis[]> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const allLeads = await this.prisma.lead.findMany({
      where: { deletedAt: null },
      select: {
        id: true, companyName: true, contactName: true, contactPhone: true,
        zone: true, status: true, source: true, estimatedValue: true,
        lastContactedAt: true, createdAt: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const scored = this.priorityEngine.scoreLeads(allLeads);
    const zones = ['BAJIO', 'OCCIDENTE', 'CENTRO', 'NORTE', 'OTROS'];
    const results: ZoneAnalysis[] = [];

    for (const zone of zones) {
      const zoneLeads = scored.filter((l: any) => l.zone === zone);
      const active = zoneLeads.filter((l: any) => !TERMINAL_STATUSES.includes(l.status));
      const won = zoneLeads.filter((l: any) => l.status === 'CERRADO_GANADO');
      const lost = zoneLeads.filter((l: any) => l.status === 'CERRADO_PERDIDO');
      const totalDecided = won.length + lost.length;

      const pipelineValue = active.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0);
      const weightedPipeline = active.reduce((s: any, l: any) => s + (l.estimatedValue || 0) * l.probability, 0);
      const conversionRate = totalDecided > 0 ? Math.round((won.length / totalDecided) * 100) : 0;

      const wonValues = won.map((l: any) => l.estimatedValue || 0).filter((v: any) => v > 0);
      const avgDealSize = wonValues.length > 0 ? wonValues.reduce((s: any, v: any) => s + v, 0) / wonValues.length : null;

      // Visits in this zone (via leads)
      const zoneLeadIds = zoneLeads.map((l: any) => l.id);
      const visitsLast30d = await this.prisma.visit.count({
        where: { leadId: { in: zoneLeadIds }, visitDate: { gte: thirtyDaysAgo } },
      });

      // Determine potential
      const insights: string[] = [];
      let potential: ZoneAnalysis['potential'] = 'medium';

      if (pipelineValue >= 500000 && active.length >= 3) {
        potential = 'high';
        insights.push(`Pipeline alto: $${pipelineValue.toLocaleString('es-MX')}`);
      }

      if (conversionRate >= 40 && totalDecided >= 2) {
        potential = 'high';
        insights.push(`Conversion excelente: ${conversionRate}%`);
      }

      if (active.length >= 5 && visitsLast30d < 3) {
        insights.push(`Subatendida: ${active.length} leads activos pero solo ${visitsLast30d} visitas en 30d`);
      }

      if (avgDealSize && avgDealSize >= 300000) {
        insights.push(`Ticket promedio alto: $${Math.round(avgDealSize).toLocaleString('es-MX')}`);
      }

      if (active.length <= 1 && pipelineValue < 100000) {
        potential = 'low';
        insights.push('Poca actividad y bajo pipeline');
      }

      results.push({
        zone,
        label: ZONE_LABELS[zone] || zone,
        totalLeads: zoneLeads.length,
        activeLeads: active.length,
        pipelineValue,
        weightedPipeline,
        wonDeals: won.length,
        lostDeals: lost.length,
        conversionRate,
        avgDealSize: avgDealSize ? Math.round(avgDealSize) : null,
        visitsLast30d,
        potential,
        insights,
      });
    }

    results.sort((a: any, b: any) => b.weightedPipeline - a.weightedPipeline);
    return results;
  }

  // ═══════════════════════════════════════════════════════
  // CONVERSION ANALYSIS BY STAGE
  // ═══════════════════════════════════════════════════════

  async analyzeConversions(): Promise<StageConversion[]> {
    const allLeads = await this.prisma.lead.findMany({
      where: { deletedAt: null },
      select: { id: true, status: true, estimatedValue: true, createdAt: true },
    });

    const conversions: StageConversion[] = [];

    for (let i = 0; i < PIPELINE_STATUSES.length - 1; i++) {
      const from = PIPELINE_STATUSES[i];
      const to = PIPELINE_STATUSES[i + 1];

      // Count leads at or past this stage
      const atOrPast = allLeads.filter((l: any) => {
        const order = STAGE_ORDER[l.status];
        return order !== undefined && order >= STAGE_ORDER[from];
      });

      // Count leads at or past next stage
      const atOrPastNext = allLeads.filter((l: any) => {
        const order = STAGE_ORDER[l.status];
        return order !== undefined && order >= STAGE_ORDER[to];
      });

      // Currently stuck at this stage
      const atThis = allLeads.filter((l: any) => l.status === from);
      const value = atThis.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0);

      const dropoff = atOrPast.length - atOrPastNext.length;
      const dropoffRate = atOrPast.length > 0 ? Math.round((dropoff / atOrPast.length) * 100) : 0;

      // Average days leads spend at this stage (approximation)
      const avgDays = atThis.length > 0
        ? Math.round(atThis.reduce((s: any, l: any) => s + (this.priorityEngine.daysSince(l.createdAt) || 0), 0) / atThis.length)
        : null;

      conversions.push({
        from,
        fromLabel: STATUS_LABELS[from],
        to,
        toLabel: STATUS_LABELS[to],
        count: atOrPast.length,
        dropoff,
        dropoffRate,
        avgDaysInStage: avgDays,
        bottleneck: dropoffRate >= 40 && atOrPast.length >= 3,
        value,
      });
    }

    // Final: to CERRADO_GANADO
    const lateStageLeads = allLeads.filter((l: any) => {
      const order = STAGE_ORDER[l.status];
      return order !== undefined && order >= STAGE_ORDER['COTIZACION_ENTREGADA'];
    });
    const won = allLeads.filter((l: any) => l.status === 'CERRADO_GANADO');
    const closingDropoff = lateStageLeads.length - won.length;

    conversions.push({
      from: 'COTIZACION_ENTREGADA',
      fromLabel: 'Pipeline Avanzado',
      to: 'CERRADO_GANADO',
      toLabel: 'Cerrado Ganado',
      count: lateStageLeads.length,
      dropoff: closingDropoff,
      dropoffRate: lateStageLeads.length > 0 ? Math.round((closingDropoff / lateStageLeads.length) * 100) : 0,
      avgDaysInStage: null,
      bottleneck: lateStageLeads.length > 0 && closingDropoff > lateStageLeads.length * 0.5,
      value: lateStageLeads.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0),
    });

    return conversions;
  }

  // ═══════════════════════════════════════════════════════
  // RISK ALERTS
  // ═══════════════════════════════════════════════════════

  async getRiskAlerts(): Promise<RiskAlert[]> {
    const alerts: RiskAlert[] = [];

    const [advisors, bottlenecks, zones, conversions, dailySummary] = await Promise.all([
      this.analyzeAdvisors(),
      this.detectBottlenecks(),
      this.analyzeZones(),
      this.analyzeConversions(),
      this.getDailySummary(),
    ]);

    // Critical advisor performance
    const criticalAdvisors = advisors.filter((a: any) => a.performance === 'critical');
    if (criticalAdvisors.length > 0) {
      alerts.push({
        severity: 'critical',
        category: 'Equipo',
        title: `${criticalAdvisors.length} asesor(es) con rendimiento critico`,
        description: criticalAdvisors.map((a: any) => `${a.name}: ${a.issues.join(', ')}`).join('. '),
        metric: `${criticalAdvisors.reduce((s: any, a: any) => s + a.activeLeads, 0)} leads en riesgo`,
        recommendation: 'Reunion urgente con asesores de bajo rendimiento. Considerar reasignacion de leads de alto valor.',
      });
    }

    // High value at risk
    if (dailySummary.kpis.highValueAtRisk > 0) {
      const totalValue = dailySummary.highValueAtRisk.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0);
      alerts.push({
        severity: 'critical',
        category: 'Pipeline',
        title: `${dailySummary.kpis.highValueAtRisk} leads de alto valor sin atencion`,
        description: `Leads con valor >$200K sin contacto en 7+ dias: ${dailySummary.highValueAtRisk.map((l: any) => l.companyName).join(', ')}.`,
        metric: `$${totalValue.toLocaleString('es-MX')} en riesgo`,
        recommendation: 'Contactar hoy mismo. Priorizar por valor y etapa.',
      });
    }

    // Overdue follow-ups
    if (dailySummary.kpis.overdueFollowUps >= 5) {
      alerts.push({
        severity: 'high',
        category: 'Proceso',
        title: `${dailySummary.kpis.overdueFollowUps} follow-ups vencidos`,
        description: `Hay ${dailySummary.kpis.overdueFollowUps} seguimientos pendientes vencidos. Esto indica falta de disciplina en el proceso de venta.`,
        metric: `${dailySummary.kpis.overdueFollowUps} vencidos`,
        recommendation: 'Revisar seguimientos con cada asesor. Establecer politica de follow-up maximo 48h.',
      });
    }

    // Conversion bottlenecks
    const convBottlenecks = conversions.filter((c: any) => c.bottleneck);
    for (const cb of convBottlenecks) {
      alerts.push({
        severity: 'high',
        category: 'Conversion',
        title: `Cuello de botella: ${cb.fromLabel} → ${cb.toLabel}`,
        description: `${cb.dropoffRate}% de abandono entre ${cb.fromLabel} y ${cb.toLabel}. ${cb.dropoff} leads se quedan en esta etapa.`,
        metric: `$${cb.value.toLocaleString('es-MX')} estancados`,
        recommendation: `Revisar el proceso de ${cb.fromLabel}. Posible necesidad de ajustar estrategia o capacitar equipo.`,
      });
    }

    // Underserved high-potential zones
    for (const zone of zones) {
      if (zone.potential === 'high' && zone.visitsLast30d < zone.activeLeads) {
        alerts.push({
          severity: 'medium',
          category: 'Zona',
          title: `Zona ${zone.label} subatendida`,
          description: `${zone.activeLeads} leads activos con solo ${zone.visitsLast30d} visitas en 30 dias. Pipeline: $${zone.pipelineValue.toLocaleString('es-MX')}.`,
          metric: `$${zone.weightedPipeline.toLocaleString('es-MX')} pipeline ponderado`,
          recommendation: `Aumentar presencia en ${zone.label}. Planificar ruta de visitas esta semana.`,
        });
      }
    }

    // Sort by severity
    const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2 };
    alerts.sort((a: any, b: any) => sevOrder[a.severity] - sevOrder[b.severity]);

    return alerts;
  }

  // ═══════════════════════════════════════════════════════
  // STRATEGIC RECOMMENDATIONS
  // ═══════════════════════════════════════════════════════

  async getStrategicRecommendations(): Promise<StrategicRecommendation[]> {
    const [advisors, zones, conversions, bottlenecks, daily] = await Promise.all([
      this.analyzeAdvisors(),
      this.analyzeZones(),
      this.analyzeConversions(),
      this.detectBottlenecks(),
      this.getDailySummary(),
    ]);

    const recommendations: StrategicRecommendation[] = [];
    let priority = 1;

    // 1. Address critical bottlenecks first
    const criticalBottlenecks = bottlenecks.filter((b: any) => b.severity === 'critical');
    if (criticalBottlenecks.length > 0) {
      recommendations.push({
        priority: priority++,
        category: 'Urgente',
        title: 'Resolver cuellos de botella criticos',
        rationale: `Hay ${criticalBottlenecks.length} bloqueos criticos en el pipeline que estan frenando el cierre de deals.`,
        expectedImpact: 'Desbloquear pipeline y acelerar cierres en 1-2 semanas',
        actions: criticalBottlenecks.map((b) => b.recommendation),
      });
    }

    // 2. Team performance — address low performers
    const lowPerformers = advisors.filter((a: any) => a.performance === 'critical' || a.performance === 'low');
    if (lowPerformers.length > 0) {
      const totalAtRisk = lowPerformers.reduce((s: any, a: any) => s + a.pipelineValue, 0);
      recommendations.push({
        priority: priority++,
        category: 'Equipo',
        title: 'Intervenir con asesores de bajo rendimiento',
        rationale: `${lowPerformers.length} asesores con rendimiento bajo/critico. Pipeline en riesgo: $${totalAtRisk.toLocaleString('es-MX')}.`,
        expectedImpact: `Proteger $${totalAtRisk.toLocaleString('es-MX')} en pipeline y mejorar tasa de contacto`,
        actions: [
          ...lowPerformers.map((a: any) => `${a.name}: ${a.issues.join(', ')}. Requiere coaching inmediato.`),
          'Establecer KPIs minimos: 3 visitas/semana, contacto cada 5 dias por lead.',
          'Reasignar leads de alto valor si no mejoran en 1 semana.',
        ],
      });
    }

    // 3. Close deals in late stages
    const lateStageAdvisors = advisors.filter((a: any) => a.dealsPushing > 0);
    const totalDeals = lateStageAdvisors.reduce((s: any, a: any) => s + a.dealsPushing, 0);
    if (totalDeals > 0) {
      recommendations.push({
        priority: priority++,
        category: 'Cierre',
        title: `Empujar ${totalDeals} deals en etapa avanzada`,
        rationale: `Hay deals en cotizacion/contrato/pago que necesitan empujon final.`,
        expectedImpact: 'Cerrar deals pendientes y generar ingreso en 1-4 semanas',
        actions: [
          `Revisar los ${totalDeals} deals en etapa avanzada con cada asesor.`,
          'Preparar propuestas finales y condiciones especiales si es necesario.',
          'Agendar llamadas de cierre esta semana.',
          'Usar mensajes de urgencia para deals en Pendiente de Pago.',
        ],
      });
    }

    // 4. High-potential zones
    const highPotentialZones = zones.filter((z) => z.potential === 'high');
    if (highPotentialZones.length > 0) {
      recommendations.push({
        priority: priority++,
        category: 'Expansion',
        title: `Invertir en zonas de alto potencial: ${highPotentialZones.map((z) => z.label).join(', ')}`,
        rationale: highPotentialZones.map((z) => z.insights.join('. ')).join(' | '),
        expectedImpact: `Capitalizar $${highPotentialZones.reduce((s: any, z: any) => s + z.weightedPipeline, 0).toLocaleString('es-MX')} en pipeline ponderado`,
        actions: [
          ...highPotentialZones.map((z) => `${z.label}: ${z.activeLeads} leads activos, pipeline $${z.pipelineValue.toLocaleString('es-MX')}.`),
          'Planificar visitas semanales a zonas de alto potencial.',
          'Considerar asignar asesores dedicados a zonas con mayor pipeline.',
        ],
      });
    }

    // 5. Fix conversion issues
    const convIssues = conversions.filter((c: any) => c.bottleneck);
    if (convIssues.length > 0) {
      recommendations.push({
        priority: priority++,
        category: 'Proceso',
        title: 'Mejorar conversion en etapas problematicas',
        rationale: `Se detectaron ${convIssues.length} cuellos de botella en el funnel de ventas.`,
        expectedImpact: 'Mejorar la tasa de conversion global y reducir ciclo de venta',
        actions: convIssues.map((c) =>
          `${c.fromLabel} → ${c.toLabel}: ${c.dropoffRate}% abandonan. Valor estancado: $${c.value.toLocaleString('es-MX')}. Revisar proceso.`
        ),
      });
    }

    // 6. Reactivation opportunity
    const inactiveLeads = daily.kpis.activeLeads > 0
      ? Math.round((daily.kpis.highValueAtRisk / daily.kpis.activeLeads) * 100)
      : 0;
    if (daily.kpis.highValueAtRisk > 0) {
      recommendations.push({
        priority: priority++,
        category: 'Reactivacion',
        title: 'Reactivar leads de alto valor inactivos',
        rationale: `${daily.kpis.highValueAtRisk} leads de alto valor (>$200K) llevan 7+ dias sin contacto.`,
        expectedImpact: 'Recuperar oportunidades antes de que se enfrien definitivamente',
        actions: [
          ...daily.highValueAtRisk.map((l: any) => `${l.companyName}: $${(l.estimatedValue || 0).toLocaleString('es-MX')}, ${l.daysSinceContact ?? '?'}d sin contacto.`),
          'Ejecutar campaña de reactivacion personalizada.',
          'Asignar follow-up urgente a cada asesor responsable.',
        ],
      });
    }

    return recommendations;
  }

  // ═══════════════════════════════════════════════════════
  // FULL DIRECTOR REPORT
  // ═══════════════════════════════════════════════════════

  async getFullReport() {
    const [daily, weekly, bottlenecks, advisors, zones, conversions, risks, recommendations] =
      await Promise.all([
        this.getDailySummary(),
        this.getWeeklySummary(),
        this.detectBottlenecks(),
        this.analyzeAdvisors(),
        this.analyzeZones(),
        this.analyzeConversions(),
        this.getRiskAlerts(),
        this.getStrategicRecommendations(),
      ]);

    return {
      generatedAt: new Date().toISOString(),
      daily,
      weekly,
      bottlenecks,
      advisors,
      zones,
      conversions,
      risks,
      recommendations,
    };
  }

  // ═══════════════════════════════════════════════════════
  // NARRATIVE BUILDERS
  // ═══════════════════════════════════════════════════════

  private buildDailyNarrative(data: {
    activeLeads: number;
    totalPipeline: number;
    weightedPipeline: number;
    wonThisWeek: number;
    lostThisWeek: number;
    newThisWeek: number;
    criticalCount: number;
    highValueAtRisk: number;
    visitsToday: number;
    visitsYesterday: number;
    overdueFollowUps: number;
    alertStats: number;
  }): string {
    const parts: string[] = [];

    parts.push(
      `Hoy tenemos ${data.activeLeads} leads activos con un pipeline de $${data.totalPipeline.toLocaleString('es-MX')} ` +
      `(ponderado: $${Math.round(data.weightedPipeline).toLocaleString('es-MX')}).`
    );

    if (data.wonThisWeek > 0) {
      parts.push(`Esta semana se cerraron ${data.wonThisWeek} deal(s) ganado(s).`);
    }
    if (data.lostThisWeek > 0) {
      parts.push(`Se perdieron ${data.lostThisWeek} deal(s).`);
    }

    if (data.criticalCount > 0) {
      parts.push(`HAY ${data.criticalCount} LEADS EN ESTADO CRITICO que requieren atencion inmediata.`);
    }

    if (data.highValueAtRisk > 0) {
      parts.push(`${data.highValueAtRisk} leads de alto valor estan en riesgo por inactividad.`);
    }

    if (data.overdueFollowUps > 0) {
      parts.push(`Hay ${data.overdueFollowUps} seguimientos vencidos pendientes.`);
    }

    if (data.visitsToday === 0 && data.visitsYesterday === 0) {
      parts.push('ALERTA: No se han registrado visitas hoy ni ayer.');
    } else {
      parts.push(`Visitas hoy: ${data.visitsToday}. Ayer: ${data.visitsYesterday}.`);
    }

    if (data.alertStats > 0) {
      parts.push(`${data.alertStats} alertas del sistema abiertas.`);
    }

    return parts.join(' ');
  }

  private buildWeeklyNarrative(data: {
    wonThisWeek: number;
    lostThisWeek: number;
    newThisWeek: number;
    visitsThisWeek: number;
    revenueThisWeek: number;
    weekOverWeek: Record<string, { current: number; previous: number; delta: number | null }>;
    inactiveCount: number;
    staleDeals: number;
    totalActive: number;
  }): string {
    const parts: string[] = [];

    parts.push(`Resumen semanal: ${data.wonThisWeek} cierres, ${data.lostThisWeek} perdidos, ${data.newThisWeek} leads nuevos.`);

    if (data.revenueThisWeek > 0) {
      parts.push(`Ingreso de la semana: $${data.revenueThisWeek.toLocaleString('es-MX')}.`);
    }

    parts.push(`${data.visitsThisWeek} visitas realizadas.`);

    // Week over week trends
    const trends: string[] = [];
    for (const [key, val] of Object.entries(data.weekOverWeek)) {
      if (val.delta !== null && Math.abs(val.delta) >= 20) {
        const direction = val.delta > 0 ? 'subio' : 'bajo';
        const labels: Record<string, string> = { won: 'cierres', lost: 'perdidos', newLeads: 'nuevos leads', visits: 'visitas' };
        trends.push(`${labels[key] || key} ${direction} ${Math.abs(val.delta)}%`);
      }
    }
    if (trends.length > 0) {
      parts.push(`Tendencias vs semana anterior: ${trends.join(', ')}.`);
    }

    if (data.inactiveCount > data.totalActive * 0.3) {
      parts.push(`ATENCION: ${data.inactiveCount} de ${data.totalActive} leads activos estan inactivos (7d+ sin contacto).`);
    }

    if (data.staleDeals > 0) {
      parts.push(`${data.staleDeals} deals en etapa avanzada estan estancados.`);
    }

    return parts.join(' ');
  }
}
