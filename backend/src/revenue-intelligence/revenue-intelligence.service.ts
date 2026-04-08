import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const DIRECTOR_ID = '9b9d9e50-0097-4848-a197-5d7f4bd0ef50';

const TEAM_EMAILS = [
  'admin@iea.com',
  'jaime.nav@iealanis.com',
  'j.pimentel@iealanis.com',
  'atencion@iealanis.com',
  'jenifer@iealanis.com',
  'mariana@iealanis.com',
];

/** All active pipeline stages (excludes terminal) */
const ACTIVE_PIPELINE_STAGES = [
  'PENDIENTE_CONTACTAR',
  'INTENTANDO_CONTACTAR',
  'EN_PROSPECCION',
  'AGENDAR_CITA',
  'ESPERANDO_COTIZACION',
  'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO',
  'PENDIENTE_PAGO',
];

const CLOSING_STAGES = [
  'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO',
  'PENDIENTE_PAGO',
];

const TERMINAL_STATUSES = ['CERRADO_GANADO', 'CERRADO_PERDIDO', 'LEAD_BASURA', 'CONTACTAR_FUTURO'];

/** Stage probability for weighted forecasting */
const STAGE_PROBABILITY: Record<string, number> = {
  PENDIENTE_CONTACTAR: 0.05,
  INTENTANDO_CONTACTAR: 0.08,
  EN_PROSPECCION: 0.15,
  AGENDAR_CITA: 0.25,
  ESPERANDO_COTIZACION: 0.40,
  COTIZACION_ENTREGADA: 0.55,
  ESPERANDO_CONTRATO: 0.75,
  PENDIENTE_PAGO: 0.90,
};

const STAGE_LABELS: Record<string, string> = {
  PENDIENTE_CONTACTAR: 'Pendiente Contactar',
  INTENTANDO_CONTACTAR: 'Intentando Contactar',
  EN_PROSPECCION: 'En Prospeccion',
  AGENDAR_CITA: 'Agendar Cita',
  ESPERANDO_COTIZACION: 'Esperando Cotizacion',
  COTIZACION_ENTREGADA: 'Cotizacion Entregada',
  ESPERANDO_CONTRATO: 'Esperando Contrato',
  PENDIENTE_PAGO: 'Pendiente de Pago',
  CERRADO_GANADO: 'Cerrado Ganado',
  CERRADO_PERDIDO: 'Cerrado Perdido',
};

const ZONE_LABELS: Record<string, string> = {
  BAJIO: 'Bajio',
  OCCIDENTE: 'Occidente',
  CENTRO: 'Centro',
  NORTE: 'Norte',
  OTROS: 'Otros',
};

/** Monthly revenue target */
const MONTHLY_TARGET = 8_000_000;
const WEEKLY_TARGET = 2_000_000;

// ═══════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════

export interface RevenueBreakdown {
  label: string;
  key: string;
  deals: number;
  pipeline: number;
  weighted: number;
  avgDealSize: number;
}

export interface ForecastPeriod {
  period: string;
  label: string;
  pipeline: number;
  weighted: number;
  bestCase: number;
  worstCase: number;
  dealsCount: number;
  probabilityToHitTarget: number;
  target: number;
}

export interface GapAnalysis {
  target: number;
  forecast: number;
  closed: number;
  gap: number;
  gapPercent: number;
  dealsNeeded: number;
  avgDealSize: number;
  status: 'on_track' | 'at_risk' | 'behind' | 'exceeded';
  recommendations: string[];
}

export interface RevenueAgentResult {
  cycleId: string;
  timestamp: Date;
  dealsAnalyzed: number;
  risksDetected: number;
  opportunitiesFound: number;
  tasksCreated: number;
  alertsCreated: number;
  insights: string[];
  durationMs: number;
}

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

@Injectable()
export class RevenueIntelligenceService {
  private readonly logger = new Logger(RevenueIntelligenceService.name);
  private lastAgentResult: RevenueAgentResult | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────
  // 1. REAL-TIME REVENUE DASHBOARD
  // ─────────────────────────────────────────────────────────

  async getDashboard() {
    const now = new Date();
    const teamUsers = await this.getTeamUsers();
    const teamIds = teamUsers.map((u: any) => u.id);

    // All active pipeline deals
    const deals = await this.prisma.lead.findMany({
      where: {
        status: { in: ACTIVE_PIPELINE_STAGES as any },
        deletedAt: null,
        isHistorical: false,
        assignedToId: { in: teamIds },
        estimatedValue: { gt: 0 },
      },
      include: { assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });

    // Won deals (for historical context)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const startOfWeek = this.getStartOfWeek(now);

    const wonThisMonth = await this.prisma.lead.findMany({
      where: {
        status: 'CERRADO_GANADO' as any,
        convertedAt: { gte: startOfMonth },
        assignedToId: { in: teamIds },
        deletedAt: null,
        isHistorical: false,
      },
    });

    const wonLastMonth = await this.prisma.lead.findMany({
      where: {
        status: 'CERRADO_GANADO' as any,
        convertedAt: { gte: startOfLastMonth, lt: startOfMonth },
        assignedToId: { in: teamIds },
        deletedAt: null,
        isHistorical: false,
      },
    });

    const wonThisWeek = await this.prisma.lead.findMany({
      where: {
        status: 'CERRADO_GANADO' as any,
        convertedAt: { gte: startOfWeek },
        assignedToId: { in: teamIds },
        deletedAt: null,
        isHistorical: false,
      },
    });

    // Calculate totals
    const totalPipeline = deals.reduce((s: any, d: any) => s + (d.estimatedValue || 0), 0);
    const weightedPipeline = deals.reduce((s: any, d: any) => {
      const prob = STAGE_PROBABILITY[d.status] || 0.1;
      return s + (d.estimatedValue || 0) * prob;
    }, 0);

    const closedThisMonth = wonThisMonth.reduce((s: any, d: any) => s + (d.estimatedValue || 0), 0);
    const closedLastMonth = wonLastMonth.reduce((s: any, d: any) => s + (d.estimatedValue || 0), 0);
    const closedThisWeek = wonThisWeek.reduce((s: any, d: any) => s + (d.estimatedValue || 0), 0);

    // Revenue by stage
    const byStage = this.groupBy(deals, 'status', (d) => STAGE_LABELS[d.status] || d.status);

    // Revenue by advisor
    const byAdvisor = this.groupByAdvisor(deals, teamUsers);

    // Revenue by zone
    const byZone = this.groupBy(deals, 'zone', (d) => ZONE_LABELS[d.zone] || d.zone);

    // Revenue by industry
    const byIndustry = this.groupBy(
      deals,
      (d) => d.industry || 'Sin clasificar',
      (d) => d.industry || 'Sin clasificar',
    );

    // Closing pipeline subset
    const closingDeals = deals.filter((d: any) => CLOSING_STAGES.includes(d.status));
    const closingPipeline = closingDeals.reduce((s: any, d: any) => s + (d.estimatedValue || 0), 0);
    const closingWeighted = closingDeals.reduce((s: any, d: any) => {
      return s + (d.estimatedValue || 0) * (STAGE_PROBABILITY[d.status] || 0.5);
    }, 0);

    // Trend calculation
    const monthOverMonth = closedLastMonth > 0
      ? Math.round(((closedThisMonth - closedLastMonth) / closedLastMonth) * 100)
      : closedThisMonth > 0 ? 100 : 0;

    // Pipeline growth (compare deals created in last 30d vs 30-60d)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 86400000);

    const recentPipelineCount = await this.prisma.lead.count({
      where: {
        createdAt: { gte: thirtyDaysAgo },
        status: { notIn: TERMINAL_STATUSES as any },
        deletedAt: null,
        isHistorical: false,
        assignedToId: { in: teamIds },
      },
    });

    const olderPipelineCount = await this.prisma.lead.count({
      where: {
        createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
        status: { notIn: TERMINAL_STATUSES as any },
        deletedAt: null,
        isHistorical: false,
        assignedToId: { in: teamIds },
      },
    });

    const pipelineGrowth = olderPipelineCount > 0
      ? Math.round(((recentPipelineCount - olderPipelineCount) / olderPipelineCount) * 100)
      : recentPipelineCount > 0 ? 100 : 0;

    return {
      summary: {
        totalPipeline,
        weightedPipeline,
        closingPipeline,
        closingWeighted,
        totalDeals: deals.length,
        closingDeals: closingDeals.length,
        avgDealSize: deals.length > 0 ? Math.round(totalPipeline / deals.length) : 0,
      },
      closed: {
        thisWeek: closedThisWeek,
        thisMonth: closedThisMonth,
        lastMonth: closedLastMonth,
        dealsThisWeek: wonThisWeek.length,
        dealsThisMonth: wonThisMonth.length,
      },
      trends: {
        monthOverMonth,
        pipelineGrowth,
        pipelineDirection: pipelineGrowth > 5 ? 'growing' : pipelineGrowth < -5 ? 'declining' : 'stable',
      },
      breakdowns: {
        byStage,
        byAdvisor,
        byZone,
        byIndustry,
      },
    };
  }

  // ─────────────────────────────────────────────────────────
  // 2. FORECAST ENGINE (PREDICTIVE)
  // ─────────────────────────────────────────────────────────

  async getForecast() {
    const now = new Date();
    const teamUsers = await this.getTeamUsers();
    const teamIds = teamUsers.map((u: any) => u.id);

    // Active pipeline deals
    const deals = await this.prisma.lead.findMany({
      where: {
        status: { in: ACTIVE_PIPELINE_STAGES as any },
        deletedAt: null,
        isHistorical: false,
        assignedToId: { in: teamIds },
        estimatedValue: { gt: 0 },
      },
    });

    // Historical conversion rates (last 90 days)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);
    const wonRecent = await this.prisma.lead.count({
      where: {
        status: 'CERRADO_GANADO' as any,
        convertedAt: { gte: ninetyDaysAgo },
        assignedToId: { in: teamIds },
        deletedAt: null,
        isHistorical: false,
      },
    });
    const lostRecent = await this.prisma.lead.count({
      where: {
        status: 'CERRADO_PERDIDO' as any,
        updatedAt: { gte: ninetyDaysAgo },
        assignedToId: { in: teamIds },
        deletedAt: null,
        isHistorical: false,
      },
    });
    const historicalWinRate = wonRecent + lostRecent > 0
      ? wonRecent / (wonRecent + lostRecent)
      : 0.3; // default 30%

    // Deal velocity — avg days from creation to close (last 90d)
    const wonDeals = await this.prisma.lead.findMany({
      where: {
        status: 'CERRADO_GANADO' as any,
        convertedAt: { gte: ninetyDaysAgo },
        assignedToId: { in: teamIds },
        deletedAt: null,
        isHistorical: false,
      },
      select: { createdAt: true, convertedAt: true },
    });
    const avgVelocityDays = wonDeals.length > 0
      ? wonDeals.reduce((s: any, d: any) => {
          const days = d.convertedAt
            ? (d.convertedAt.getTime() - d.createdAt.getTime()) / 86400000
            : 30;
          return s + days;
        }, 0) / wonDeals.length
      : 30;

    // Forecast periods
    const endOfWeek = this.getEndOfWeek(now);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);

    // Closed so far this month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const closedThisMonthAgg = await this.prisma.lead.aggregate({
      where: {
        status: 'CERRADO_GANADO' as any,
        convertedAt: { gte: startOfMonth },
        assignedToId: { in: teamIds },
        deletedAt: null,
        isHistorical: false,
      },
      _sum: { estimatedValue: true },
      _count: true,
    });
    const closedMonthRevenue = closedThisMonthAgg._sum.estimatedValue || 0;

    const startOfWeek = this.getStartOfWeek(now);
    const closedThisWeekAgg = await this.prisma.lead.aggregate({
      where: {
        status: 'CERRADO_GANADO' as any,
        convertedAt: { gte: startOfWeek },
        assignedToId: { in: teamIds },
        deletedAt: null,
        isHistorical: false,
      },
      _sum: { estimatedValue: true },
      _count: true,
    });
    const closedWeekRevenue = closedThisWeekAgg._sum.estimatedValue || 0;

    // Build forecasts
    const thisWeek = this.buildForecast(
      'this_week', 'Esta Semana', deals, WEEKLY_TARGET,
      closedWeekRevenue, endOfWeek, now, historicalWinRate,
    );
    const thisMonth = this.buildForecast(
      'this_month', 'Este Mes', deals, MONTHLY_TARGET,
      closedMonthRevenue, endOfMonth, now, historicalWinRate,
    );
    const nextMonth = this.buildForecast(
      'next_month', 'Proximo Mes', deals, MONTHLY_TARGET,
      0, endOfNextMonth, endOfMonth, historicalWinRate,
    );

    // Revenue at risk — deals with inactivity signals
    const atRiskDeals = deals.filter((d: any) => {
      const daysSince = d.lastContactedAt
        ? (now.getTime() - d.lastContactedAt.getTime()) / 86400000
        : (now.getTime() - d.updatedAt.getTime()) / 86400000;
      return daysSince > 5 && (d.estimatedValue || 0) > 0;
    });
    const revenueAtRisk = atRiskDeals.reduce((s: any, d: any) => s + (d.estimatedValue || 0), 0);

    return {
      forecasts: [thisWeek, thisMonth, nextMonth],
      historicalWinRate: Math.round(historicalWinRate * 100),
      avgDealVelocityDays: Math.round(avgVelocityDays),
      revenueAtRisk,
      atRiskDeals: atRiskDeals.length,
      closedSoFar: {
        week: closedWeekRevenue,
        month: closedMonthRevenue,
      },
    };
  }

  // ─────────────────────────────────────────────────────────
  // 3. REVENUE GAP ANALYSIS
  // ─────────────────────────────────────────────────────────

  async getGapAnalysis() {
    const now = new Date();
    const teamUsers = await this.getTeamUsers();
    const teamIds = teamUsers.map((u: any) => u.id);

    const startOfWeek = this.getStartOfWeek(now);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Pipeline deals
    const deals = await this.prisma.lead.findMany({
      where: {
        status: { in: ACTIVE_PIPELINE_STAGES as any },
        deletedAt: null,
        isHistorical: false,
        assignedToId: { in: teamIds },
        estimatedValue: { gt: 0 },
      },
    });

    const weightedPipeline = deals.reduce((s: any, d: any) => {
      return s + (d.estimatedValue || 0) * (STAGE_PROBABILITY[d.status] || 0.1);
    }, 0);

    // Closed revenue
    const closedWeekAgg = await this.prisma.lead.aggregate({
      where: {
        status: 'CERRADO_GANADO' as any,
        convertedAt: { gte: startOfWeek },
        assignedToId: { in: teamIds },
        deletedAt: null,
        isHistorical: false,
      },
      _sum: { estimatedValue: true },
      _count: true,
    });
    const closedMonthAgg = await this.prisma.lead.aggregate({
      where: {
        status: 'CERRADO_GANADO' as any,
        convertedAt: { gte: startOfMonth },
        assignedToId: { in: teamIds },
        deletedAt: null,
        isHistorical: false,
      },
      _sum: { estimatedValue: true },
      _count: true,
    });

    const closedWeek = closedWeekAgg._sum.estimatedValue || 0;
    const closedMonth = closedMonthAgg._sum.estimatedValue || 0;

    // Average deal size for estimating deals needed
    const closingDeals = deals.filter((d: any) => CLOSING_STAGES.includes(d.status));
    const avgClosingDealSize = closingDeals.length > 0
      ? closingDeals.reduce((s: any, d: any) => s + (d.estimatedValue || 0), 0) / closingDeals.length
      : 300_000;

    // Weekly gap
    const weeklyGap = Math.max(0, WEEKLY_TARGET - closedWeek - weightedPipeline * 0.3);
    const weeklyDealsNeeded = avgClosingDealSize > 0 ? Math.ceil(weeklyGap / avgClosingDealSize) : 0;

    const weeklyStatus = this.getGapStatus(closedWeek, WEEKLY_TARGET, weightedPipeline);
    const weeklyRecs = this.generateGapRecommendations('week', closedWeek, WEEKLY_TARGET, weeklyGap, deals);

    // Monthly gap
    const monthlyGap = Math.max(0, MONTHLY_TARGET - closedMonth - weightedPipeline * 0.6);
    const monthlyDealsNeeded = avgClosingDealSize > 0 ? Math.ceil(monthlyGap / avgClosingDealSize) : 0;
    const monthlyStatus = this.getGapStatus(closedMonth, MONTHLY_TARGET, weightedPipeline);
    const monthlyRecs = this.generateGapRecommendations('month', closedMonth, MONTHLY_TARGET, monthlyGap, deals);

    return {
      weekly: {
        target: WEEKLY_TARGET,
        forecast: closedWeek + weightedPipeline * 0.3,
        closed: closedWeek,
        gap: weeklyGap,
        gapPercent: WEEKLY_TARGET > 0 ? Math.round((weeklyGap / WEEKLY_TARGET) * 100) : 0,
        dealsNeeded: weeklyDealsNeeded,
        avgDealSize: Math.round(avgClosingDealSize),
        status: weeklyStatus,
        recommendations: weeklyRecs,
      } as GapAnalysis,
      monthly: {
        target: MONTHLY_TARGET,
        forecast: closedMonth + weightedPipeline * 0.6,
        closed: closedMonth,
        gap: monthlyGap,
        gapPercent: MONTHLY_TARGET > 0 ? Math.round((monthlyGap / MONTHLY_TARGET) * 100) : 0,
        dealsNeeded: monthlyDealsNeeded,
        avgDealSize: Math.round(avgClosingDealSize),
        status: monthlyStatus,
        recommendations: monthlyRecs,
      } as GapAnalysis,
      closingPipeline: {
        deals: closingDeals.length,
        value: closingDeals.reduce((s: any, d: any) => s + (d.estimatedValue || 0), 0),
        weighted: closingDeals.reduce((s: any, d: any) => {
          return s + (d.estimatedValue || 0) * (STAGE_PROBABILITY[d.status] || 0.5);
        }, 0),
      },
    };
  }

  // ─────────────────────────────────────────────────────────
  // 4. REVENUE AGENT
  // ─────────────────────────────────────────────────────────

  @Cron('0 45 8-18 * * 1-6') // Every hour at :45, Mon-Sat 8am-6pm
  async runRevenueAgent(): Promise<RevenueAgentResult> {
    const start = Date.now();
    const cycleId = `revenue-${Date.now()}`;
    this.logger.log(`[Revenue Agent] Cycle ${cycleId} starting...`);

    const now = new Date();
    const teamUsers = await this.getTeamUsers();
    const teamIds = teamUsers.map((u: any) => u.id);

    const deals = await this.prisma.lead.findMany({
      where: {
        status: { in: ACTIVE_PIPELINE_STAGES as any },
        deletedAt: null,
        isHistorical: false,
        assignedToId: { in: teamIds },
        estimatedValue: { gt: 0 },
      },
      include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
    });

    let risksDetected = 0;
    let opportunitiesFound = 0;
    let tasksCreated = 0;
    let alertsCreated = 0;
    const insights: string[] = [];

    // ── Risk Detection ──
    // 1. High-value deals going cold (inactive 3+ days in closing stages)
    const coldHighValue = deals.filter((d: any) => {
      const daysSince = d.lastContactedAt
        ? (now.getTime() - d.lastContactedAt.getTime()) / 86400000
        : (now.getTime() - d.updatedAt.getTime()) / 86400000;
      return CLOSING_STAGES.includes(d.status) && daysSince >= 3 && (d.estimatedValue || 0) >= 200_000;
    });

    for (const deal of coldHighValue.slice(0, 10)) {
      risksDetected++;
      const daysSince = deal.lastContactedAt
        ? Math.floor((now.getTime() - deal.lastContactedAt.getTime()) / 86400000)
        : Math.floor((now.getTime() - deal.updatedAt.getTime()) / 86400000);

      // Create task for advisor
      const existing = await this.prisma.salesTask.findFirst({
        where: {
          leadId: deal.id,
          type: 'follow_up',
          status: { in: ['pending', 'in_progress'] },
          title: { contains: 'Revenue Risk' },
          isHistorical: false,
        },
      });
      if (!existing) {
        await this.prisma.salesTask.create({
          data: {
            advisorId: deal.assignedToId!,
            leadId: deal.id,
            type: 'follow_up',
            title: `Revenue Risk: ${deal.companyName} ($${this.fmt(deal.estimatedValue || 0)})`,
            description: `Deal de alto valor inactivo ${daysSince}d en ${STAGE_LABELS[deal.status]}. Contactar HOY para evitar perder $${this.fmt(deal.estimatedValue || 0)}.`,
            priority: 'critical',
            priorityScore: 95,
            dueDate: now,
            source: 'ai',
            zone: deal.zone,
            estimatedValue: deal.estimatedValue,
            leadStatus: deal.status,
          },
        });
        tasksCreated++;
      }
    }
    if (coldHighValue.length > 0) {
      insights.push(`${coldHighValue.length} deals de alto valor estan enfriandose — $${this.fmt(coldHighValue.reduce((s: any, d: any) => s + (d.estimatedValue || 0), 0))} en riesgo`);
    }

    // 2. Stagnant pipeline — deals stuck in same stage 14+ days
    const stagnant = deals.filter((d: any) => {
      const daysInStage = (now.getTime() - d.updatedAt.getTime()) / 86400000;
      return daysInStage >= 14 && (d.estimatedValue || 0) >= 100_000;
    });
    if (stagnant.length > 0) {
      risksDetected += stagnant.length;
      insights.push(`${stagnant.length} deals estancados 14+ dias — revisar y tomar accion ($${this.fmt(stagnant.reduce((s: any, d: any) => s + (d.estimatedValue || 0), 0))})`);
    }

    // 3. Zone underperformance detection
    const zoneStats = new Map<string, { deals: number; pipeline: number; weighted: number }>();
    for (const deal of deals) {
      const z = deal.zone;
      const cur = zoneStats.get(z) || { deals: 0, pipeline: 0, weighted: 0 };
      cur.deals++;
      cur.pipeline += deal.estimatedValue || 0;
      cur.weighted += (deal.estimatedValue || 0) * (STAGE_PROBABILITY[deal.status] || 0.1);
      zoneStats.set(z, cur);
    }

    const avgZoneWeighted = deals.length > 0
      ? [...zoneStats.values()].reduce((s: any, z: any) => s + z.weighted, 0) / zoneStats.size
      : 0;

    for (const [zone, stats] of zoneStats) {
      if (stats.weighted < avgZoneWeighted * 0.5 && stats.deals >= 5) {
        risksDetected++;
        insights.push(`Zona ${ZONE_LABELS[zone] || zone} esta al ${Math.round((stats.weighted / avgZoneWeighted) * 100)}% del promedio — necesita atencion`);
      }
    }

    // ── Opportunity Detection ──
    // 4. Quick wins — deals in closing stages with recent activity
    const quickWins = deals.filter((d: any) => {
      const daysSince = d.lastContactedAt
        ? (now.getTime() - d.lastContactedAt.getTime()) / 86400000
        : 999;
      return CLOSING_STAGES.includes(d.status) && daysSince <= 3 && (d.estimatedValue || 0) >= 100_000;
    });
    if (quickWins.length > 0) {
      opportunitiesFound += quickWins.length;
      insights.push(`${quickWins.length} quick wins detectados — $${this.fmt(quickWins.reduce((s: any, d: any) => s + (d.estimatedValue || 0), 0))} con momentum activo`);
    }

    // 5. Advisor with high pipeline but low closing activity
    const advisorMap = new Map<string, { name: string; pipeline: number; closingDeals: number; totalDeals: number }>();
    for (const deal of deals) {
      const id = deal.assignedToId || 'unassigned';
      const name = deal.assignedTo ? `${deal.assignedTo.firstName} ${deal.assignedTo.lastName}` : 'Sin asignar';
      const cur = advisorMap.get(id) || { name, pipeline: 0, closingDeals: 0, totalDeals: 0 };
      cur.pipeline += deal.estimatedValue || 0;
      cur.totalDeals++;
      if (CLOSING_STAGES.includes(deal.status)) cur.closingDeals++;
      advisorMap.set(id, cur);
    }

    for (const [advisorId, stats] of advisorMap) {
      if (stats.pipeline >= 5_000_000 && stats.closingDeals === 0 && advisorId !== 'unassigned') {
        opportunitiesFound++;
        insights.push(`${stats.name} tiene $${this.fmt(stats.pipeline)} en pipeline pero 0 deals en cierre — revisar avance`);
      }
    }

    // 6. Revenue gap closing suggestions
    const startOfWeek = this.getStartOfWeek(now);
    const closedWeekAgg = await this.prisma.lead.aggregate({
      where: {
        status: 'CERRADO_GANADO' as any,
        convertedAt: { gte: startOfWeek },
        assignedToId: { in: teamIds },
        deletedAt: null,
      },
      _sum: { estimatedValue: true },
    });
    const closedWeek = closedWeekAgg._sum.estimatedValue || 0;

    if (closedWeek < WEEKLY_TARGET * 0.5) {
      const closingPipeline = deals
        .filter((d: any) => CLOSING_STAGES.includes(d.status))
        .reduce((s: any, d: any) => s + (d.estimatedValue || 0), 0);

      insights.push(
        `Revenue semanal al ${Math.round((closedWeek / WEEKLY_TARGET) * 100)}% del target. Pipeline de cierre: $${this.fmt(closingPipeline)} — empujar deals criticos.`,
      );
    }

    // 7. Escalate critical revenue risks to director
    const criticalRisk = coldHighValue.filter((d: any) => (d.estimatedValue || 0) >= 500_000);
    for (const deal of criticalRisk.slice(0, 5)) {
      const existing = await this.prisma.salesAlert.findFirst({
        where: {
          leadId: deal.id,
          type: 'revenue_risk',
          status: 'open',
        },
      });
      if (!existing) {
        await this.prisma.salesAlert.create({
          data: {
            type: 'revenue_risk',
            severity: 'critical',
            leadId: deal.id,
            advisorId: deal.assignedToId,
            title: `Revenue Risk Critico: ${deal.companyName}`,
            message: `Deal de $${this.fmt(deal.estimatedValue || 0)} inactivo en ${STAGE_LABELS[deal.status]}. Requiere intervencion del director.`,
            priorityScore: 98,
            estimatedValue: deal.estimatedValue,
            zone: deal.zone,
            assignedToId: DIRECTOR_ID,
            escalatedTo: 'director',
          },
        });
        alertsCreated++;
      }
    }

    const duration = Date.now() - start;
    this.lastAgentResult = {
      cycleId,
      timestamp: now,
      dealsAnalyzed: deals.length,
      risksDetected,
      opportunitiesFound,
      tasksCreated,
      alertsCreated,
      insights,
      durationMs: duration,
    };

    this.logger.log(
      `[Revenue Agent] Cycle complete: ${deals.length} deals, ${risksDetected} risks, ${opportunitiesFound} opportunities, ${tasksCreated} tasks, ${alertsCreated} alerts (${duration}ms)`,
    );

    return this.lastAgentResult;
  }

  getLastAgentResult() {
    return this.lastAgentResult;
  }

  // ─────────────────────────────────────────────────────────
  // 5. CLOSING + FORECAST INTEGRATION
  // ─────────────────────────────────────────────────────────

  async getClosingForecastIntegration() {
    const now = new Date();
    const teamUsers = await this.getTeamUsers();
    const teamIds = teamUsers.map((u: any) => u.id);

    const closingDeals = await this.prisma.lead.findMany({
      where: {
        status: { in: CLOSING_STAGES as any },
        deletedAt: null,
        isHistorical: false,
        assignedToId: { in: teamIds },
        estimatedValue: { gt: 0 },
      },
      include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { estimatedValue: 'desc' },
    });

    // Score each deal for weekly target alignment
    const scoredDeals = closingDeals.map((d: any) => {
      const prob = STAGE_PROBABILITY[d.status] || 0.5;
      const daysSince = d.lastContactedAt
        ? (now.getTime() - d.lastContactedAt.getTime()) / 86400000
        : (now.getTime() - d.updatedAt.getTime()) / 86400000;
      const isActive = daysSince <= 3;
      const impactScore = Math.min(100, Math.round(
        ((d.estimatedValue || 0) / 500_000) * 30 + prob * 40 + (isActive ? 20 : 0) + (d.status === 'PENDIENTE_PAGO' ? 10 : 0),
      ));

      return {
        id: d.id,
        companyName: d.companyName,
        stage: STAGE_LABELS[d.status] || d.status,
        value: d.estimatedValue || 0,
        weightedValue: (d.estimatedValue || 0) * prob,
        probability: Math.round(prob * 100),
        advisorName: d.assignedTo ? `${d.assignedTo.firstName} ${d.assignedTo.lastName}` : 'Sin asignar',
        daysSinceContact: Math.floor(daysSince),
        impactScore,
        isActive,
        closingStrategy: this.getClosingStrategy(d.status, daysSince, d.estimatedValue || 0),
      };
    });

    // Top impact deals for this week
    const topImpact = [...scoredDeals].sort((a: any, b: any) => b.impactScore - a.impactScore).slice(0, 15);

    // Advisor distribution
    const byAdvisor = new Map<string, { deals: number; pipeline: number; weighted: number }>();
    for (const d of scoredDeals) {
      const cur = byAdvisor.get(d.advisorName) || { deals: 0, pipeline: 0, weighted: 0 };
      cur.deals++;
      cur.pipeline += d.value;
      cur.weighted += d.weightedValue;
      byAdvisor.set(d.advisorName, cur);
    }

    return {
      highImpactDeals: topImpact,
      totalClosingPipeline: closingDeals.reduce((s: any, d: any) => s + (d.estimatedValue || 0), 0),
      totalClosingWeighted: closingDeals.reduce((s: any, d: any) => {
        return s + (d.estimatedValue || 0) * (STAGE_PROBABILITY[d.status] || 0.5);
      }, 0),
      closingDealsCount: closingDeals.length,
      advisorDistribution: [...byAdvisor.entries()].map(([name, stats]) => ({
        advisorName: name,
        ...stats,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────
  // 6. DIRECTOR VIEW
  // ─────────────────────────────────────────────────────────

  async getDirectorView() {
    const now = new Date();
    const teamUsers = await this.getTeamUsers();
    const teamIds = teamUsers.map((u: any) => u.id);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = this.getStartOfWeek(now);

    // Full pipeline
    const deals = await this.prisma.lead.findMany({
      where: {
        status: { in: ACTIVE_PIPELINE_STAGES as any },
        deletedAt: null,
        isHistorical: false,
        assignedToId: { in: teamIds },
        estimatedValue: { gt: 0 },
      },
      include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
    });

    const totalPipeline = deals.reduce((s: any, d: any) => s + (d.estimatedValue || 0), 0);
    const weighted = deals.reduce((s: any, d: any) => {
      return s + (d.estimatedValue || 0) * (STAGE_PROBABILITY[d.status] || 0.1);
    }, 0);

    // Closed revenue
    const closedMonth = await this.prisma.lead.aggregate({
      where: {
        status: 'CERRADO_GANADO' as any,
        convertedAt: { gte: startOfMonth },
        assignedToId: { in: teamIds },
        deletedAt: null,
        isHistorical: false,
      },
      _sum: { estimatedValue: true },
      _count: true,
    });
    const closedWeek = await this.prisma.lead.aggregate({
      where: {
        status: 'CERRADO_GANADO' as any,
        convertedAt: { gte: startOfWeek },
        assignedToId: { in: teamIds },
        deletedAt: null,
        isHistorical: false,
      },
      _sum: { estimatedValue: true },
      _count: true,
    });

    const closedMonthVal = closedMonth._sum.estimatedValue || 0;
    const closedWeekVal = closedWeek._sum.estimatedValue || 0;

    // Top deals
    const topDeals = [...deals]
      .sort((a: any, b: any) => (b.estimatedValue || 0) - (a.estimatedValue || 0))
      .slice(0, 10)
      .map((d: any) => ({
        id: d.id,
        companyName: d.companyName,
        value: d.estimatedValue || 0,
        stage: STAGE_LABELS[d.status] || d.status,
        probability: Math.round((STAGE_PROBABILITY[d.status] || 0.1) * 100),
        advisor: d.assignedTo ? `${d.assignedTo.firstName} ${d.assignedTo.lastName}` : 'Sin asignar',
        zone: ZONE_LABELS[d.zone] || d.zone,
        daysSinceContact: d.lastContactedAt
          ? Math.floor((now.getTime() - d.lastContactedAt.getTime()) / 86400000)
          : Math.floor((now.getTime() - d.updatedAt.getTime()) / 86400000),
      }));

    // High-value at risk
    const atRisk = deals
      .filter((d: any) => {
        const daysSince = d.lastContactedAt
          ? (now.getTime() - d.lastContactedAt.getTime()) / 86400000
          : (now.getTime() - d.updatedAt.getTime()) / 86400000;
        return daysSince > 3 && (d.estimatedValue || 0) >= 200_000;
      })
      .sort((a: any, b: any) => (b.estimatedValue || 0) - (a.estimatedValue || 0))
      .slice(0, 15)
      .map((d: any) => ({
        id: d.id,
        companyName: d.companyName,
        value: d.estimatedValue || 0,
        stage: STAGE_LABELS[d.status] || d.status,
        advisor: d.assignedTo ? `${d.assignedTo.firstName} ${d.assignedTo.lastName}` : 'Sin asignar',
        daysSinceContact: d.lastContactedAt
          ? Math.floor((now.getTime() - d.lastContactedAt.getTime()) / 86400000)
          : Math.floor((now.getTime() - d.updatedAt.getTime()) / 86400000),
      }));

    // Advisor revenue drivers
    const advisorRevenue = new Map<string, { name: string; pipeline: number; weighted: number; deals: number; closingDeals: number; closedWeek: number }>();
    for (const d of deals) {
      const id = d.assignedToId || 'none';
      const name = d.assignedTo ? `${d.assignedTo.firstName} ${d.assignedTo.lastName}` : 'Sin asignar';
      const cur = advisorRevenue.get(id) || { name, pipeline: 0, weighted: 0, deals: 0, closingDeals: 0, closedWeek: 0 };
      cur.pipeline += d.estimatedValue || 0;
      cur.weighted += (d.estimatedValue || 0) * (STAGE_PROBABILITY[d.status] || 0.1);
      cur.deals++;
      if (CLOSING_STAGES.includes(d.status)) cur.closingDeals++;
      advisorRevenue.set(id, cur);
    }

    // Underperforming segments
    const underperforming: string[] = [];
    const zonePerf = new Map<string, number>();
    for (const d of deals) {
      zonePerf.set(d.zone, (zonePerf.get(d.zone) || 0) + (d.estimatedValue || 0) * (STAGE_PROBABILITY[d.status] || 0.1));
    }
    const avgZone = [...zonePerf.values()].reduce((s: any, v: any) => s + v, 0) / Math.max(zonePerf.size, 1);
    for (const [z, v] of zonePerf) {
      if (v < avgZone * 0.4) underperforming.push(`Zona ${ZONE_LABELS[z] || z}: $${this.fmt(v)} weighted (${Math.round((v / avgZone) * 100)}% del promedio)`);
    }

    // Recommendations
    const recs: string[] = [];
    const monthGap = MONTHLY_TARGET - closedMonthVal;
    if (monthGap > 0) {
      recs.push(`Faltan $${this.fmt(monthGap)} para meta mensual. Pipeline ponderado disponible: $${this.fmt(weighted)}.`);
    }
    if (atRisk.length > 0) {
      recs.push(`${atRisk.length} deals de alto valor en riesgo ($${this.fmt(atRisk.reduce((s: any, d: any) => s + d.value, 0))}). Revisar y reasignar si es necesario.`);
    }
    const closingPipeline = deals.filter((d: any) => CLOSING_STAGES.includes(d.status));
    if (closingPipeline.length > 0) {
      recs.push(`${closingPipeline.length} deals en etapa de cierre — empujar para conversion inmediata.`);
    }

    return {
      revenue: {
        closedWeek: closedWeekVal,
        closedMonth: closedMonthVal,
        weeklyTarget: WEEKLY_TARGET,
        monthlyTarget: MONTHLY_TARGET,
        weeklyProgress: WEEKLY_TARGET > 0 ? Math.round((closedWeekVal / WEEKLY_TARGET) * 100) : 0,
        monthlyProgress: MONTHLY_TARGET > 0 ? Math.round((closedMonthVal / MONTHLY_TARGET) * 100) : 0,
        pipeline: totalPipeline,
        weighted,
      },
      topDeals,
      atRisk,
      advisors: [...advisorRevenue.values()].sort((a: any, b: any) => b.weighted - a.weighted),
      underperforming,
      recommendations: recs,
    };
  }

  // ─────────────────────────────────────────────────────────
  // 7. SUPERVISOR VIEW
  // ─────────────────────────────────────────────────────────

  async getSupervisorView() {
    const now = new Date();
    const teamUsers = await this.getTeamUsers();
    const teamIds = teamUsers.map((u: any) => u.id);

    const startOfWeek = this.getStartOfWeek(now);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Active pipeline
    const deals = await this.prisma.lead.findMany({
      where: {
        status: { in: ACTIVE_PIPELINE_STAGES as any },
        deletedAt: null,
        isHistorical: false,
        assignedToId: { in: teamIds },
        estimatedValue: { gt: 0 },
      },
      include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
    });

    // Closed deals by advisor this week/month
    const closedWeekDeals = await this.prisma.lead.findMany({
      where: {
        status: 'CERRADO_GANADO' as any,
        convertedAt: { gte: startOfWeek },
        assignedToId: { in: teamIds },
        deletedAt: null,
        isHistorical: false,
      },
      select: { assignedToId: true, estimatedValue: true },
    });
    const closedMonthDeals = await this.prisma.lead.findMany({
      where: {
        status: 'CERRADO_GANADO' as any,
        convertedAt: { gte: startOfMonth },
        assignedToId: { in: teamIds },
        deletedAt: null,
        isHistorical: false,
      },
      select: { assignedToId: true, estimatedValue: true },
    });

    // Overdue tasks per advisor
    const overdueTasks = await this.prisma.salesTask.findMany({
      where: {
        advisorId: { in: teamIds },
        status: { in: ['pending', 'in_progress'] },
        dueDate: { lt: now },
        isHistorical: false,
      },
      select: { advisorId: true },
    });

    // Build per-advisor stats
    const advisorStats = new Map<string, {
      id: string;
      name: string;
      pipeline: number;
      weighted: number;
      totalDeals: number;
      closingDeals: number;
      closedWeek: number;
      closedWeekRevenue: number;
      closedMonth: number;
      closedMonthRevenue: number;
      overdueTasks: number;
      dealsAtRisk: number;
      avgDaysSinceContact: number;
    }>();

    // Init from team users
    for (const u of teamUsers) {
      advisorStats.set(u.id, {
        id: u.id,
        name: `${u.firstName} ${u.lastName}`,
        pipeline: 0,
        weighted: 0,
        totalDeals: 0,
        closingDeals: 0,
        closedWeek: 0,
        closedWeekRevenue: 0,
        closedMonth: 0,
        closedMonthRevenue: 0,
        overdueTasks: 0,
        dealsAtRisk: 0,
        avgDaysSinceContact: 0,
      });
    }

    // Pipeline stats
    for (const d of deals) {
      const stats = advisorStats.get(d.assignedToId || '');
      if (!stats) continue;
      stats.pipeline += d.estimatedValue || 0;
      stats.weighted += (d.estimatedValue || 0) * (STAGE_PROBABILITY[d.status] || 0.1);
      stats.totalDeals++;
      if (CLOSING_STAGES.includes(d.status)) stats.closingDeals++;

      const daysSince = d.lastContactedAt
        ? (now.getTime() - d.lastContactedAt.getTime()) / 86400000
        : (now.getTime() - d.updatedAt.getTime()) / 86400000;
      if (daysSince > 5) stats.dealsAtRisk++;
      stats.avgDaysSinceContact += daysSince;
    }

    // Finalize averages
    for (const stats of advisorStats.values()) {
      if (stats.totalDeals > 0) {
        stats.avgDaysSinceContact = Math.round(stats.avgDaysSinceContact / stats.totalDeals);
      }
    }

    // Closed deals
    for (const d of closedWeekDeals) {
      const stats = advisorStats.get(d.assignedToId || '');
      if (stats) {
        stats.closedWeek++;
        stats.closedWeekRevenue += d.estimatedValue || 0;
      }
    }
    for (const d of closedMonthDeals) {
      const stats = advisorStats.get(d.assignedToId || '');
      if (stats) {
        stats.closedMonth++;
        stats.closedMonthRevenue += d.estimatedValue || 0;
      }
    }

    // Overdue tasks
    for (const t of overdueTasks) {
      const stats = advisorStats.get(t.advisorId);
      if (stats) stats.overdueTasks++;
    }

    const advisors = [...advisorStats.values()].sort((a: any, b: any) => b.weighted - a.weighted);

    // Action items for supervisor
    const actionItems: string[] = [];
    for (const a of advisors) {
      if (a.dealsAtRisk > 10) {
        actionItems.push(`${a.name}: ${a.dealsAtRisk} deals en riesgo por inactividad — revisar seguimiento.`);
      }
      if (a.overdueTasks > 20) {
        actionItems.push(`${a.name}: ${a.overdueTasks} tareas vencidas — presionar ejecucion.`);
      }
      if (a.pipeline > 5_000_000 && a.closedWeek === 0) {
        actionItems.push(`${a.name}: $${this.fmt(a.pipeline)} en pipeline pero $0 cerrado esta semana.`);
      }
    }

    return {
      advisors,
      teamTotals: {
        pipeline: advisors.reduce((s: any, a: any) => s + a.pipeline, 0),
        weighted: advisors.reduce((s: any, a: any) => s + a.weighted, 0),
        totalDeals: advisors.reduce((s: any, a: any) => s + a.totalDeals, 0),
        closedWeekRevenue: advisors.reduce((s: any, a: any) => s + a.closedWeekRevenue, 0),
        closedMonthRevenue: advisors.reduce((s: any, a: any) => s + a.closedMonthRevenue, 0),
        dealsAtRisk: advisors.reduce((s: any, a: any) => s + a.dealsAtRisk, 0),
        overdueTasks: advisors.reduce((s: any, a: any) => s + a.overdueTasks, 0),
      },
      actionItems,
    };
  }

  // ─────────────────────────────────────────────────────────
  // 8. DAILY REVENUE TRACKING
  // ─────────────────────────────────────────────────────────

  async getDailyTracking() {
    const now = new Date();
    const teamUsers = await this.getTeamUsers();
    const teamIds = teamUsers.map((u: any) => u.id);

    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = this.getStartOfWeek(now);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Revenue by period
    const [closedToday, closedWeek, closedMonth] = await Promise.all([
      this.prisma.lead.aggregate({
        where: {
          status: 'CERRADO_GANADO' as any,
          convertedAt: { gte: startOfDay },
          assignedToId: { in: teamIds },
          deletedAt: null,
          isHistorical: false,
        },
        _sum: { estimatedValue: true },
        _count: true,
      }),
      this.prisma.lead.aggregate({
        where: {
          status: 'CERRADO_GANADO' as any,
          convertedAt: { gte: startOfWeek },
          assignedToId: { in: teamIds },
          deletedAt: null,
          isHistorical: false,
        },
        _sum: { estimatedValue: true },
        _count: true,
      }),
      this.prisma.lead.aggregate({
        where: {
          status: 'CERRADO_GANADO' as any,
          convertedAt: { gte: startOfMonth },
          assignedToId: { in: teamIds },
          deletedAt: null,
          isHistorical: false,
        },
        _sum: { estimatedValue: true },
        _count: true,
      }),
    ]);

    const todayRevenue = closedToday._sum.estimatedValue || 0;
    const weekRevenue = closedWeek._sum.estimatedValue || 0;
    const monthRevenue = closedMonth._sum.estimatedValue || 0;

    // Lost today
    const lostToday = await this.prisma.lead.aggregate({
      where: {
        status: 'CERRADO_PERDIDO' as any,
        updatedAt: { gte: startOfDay },
        assignedToId: { in: teamIds },
        deletedAt: null,
        isHistorical: false,
      },
      _sum: { estimatedValue: true },
      _count: true,
    });

    // Days remaining in period
    const endOfWeek = this.getEndOfWeek(now);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const daysLeftWeek = Math.max(1, Math.ceil((endOfWeek.getTime() - now.getTime()) / 86400000));
    const daysLeftMonth = Math.max(1, Math.ceil((endOfMonth.getTime() - now.getTime()) / 86400000));

    // Required daily pace
    const weeklyRemaining = Math.max(0, WEEKLY_TARGET - weekRevenue);
    const monthlyRemaining = Math.max(0, MONTHLY_TARGET - monthRevenue);
    const dailyPaceWeek = daysLeftWeek > 0 ? weeklyRemaining / daysLeftWeek : 0;
    const dailyPaceMonth = daysLeftMonth > 0 ? monthlyRemaining / daysLeftMonth : 0;

    return {
      daily: {
        revenue: todayRevenue,
        deals: closedToday._count,
        lostRevenue: lostToday._sum.estimatedValue || 0,
        lostDeals: lostToday._count,
      },
      weekly: {
        revenue: weekRevenue,
        deals: closedWeek._count,
        target: WEEKLY_TARGET,
        progress: WEEKLY_TARGET > 0 ? Math.round((weekRevenue / WEEKLY_TARGET) * 100) : 0,
        remaining: weeklyRemaining,
        daysLeft: daysLeftWeek,
        requiredDailyPace: Math.round(dailyPaceWeek),
      },
      monthly: {
        revenue: monthRevenue,
        deals: closedMonth._count,
        target: MONTHLY_TARGET,
        progress: MONTHLY_TARGET > 0 ? Math.round((monthRevenue / MONTHLY_TARGET) * 100) : 0,
        remaining: monthlyRemaining,
        daysLeft: daysLeftMonth,
        requiredDailyPace: Math.round(dailyPaceMonth),
      },
    };
  }

  // ─────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────

  private async getTeamUsers() {
    return this.prisma.user.findMany({
      where: { email: { in: TEAM_EMAILS } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
  }

  private getStartOfWeek(d: Date): Date {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const start = new Date(d);
    start.setDate(diff);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  private getEndOfWeek(d: Date): Date {
    const start = this.getStartOfWeek(d);
    return new Date(start.getTime() + 6 * 86400000);
  }

  private groupBy(
    deals: any[],
    keyFn: string | ((d: any) => string),
    labelFn: (d: any) => string,
  ): RevenueBreakdown[] {
    const map = new Map<string, { label: string; deals: number; pipeline: number; weighted: number }>();
    for (const d of deals) {
      const key = typeof keyFn === 'string' ? d[keyFn] : keyFn(d);
      const cur = map.get(key) || { label: labelFn(d), deals: 0, pipeline: 0, weighted: 0 };
      cur.deals++;
      cur.pipeline += d.estimatedValue || 0;
      cur.weighted += (d.estimatedValue || 0) * (STAGE_PROBABILITY[d.status] || 0.1);
      map.set(key, cur);
    }
    return [...map.entries()].map(([key, v]) => ({
      key,
      label: v.label,
      deals: v.deals,
      pipeline: v.pipeline,
      weighted: v.weighted,
      avgDealSize: v.deals > 0 ? Math.round(v.pipeline / v.deals) : 0,
    })).sort((a: any, b: any) => b.weighted - a.weighted);
  }

  private groupByAdvisor(deals: any[], teamUsers: any[]): RevenueBreakdown[] {
    const map = new Map<string, { label: string; deals: number; pipeline: number; weighted: number }>();
    for (const d of deals) {
      const key = d.assignedToId || 'unassigned';
      const at = d.assignedTo;
      const label = at ? `${at.firstName} ${at.lastName}` : 'Sin asignar';
      const cur = map.get(key) || { label, deals: 0, pipeline: 0, weighted: 0 };
      cur.deals++;
      cur.pipeline += d.estimatedValue || 0;
      cur.weighted += (d.estimatedValue || 0) * (STAGE_PROBABILITY[d.status] || 0.1);
      map.set(key, cur);
    }
    return [...map.entries()].map(([key, v]) => ({
      key,
      label: v.label,
      deals: v.deals,
      pipeline: v.pipeline,
      weighted: v.weighted,
      avgDealSize: v.deals > 0 ? Math.round(v.pipeline / v.deals) : 0,
    })).sort((a: any, b: any) => b.weighted - a.weighted);
  }

  private buildForecast(
    period: string,
    label: string,
    deals: any[],
    target: number,
    alreadyClosed: number,
    endDate: Date,
    startDate: Date,
    historicalWinRate: number,
  ): ForecastPeriod {
    const totalPipeline = deals.reduce((s: any, d: any) => s + (d.estimatedValue || 0), 0);
    const weighted = deals.reduce((s: any, d: any) => {
      return s + (d.estimatedValue || 0) * (STAGE_PROBABILITY[d.status] || 0.1);
    }, 0);

    // Best case: high-probability deals close + some medium
    const bestCase = alreadyClosed + deals
      .filter((d: any) => (STAGE_PROBABILITY[d.status] || 0) >= 0.4)
      .reduce((s: any, d: any) => s + (d.estimatedValue || 0) * 0.8, 0);

    // Worst case: only payment-stage deals close
    const worstCase = alreadyClosed + deals
      .filter((d: any) => d.status === 'PENDIENTE_PAGO')
      .reduce((s: any, d: any) => s + (d.estimatedValue || 0) * 0.9, 0);

    const forecast = alreadyClosed + weighted * (period === 'this_week' ? 0.3 : period === 'this_month' ? 0.6 : 0.4);
    const probToHit = target > 0 ? Math.min(100, Math.round((forecast / target) * 100)) : 100;

    return {
      period,
      label,
      pipeline: totalPipeline,
      weighted: alreadyClosed + weighted,
      bestCase: Math.round(bestCase),
      worstCase: Math.round(worstCase),
      dealsCount: deals.length,
      probabilityToHitTarget: probToHit,
      target,
    };
  }

  private getGapStatus(closed: number, target: number, weighted: number): 'on_track' | 'at_risk' | 'behind' | 'exceeded' {
    if (closed >= target) return 'exceeded';
    const forecast = closed + weighted * 0.5;
    if (forecast >= target * 0.9) return 'on_track';
    if (forecast >= target * 0.6) return 'at_risk';
    return 'behind';
  }

  private generateGapRecommendations(period: string, closed: number, target: number, gap: number, deals: any[]): string[] {
    const recs: string[] = [];
    if (gap <= 0) {
      recs.push(`Meta ${period === 'week' ? 'semanal' : 'mensual'} alcanzada! Revenue: $${this.fmt(closed)}.`);
      return recs;
    }

    recs.push(`Faltan $${this.fmt(gap)} para meta ${period === 'week' ? 'semanal' : 'mensual'}. Pipeline ponderado: $${this.fmt(deals.reduce((s: any, d: any) => s + (d.estimatedValue || 0) * (STAGE_PROBABILITY[d.status] || 0.1), 0))}.`);

    const closingDeals = deals.filter((d: any) => CLOSING_STAGES.includes(d.status));
    const criticalCount = closingDeals.filter((d: any) => (d.estimatedValue || 0) >= 200_000).length;
    if (criticalCount > 0) {
      recs.push(`${criticalCount} deals criticos en cierre requieren accion inmediata.`);
    }

    const inactive = deals.filter((d: any) => {
      const daysSince = d.lastContactedAt
        ? (Date.now() - d.lastContactedAt.getTime()) / 86400000
        : (Date.now() - d.updatedAt.getTime()) / 86400000;
      return CLOSING_STAGES.includes(d.status) && daysSince > 3;
    });
    if (inactive.length > 0) {
      recs.push(`${inactive.length} deals en cierre inactivos 3+ dias — riesgo de enfriamiento ($${this.fmt(inactive.reduce((s: any, d: any) => s + (d.estimatedValue || 0), 0))}).`);
    }

    const paymentStage = deals.filter((d: any) => d.status === 'PENDIENTE_PAGO');
    if (paymentStage.length > 0) {
      recs.push(`${paymentStage.length} deals en Pendiente de Pago ($${this.fmt(paymentStage.reduce((s: any, d: any) => s + (d.estimatedValue || 0), 0))}) — confirmar transferencias.`);
    }

    return recs;
  }

  private getClosingStrategy(stage: string, daysSinceContact: number, value: number): string {
    if (stage === 'PENDIENTE_PAGO') {
      return daysSinceContact > 2
        ? 'URGENTE: Confirmar transferencia. Llamar ahora.'
        : 'Monitorear pago. Enviar recordatorio amable.';
    }
    if (stage === 'ESPERANDO_CONTRATO') {
      return daysSinceContact > 3
        ? 'Empujar firma. Enviar contrato digital con urgencia.'
        : 'Seguimiento contrato. Resolver dudas pendientes.';
    }
    if (stage === 'COTIZACION_ENTREGADA') {
      if (value >= 500_000) return 'Deal critico. Llamar al tomador de decisiones directamente.';
      return daysSinceContact > 5
        ? 'Reactivar interes. Enviar caso de exito relevante.'
        : 'Seguimiento cotizacion. Clarificar dudas.';
    }
    return 'Avanzar al siguiente paso del proceso.';
  }

  private fmt(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toFixed(0);
  }
}
