import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const TEAM_EMAILS = [
  'jaime.nav@iealanis.com', 'j.pimentel@iealanis.com',
  'atencion@iealanis.com', 'jenifer@iealanis.com',
  'mariana@iealanis.com', 'admin@iea.com',
];

const ACTIVE_STATUSES = [
  'PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR', 'EN_PROSPECCION',
  'AGENDAR_CITA', 'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO',
] as any;

const CLOSING_STATUSES = [
  'COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO',
] as any;

const NEAR_CLOSE_STATUSES = ['ESPERANDO_CONTRATO', 'PENDIENTE_PAGO'] as any;

const TERMINAL = ['CERRADO_GANADO', 'CERRADO_PERDIDO', 'LEAD_BASURA', 'CONTACTAR_FUTURO'] as any;

const STAGE_LABELS: Record<string, string> = {
  PENDIENTE_CONTACTAR: 'Pendiente Contactar',
  INTENTANDO_CONTACTAR: 'Intentando Contactar',
  EN_PROSPECCION: 'En Prospeccion',
  AGENDAR_CITA: 'Agendar Cita',
  ESPERANDO_COTIZACION: 'Esperando Cotizacion',
  COTIZACION_ENTREGADA: 'Cotizacion Entregada',
  ESPERANDO_CONTRATO: 'Esperando Contrato',
  PENDIENTE_PAGO: 'Pendiente Pago',
  CERRADO_GANADO: 'Cerrado Ganado',
  CERRADO_PERDIDO: 'Cerrado Perdido',
};

const STAGE_PROBABILITY: Record<string, number> = {
  PENDIENTE_CONTACTAR: 0.05, INTENTANDO_CONTACTAR: 0.10,
  EN_PROSPECCION: 0.20, AGENDAR_CITA: 0.30,
  ESPERANDO_COTIZACION: 0.50, COTIZACION_ENTREGADA: 0.65,
  ESPERANDO_CONTRATO: 0.80, PENDIENTE_PAGO: 0.90,
};

const TASK_ICONS: Record<string, string> = {
  call: '📞', whatsapp: '💬', email: '📧', follow_up: '🔄',
  reactivation: '♻️', close_deal: '💰', escalation: '🚨',
  visit: '📍', send_quote: '📋',
};

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfWeek(d = new Date()) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function startOfMonth(d = new Date()) { const x = startOfDay(d); x.setDate(1); return x; }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function fmt(n: number) {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${Math.round(n / 1_000)}K` : `$${n}`;
}

@Injectable()
export class CommandCenterService {
  private readonly logger = new Logger(CommandCenterService.name);

  constructor(private prisma: PrismaService) {}

  // Cache team users for repeated calls within same request
  private teamUsersCache: Array<{ id: string; firstName: string; lastName: string; email: string }> | null = null;

  private async getTeamUsers() {
    if (!this.teamUsersCache) {
      this.teamUsersCache = await this.prisma.user.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, email: true },
      });
      // Clear cache after 30s
      setTimeout(() => { this.teamUsersCache = null; }, 30000);
    }
    return this.teamUsersCache;
  }

  // ═══════════════════════════════════════════════════════════
  // 1. MAIN DASHBOARD — Today-focused overview
  // ═══════════════════════════════════════════════════════════

  async getDashboard() {
    const today = startOfDay();
    const weekStart = startOfWeek();
    const monthStart = startOfMonth();
    const now = new Date();

    const [
      leadsToday, leadsWeek, leadsMonth,
      dealsClosingTotal,
      wonToday, wonWeek, wonMonth,
      pipelineAgg, closingAgg,
      noContact, stuckDeals,
      stageCounts,
      closingDeals,
      // Today-specific activity
      tasksCompletedToday,
      tasksByTypeToday,
      dealsMoved,
      cotizacionesToday,
      reactivationsToday,
      newAssignments,
      conversionsMonth,
      teamActivity,
    ] = await Promise.all([
      this.prisma.lead.count({ where: { deletedAt: null, isHistorical: false, createdAt: { gte: today } } }),
      this.prisma.lead.count({ where: { deletedAt: null, isHistorical: false, createdAt: { gte: weekStart } } }),
      this.prisma.lead.count({ where: { deletedAt: null, isHistorical: false, createdAt: { gte: monthStart } } }),
      this.prisma.lead.count({ where: { deletedAt: null, isHistorical: false, status: { in: CLOSING_STATUSES } } }),
      this.prisma.lead.count({ where: { deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO' as any, convertedAt: { gte: today } } }),
      this.prisma.lead.count({ where: { deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO' as any, convertedAt: { gte: weekStart } } }),
      this.prisma.lead.count({ where: { deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO' as any, convertedAt: { gte: monthStart } } }),
      this.prisma.lead.aggregate({
        where: { deletedAt: null, isHistorical: false, status: { in: ACTIVE_STATUSES } },
        _sum: { estimatedValue: true }, _count: true, _avg: { estimatedValue: true },
      }),
      this.prisma.lead.aggregate({
        where: { deletedAt: null, isHistorical: false, status: { in: CLOSING_STATUSES } },
        _sum: { estimatedValue: true }, _count: true,
      }),
      this.prisma.lead.count({
        where: { deletedAt: null, isHistorical: false, status: { in: ACTIVE_STATUSES },
          OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: daysAgo(7) } }] },
      }),
      this.prisma.lead.count({
        where: { deletedAt: null, isHistorical: false, status: { in: CLOSING_STATUSES }, updatedAt: { lt: daysAgo(5) } },
      }),
      this.prisma.lead.groupBy({
        by: ['status'],
        where: { deletedAt: null, isHistorical: false, status: { notIn: TERMINAL } },
        _count: true, _sum: { estimatedValue: true },
      }),
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false, status: { in: CLOSING_STATUSES } },
        select: { id: true, companyName: true, contactName: true, status: true, estimatedValue: true, zone: true, assignedToId: true, updatedAt: true },
        orderBy: { estimatedValue: { sort: 'desc', nulls: 'last' } },
        take: 10,
      }),
      // Tasks completed today
      this.prisma.salesTask.count({ where: { isHistorical: false, status: 'completed', completedAt: { gte: today } } }),
      // Tasks by type today (completed)
      this.prisma.salesTask.groupBy({
        by: ['type'],
        where: { isHistorical: false, status: 'completed', completedAt: { gte: today } },
        _count: true,
      }),
      // Deals moved in pipeline today
      this.prisma.salesTask.count({ where: { isHistorical: false, pipelineMoved: true, completedAt: { gte: today } } }),
      // Cotizaciones entregadas today (leads that entered COTIZACION_ENTREGADA today)
      this.prisma.lead.count({
        where: { deletedAt: null, isHistorical: false, status: 'COTIZACION_ENTREGADA' as any, updatedAt: { gte: today } },
      }),
      // Reactivations today
      this.prisma.salesTask.count({
        where: { isHistorical: false, type: 'reactivation', status: 'completed', completedAt: { gte: today } },
      }),
      // New assignments today
      this.prisma.salesTask.count({ where: { isHistorical: false, createdAt: { gte: today } } }),
      // Conversions this month (won)
      this.prisma.lead.count({
        where: { deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO' as any, convertedAt: { gte: monthStart } },
      }),
      // Team activity today by advisor
      this.prisma.salesTask.groupBy({
        by: ['advisorId'],
        where: { isHistorical: false, status: 'completed', completedAt: { gte: today } },
        _count: true,
      }),
    ]);

    // Build activity by type
    const activityByType: Record<string, number> = {};
    for (const t of tasksByTypeToday) {
      activityByType[t.type] = t._count;
    }

    // Enrich advisor names
    const teamUsers = await this.getTeamUsers();
    const teamMap = Object.fromEntries(teamUsers.map(u => [u.id, `${u.firstName} ${u.lastName}`]));

    const advisorIds = [...new Set(closingDeals.map(l => l.assignedToId).filter(Boolean))] as string[];
    const advisors = advisorIds.length > 0
      ? await this.prisma.user.findMany({ where: { id: { in: advisorIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const advisorMap = Object.fromEntries(advisors.map(a => [a.id, `${a.firstName} ${a.lastName}`]));

    // Funnel
    const stageOrder = ['PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR', 'EN_PROSPECCION',
      'AGENDAR_CITA', 'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO'];
    const funnel = stageOrder.map(status => {
      const match = stageCounts.find(s => s.status === status);
      return {
        status, label: STAGE_LABELS[status] || status,
        count: match?._count ?? 0, value: match?._sum?.estimatedValue ?? 0,
        probability: STAGE_PROBABILITY[status] ?? 0,
      };
    });

    // Today's value created
    const leadsCreatedToday = await this.prisma.lead.aggregate({
      where: { deletedAt: null, isHistorical: false, createdAt: { gte: today } },
      _sum: { estimatedValue: true }, _avg: { estimatedValue: true },
    });

    return {
      timestamp: now.toISOString(),
      // Section A: Today Summary
      todaySummary: {
        leadsCreated: leadsToday,
        dealsInClosing: dealsClosingTotal,
        totalAmountCreated: leadsCreatedToday._sum.estimatedValue ?? 0,
        avgTicketToday: Math.round(leadsCreatedToday._avg?.estimatedValue ?? 0),
        cotizacionesEntregadas: cotizacionesToday,
        reactivations: reactivationsToday,
        newAssignments,
        conversionsMonth: conversionsMonth,
        wonToday,
        dealsMoved,
      },
      // Section B: Team Activity Today
      teamActivityToday: {
        callsMade: activityByType['call'] ?? 0,
        whatsappsSent: activityByType['whatsapp'] ?? 0,
        emailsSent: activityByType['email'] ?? 0,
        contactAttempts: (activityByType['call'] ?? 0) + (activityByType['whatsapp'] ?? 0) + (activityByType['email'] ?? 0),
        followUpsCompleted: activityByType['follow_up'] ?? 0,
        dealsMoved,
        totalTasksCompleted: tasksCompletedToday,
        quotesDelivered: activityByType['send_quote'] ?? 0,
      },
      // Legacy fields for backward compat
      creation: {
        leads: { today: leadsToday, week: leadsWeek, month: leadsMonth },
        deals: { today: 0, week: 0, total: dealsClosingTotal },
        won: { today: wonToday, week: wonWeek, month: wonMonth },
      },
      pipeline: {
        totalLeads: pipelineAgg._count,
        totalValue: pipelineAgg._sum.estimatedValue ?? 0,
        avgTicket: Math.round(pipelineAgg._avg?.estimatedValue ?? 0),
        closingDeals: closingAgg._count,
        closingValue: closingAgg._sum.estimatedValue ?? 0,
        weightedPipeline: funnel.reduce((s, f) => s + (f.value * f.probability), 0),
      },
      problems: {
        noContact, stuckDeals,
        overdueTasks: 0, // Not focusing on overdue per user request
        urgentTasks: 0,  // Not focusing on overdue per user request
        total: noContact + stuckDeals,
      },
      activity: {
        tasksCompletedToday,
        tasksTotal: newAssignments,
        completionRate: newAssignments > 0 ? Math.round((tasksCompletedToday / newAssignments) * 100) : 0,
        teamActivity: teamUsers.map(u => ({
          id: u.id, name: `${u.firstName} ${u.lastName}`, email: u.email,
          tasksCompleted: teamActivity.find(t => t.advisorId === u.id)?._count ?? 0,
        })).sort((a, b) => b.tasksCompleted - a.tasksCompleted),
      },
      funnel,
      expectedClosings: closingDeals.map(l => ({
        ...l,
        advisorName: l.assignedToId ? (advisorMap[l.assignedToId] ?? teamMap[l.assignedToId] ?? 'Sin asignar') : 'Sin asignar',
        probability: STAGE_PROBABILITY[l.status] ?? 0,
        weighted: (l.estimatedValue ?? 0) * (STAGE_PROBABILITY[l.status] ?? 0),
        stageLabel: STAGE_LABELS[l.status] ?? l.status,
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 2. URGENCY LAYER — Today's critical items only
  // ═══════════════════════════════════════════════════════════

  async getUrgencyToday() {
    const today = startOfDay();
    const teamUsers = await this.getTeamUsers();
    const teamIds = teamUsers.map(u => u.id);
    const teamMap = Object.fromEntries(teamUsers.map(u => [u.id, `${u.firstName} ${u.lastName}`]));

    const [
      criticalLeads,
      highValueDeals,
      noContactToday,
      nearClose,
    ] = await Promise.all([
      // Critical leads: high value, early stage, need first contact
      this.prisma.lead.findMany({
        where: {
          deletedAt: null, isHistorical: false,
          status: { in: ['PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR'] as any },
          estimatedValue: { gte: 100000 },
        },
        select: { id: true, companyName: true, contactName: true, contactPhone: true, status: true, estimatedValue: true, zone: true, assignedToId: true, createdAt: true, industry: true },
        orderBy: { estimatedValue: { sort: 'desc', nulls: 'last' } },
        take: 15,
      }),
      // High-value deals in closing needing attention today
      this.prisma.lead.findMany({
        where: {
          deletedAt: null, isHistorical: false,
          status: { in: CLOSING_STATUSES },
          estimatedValue: { gte: 200000 },
        },
        select: { id: true, companyName: true, contactName: true, contactPhone: true, status: true, estimatedValue: true, zone: true, assignedToId: true, lastContactedAt: true, updatedAt: true, industry: true },
        orderBy: { estimatedValue: { sort: 'desc', nulls: 'last' } },
        take: 10,
      }),
      // Active leads where assigned advisor has zero completed tasks today
      this.prisma.lead.findMany({
        where: {
          deletedAt: null, isHistorical: false,
          status: { in: ACTIVE_STATUSES },
          assignedToId: { in: teamIds },
          lastContactedAt: { lt: daysAgo(3) },
        },
        select: { id: true, companyName: true, status: true, estimatedValue: true, assignedToId: true, lastContactedAt: true, zone: true },
        orderBy: { estimatedValue: { sort: 'desc', nulls: 'last' } },
        take: 20,
      }),
      // Near close: ESPERANDO_CONTRATO or PENDIENTE_PAGO
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false, status: { in: NEAR_CLOSE_STATUSES } },
        select: { id: true, companyName: true, contactName: true, contactPhone: true, status: true, estimatedValue: true, zone: true, assignedToId: true, updatedAt: true, industry: true },
        orderBy: { estimatedValue: { sort: 'desc', nulls: 'last' } },
        take: 10,
      }),
    ]);

    return {
      criticalLeads: criticalLeads.map(l => ({
        ...l, advisorName: l.assignedToId ? teamMap[l.assignedToId] ?? 'Sin asignar' : 'Sin asignar',
        stageLabel: STAGE_LABELS[l.status] ?? l.status,
        action: 'Contactar hoy — primer contacto',
      })),
      highValueDeals: highValueDeals.map(l => ({
        ...l, advisorName: l.assignedToId ? teamMap[l.assignedToId] ?? 'Sin asignar' : 'Sin asignar',
        stageLabel: STAGE_LABELS[l.status] ?? l.status,
        daysSinceContact: l.lastContactedAt ? Math.round((Date.now() - l.lastContactedAt.getTime()) / 86400000) : 999,
        action: 'Dar seguimiento — deal de alto valor',
      })),
      noContactRecent: noContactToday.map(l => ({
        ...l, advisorName: l.assignedToId ? teamMap[l.assignedToId] ?? '' : '',
        stageLabel: STAGE_LABELS[l.status] ?? l.status,
        daysSinceContact: l.lastContactedAt ? Math.round((Date.now() - l.lastContactedAt.getTime()) / 86400000) : 999,
      })),
      nearClose: nearClose.map(l => ({
        ...l, advisorName: l.assignedToId ? teamMap[l.assignedToId] ?? 'Sin asignar' : 'Sin asignar',
        stageLabel: STAGE_LABELS[l.status] ?? l.status,
        action: l.status === 'PENDIENTE_PAGO' ? 'Confirmar pago' : 'Cerrar contrato',
      })),
      totals: {
        criticalLeads: criticalLeads.length,
        highValueDeals: highValueDeals.length,
        noContactRecent: noContactToday.length,
        nearClose: nearClose.length,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 3. CREATION + CONVERSION BREAKDOWNS
  // ═══════════════════════════════════════════════════════════

  async getCreationBreakdown() {
    const monthStart = startOfMonth();

    const [byZone, bySource, byStatus, byAdvisor] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['zone'], where: { deletedAt: null, isHistorical: false, createdAt: { gte: monthStart } },
        _count: true, _sum: { estimatedValue: true },
      }),
      this.prisma.lead.groupBy({
        by: ['source'], where: { deletedAt: null, isHistorical: false, createdAt: { gte: monthStart } },
        _count: true, _sum: { estimatedValue: true },
      }),
      this.prisma.lead.groupBy({
        by: ['status'], where: { deletedAt: null, isHistorical: false, createdAt: { gte: monthStart } },
        _count: true, _sum: { estimatedValue: true },
      }),
      this.prisma.lead.groupBy({
        by: ['assignedToId'],
        where: { deletedAt: null, isHistorical: false, createdAt: { gte: monthStart }, assignedToId: { not: null } },
        _count: true, _sum: { estimatedValue: true },
      }),
    ]);

    const advisorIds = byAdvisor.map(a => a.assignedToId).filter(Boolean) as string[];
    const users = advisorIds.length > 0
      ? await this.prisma.user.findMany({ where: { id: { in: advisorIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const userMap = Object.fromEntries(users.map(u => [u.id, `${u.firstName} ${u.lastName}`]));

    return {
      period: 'month',
      byZone: byZone.map(z => ({ zone: z.zone, count: z._count, value: z._sum.estimatedValue ?? 0 })).sort((a, b) => b.count - a.count),
      bySource: bySource.map(s => ({ source: s.source, count: s._count, value: s._sum.estimatedValue ?? 0 })).sort((a, b) => b.count - a.count),
      byStatus: byStatus.map(s => ({ status: s.status, label: STAGE_LABELS[s.status] ?? s.status, count: s._count, value: s._sum.estimatedValue ?? 0 })).sort((a, b) => b.count - a.count),
      byAdvisor: byAdvisor.map(a => ({
        advisorId: a.assignedToId, name: a.assignedToId ? userMap[a.assignedToId] ?? 'Desconocido' : 'Sin asignar',
        count: a._count, value: a._sum.estimatedValue ?? 0,
      })).sort((a, b) => b.count - a.count),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 4. DIRECTOR VIEW — Andres executive overview
  // ═══════════════════════════════════════════════════════════

  async getDirectorView() {
    const today = startOfDay();
    const monthStart = startOfMonth();
    const weekStart = startOfWeek();

    const [
      revenueMonth, revenueWeek,
      topDeals, urgentDeals,
      teamPerf,
      leadsCreatedToday, dealsCreatedToday,
      nearCloseDeals,
    ] = await Promise.all([
      this.prisma.lead.aggregate({
        where: { deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO' as any, convertedAt: { gte: monthStart } },
        _sum: { estimatedValue: true }, _count: true,
      }),
      this.prisma.lead.aggregate({
        where: { deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO' as any, convertedAt: { gte: weekStart } },
        _sum: { estimatedValue: true }, _count: true,
      }),
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false, status: { in: ACTIVE_STATUSES } },
        orderBy: { estimatedValue: { sort: 'desc', nulls: 'last' } },
        select: { id: true, companyName: true, contactName: true, status: true, estimatedValue: true, zone: true, assignedToId: true, lastContactedAt: true, updatedAt: true },
        take: 10,
      }),
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false, status: { in: CLOSING_STATUSES }, updatedAt: { lt: daysAgo(3) } },
        orderBy: { estimatedValue: { sort: 'desc', nulls: 'last' } },
        select: { id: true, companyName: true, status: true, estimatedValue: true, zone: true, assignedToId: true, updatedAt: true },
        take: 10,
      }),
      this.getTeamPerformance(),
      this.prisma.lead.count({ where: { deletedAt: null, isHistorical: false, createdAt: { gte: today } } }),
      this.prisma.lead.count({ where: { deletedAt: null, isHistorical: false, status: { in: CLOSING_STATUSES }, updatedAt: { gte: today } } }),
      // Deals near close (ESPERANDO_CONTRATO, PENDIENTE_PAGO)
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false, status: { in: NEAR_CLOSE_STATUSES } },
        select: { id: true, companyName: true, status: true, estimatedValue: true, assignedToId: true, updatedAt: true },
        orderBy: { estimatedValue: { sort: 'desc', nulls: 'last' } },
        take: 5,
      }),
    ]);

    const allIds = [...new Set([...topDeals, ...urgentDeals, ...nearCloseDeals].map(l => l.assignedToId).filter(Boolean))] as string[];
    const users = allIds.length > 0
      ? await this.prisma.user.findMany({ where: { id: { in: allIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const uMap = Object.fromEntries(users.map(u => [u.id, `${u.firstName} ${u.lastName}`]));

    // What Andres must do today
    const andresActions: string[] = [];
    if (nearCloseDeals.length > 0) {
      const totalNearClose = nearCloseDeals.reduce((s, d) => s + (d.estimatedValue ?? 0), 0);
      andresActions.push(`Revisar ${nearCloseDeals.length} deals cerca de cerrar (${fmt(totalNearClose)})`);
    }
    if (urgentDeals.length > 0) {
      andresActions.push(`Intervenir en ${urgentDeals.length} deals estancados`);
    }
    const bigDeal = topDeals.find(d => (d.estimatedValue ?? 0) > 500000);
    if (bigDeal) {
      andresActions.push(`Deal estrategico: ${bigDeal.companyName} (${fmt(bigDeal.estimatedValue ?? 0)}) — dar seguimiento personal`);
    }
    andresActions.push('Revisar actividad del equipo en Supervisor View');

    return {
      revenue: {
        month: { count: revenueMonth._count, amount: revenueMonth._sum.estimatedValue ?? 0 },
        week: { count: revenueWeek._count, amount: revenueWeek._sum.estimatedValue ?? 0 },
        target: 8_000_000,
        gap: 8_000_000 - (revenueMonth._sum.estimatedValue ?? 0),
      },
      todaySnapshot: { leadsCreated: leadsCreatedToday, dealsMovedToday: dealsCreatedToday },
      andresActions,
      topDeals: topDeals.map(d => ({ ...d, advisorName: d.assignedToId ? uMap[d.assignedToId] ?? '' : '', stageLabel: STAGE_LABELS[d.status] ?? d.status, probability: STAGE_PROBABILITY[d.status] ?? 0 })),
      urgentDeals: urgentDeals.map(d => ({ ...d, advisorName: d.assignedToId ? uMap[d.assignedToId] ?? '' : '', stageLabel: STAGE_LABELS[d.status] ?? d.status, daysSinceUpdate: Math.round((Date.now() - d.updatedAt.getTime()) / 86400000) })),
      nearCloseDeals: nearCloseDeals.map(d => ({ ...d, advisorName: d.assignedToId ? uMap[d.assignedToId] ?? '' : '', stageLabel: STAGE_LABELS[d.status] ?? d.status })),
      teamPerformance: teamPerf,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 5. SUPERVISOR VIEW — Neto's operational control
  // ═══════════════════════════════════════════════════════════

  async getSupervisorView() {
    const today = startOfDay();
    const weekStart = startOfWeek();
    const teamUsers = await this.getTeamUsers();

    const advisors = [];
    for (const u of teamUsers) {
      const [
        tasksToday, completedToday,
        callsToday, whatsappsToday, emailsToday,
        quotesToday, reactivationsToday,
        activeLeads, closingDealsCount,
        wonWeek, pipelineValue,
        lastTask,
      ] = await Promise.all([
        this.prisma.salesTask.count({ where: { advisorId: u.id, isHistorical: false, createdAt: { gte: today } } }),
        this.prisma.salesTask.count({ where: { advisorId: u.id, isHistorical: false, status: 'completed', completedAt: { gte: today } } }),
        this.prisma.salesTask.count({ where: { advisorId: u.id, isHistorical: false, type: 'call', status: 'completed', completedAt: { gte: today } } }),
        this.prisma.salesTask.count({ where: { advisorId: u.id, isHistorical: false, type: 'whatsapp', status: 'completed', completedAt: { gte: today } } }),
        this.prisma.salesTask.count({ where: { advisorId: u.id, isHistorical: false, type: 'email', status: 'completed', completedAt: { gte: today } } }),
        this.prisma.salesTask.count({ where: { advisorId: u.id, isHistorical: false, type: 'send_quote', status: 'completed', completedAt: { gte: today } } }),
        this.prisma.salesTask.count({ where: { advisorId: u.id, isHistorical: false, type: 'reactivation', status: 'completed', completedAt: { gte: today } } }),
        this.prisma.lead.count({ where: { assignedToId: u.id, deletedAt: null, isHistorical: false, status: { in: ACTIVE_STATUSES } } }),
        this.prisma.lead.count({ where: { assignedToId: u.id, deletedAt: null, isHistorical: false, status: { in: CLOSING_STATUSES } } }),
        this.prisma.lead.count({ where: { assignedToId: u.id, deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO' as any, convertedAt: { gte: weekStart } } }),
        this.prisma.lead.aggregate({ where: { assignedToId: u.id, deletedAt: null, isHistorical: false, status: { in: ACTIVE_STATUSES } }, _sum: { estimatedValue: true } }),
        this.prisma.salesTask.findFirst({ where: { advisorId: u.id, isHistorical: false, status: 'completed' }, orderBy: { completedAt: 'desc' }, select: { completedAt: true } }),
      ]);

      const contactAttempts = callsToday + whatsappsToday + emailsToday;
      const hoursInactive = lastTask?.completedAt ? (Date.now() - lastTask.completedAt.getTime()) / 3600000 : 999;

      // Daily targets (per advisor)
      const dailyTargets = { calls: 15, contacts: 20, quotes: 2, reactivations: 3 };

      advisors.push({
        id: u.id, name: `${u.firstName} ${u.lastName}`, email: u.email,
        // Activity today
        tasksAssigned: tasksToday, tasksCompleted: completedToday,
        callsToday, whatsappsToday, emailsToday, contactAttempts,
        quotesDelivered: quotesToday, reactivationsToday,
        dealsMoved: 0, // computed below if needed
        // Portfolio
        activeLeads, closingDeals: closingDealsCount, wonWeek,
        pipelineValue: pipelineValue._sum.estimatedValue ?? 0,
        // Status
        hoursInactive: Math.round(hoursInactive * 10) / 10,
        status: hoursInactive > 4 ? 'inactive' : hoursInactive > 2 ? 'warning' : 'active',
        completionRate: tasksToday > 0 ? Math.round((completedToday / tasksToday) * 100) : 0,
        // Plan progress
        planProgress: {
          callsVsTarget: `${callsToday}/${dailyTargets.calls}`,
          contactsVsTarget: `${contactAttempts}/${dailyTargets.contacts}`,
          quotesVsTarget: `${quotesToday}/${dailyTargets.quotes}`,
          reactivationsVsTarget: `${reactivationsToday}/${dailyTargets.reactivations}`,
          behindPlan: contactAttempts < (dailyTargets.contacts / 2) && new Date().getHours() >= 12,
          exceedingPlan: contactAttempts >= dailyTargets.contacts,
        },
      });
    }

    // Identify who needs help
    const behindPlan = advisors.filter(a => a.planProgress.behindPlan);
    const exceedingPlan = advisors.filter(a => a.planProgress.exceedingPlan);

    return {
      advisors: advisors.sort((a, b) => b.contactAttempts - a.contactAttempts),
      totals: {
        tasksAssigned: advisors.reduce((s, a) => s + a.tasksAssigned, 0),
        tasksCompleted: advisors.reduce((s, a) => s + a.tasksCompleted, 0),
        callsToday: advisors.reduce((s, a) => s + a.callsToday, 0),
        contactAttempts: advisors.reduce((s, a) => s + a.contactAttempts, 0),
        quotesDelivered: advisors.reduce((s, a) => s + a.quotesDelivered, 0),
        reactivations: advisors.reduce((s, a) => s + a.reactivationsToday, 0),
        activeLeads: advisors.reduce((s, a) => s + a.activeLeads, 0),
        closingDeals: advisors.reduce((s, a) => s + a.closingDeals, 0),
      },
      alerts: advisors.filter(a => a.status === 'inactive').map(a => `${a.name}: ${Math.round(a.hoursInactive)}h sin actividad`),
      behindPlan: behindPlan.map(a => a.name),
      exceedingPlan: exceedingPlan.map(a => a.name),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 6. ADVISOR PROFILE — Full per-advisor view
  // ═══════════════════════════════════════════════════════════

  async getAdvisorProfile(advisorId: string) {
    const today = startOfDay();
    const weekStart = startOfWeek();
    const monthStart = startOfMonth();

    const user = await this.prisma.user.findUnique({
      where: { id: advisorId },
      select: { id: true, firstName: true, lastName: true, email: true, role: true, phone: true },
    });
    if (!user) return null;

    const [
      // Leads
      activeLeads, closingDeals, wonMonth, wonWeek, lostMonth,
      // Pipeline
      pipelineAgg,
      // Tasks today
      tasksToday, completedToday,
      callsToday, whatsappsToday, emailsToday, followUpsToday, quotesToday, reactivationsToday,
      // Tasks this week
      completedWeek,
      // Pipeline by stage
      stageBreakdown,
      // Recent tasks
      recentTasks,
      // Top deals
      topDeals,
      // Assigned leads for workplan
      leadsToContact,
      leadsToFollowUp,
      dealsToPush,
    ] = await Promise.all([
      this.prisma.lead.count({ where: { assignedToId: advisorId, deletedAt: null, isHistorical: false, status: { in: ACTIVE_STATUSES } } }),
      this.prisma.lead.count({ where: { assignedToId: advisorId, deletedAt: null, isHistorical: false, status: { in: CLOSING_STATUSES } } }),
      this.prisma.lead.count({ where: { assignedToId: advisorId, deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO' as any, convertedAt: { gte: monthStart } } }),
      this.prisma.lead.count({ where: { assignedToId: advisorId, deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO' as any, convertedAt: { gte: weekStart } } }),
      this.prisma.lead.count({ where: { assignedToId: advisorId, deletedAt: null, isHistorical: false, status: 'CERRADO_PERDIDO' as any, updatedAt: { gte: monthStart } } }),
      this.prisma.lead.aggregate({ where: { assignedToId: advisorId, deletedAt: null, isHistorical: false, status: { in: ACTIVE_STATUSES } }, _sum: { estimatedValue: true }, _avg: { estimatedValue: true } }),
      this.prisma.salesTask.count({ where: { advisorId, isHistorical: false, createdAt: { gte: today } } }),
      this.prisma.salesTask.count({ where: { advisorId, isHistorical: false, status: 'completed', completedAt: { gte: today } } }),
      this.prisma.salesTask.count({ where: { advisorId, isHistorical: false, type: 'call', status: 'completed', completedAt: { gte: today } } }),
      this.prisma.salesTask.count({ where: { advisorId, isHistorical: false, type: 'whatsapp', status: 'completed', completedAt: { gte: today } } }),
      this.prisma.salesTask.count({ where: { advisorId, isHistorical: false, type: 'email', status: 'completed', completedAt: { gte: today } } }),
      this.prisma.salesTask.count({ where: { advisorId, isHistorical: false, type: 'follow_up', status: 'completed', completedAt: { gte: today } } }),
      this.prisma.salesTask.count({ where: { advisorId, isHistorical: false, type: 'send_quote', status: 'completed', completedAt: { gte: today } } }),
      this.prisma.salesTask.count({ where: { advisorId, isHistorical: false, type: 'reactivation', status: 'completed', completedAt: { gte: today } } }),
      this.prisma.salesTask.count({ where: { advisorId, isHistorical: false, status: 'completed', completedAt: { gte: weekStart } } }),
      this.prisma.lead.groupBy({
        by: ['status'],
        where: { assignedToId: advisorId, deletedAt: null, isHistorical: false, status: { in: ACTIVE_STATUSES } },
        _count: true, _sum: { estimatedValue: true },
      }),
      this.prisma.salesTask.findMany({
        where: { advisorId, isHistorical: false, completedAt: { gte: today } },
        orderBy: { completedAt: 'desc' },
        take: 10,
        select: { id: true, type: true, title: true, status: true, completedAt: true, outcome: true, pipelineMoved: true },
      }),
      this.prisma.lead.findMany({
        where: { assignedToId: advisorId, deletedAt: null, isHistorical: false, status: { in: CLOSING_STATUSES } },
        orderBy: { estimatedValue: { sort: 'desc', nulls: 'last' } },
        select: { id: true, companyName: true, status: true, estimatedValue: true, zone: true, lastContactedAt: true, industry: true },
        take: 10,
      }),
      // Leads to contact (early stages, no recent contact)
      this.prisma.lead.findMany({
        where: { assignedToId: advisorId, deletedAt: null, isHistorical: false, status: { in: ['PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR'] as any } },
        select: { id: true, companyName: true, contactName: true, contactPhone: true, status: true, estimatedValue: true, zone: true, industry: true, createdAt: true },
        orderBy: { estimatedValue: { sort: 'desc', nulls: 'last' } },
        take: 10,
      }),
      // Leads to follow up (active, last contact > 3 days)
      this.prisma.lead.findMany({
        where: { assignedToId: advisorId, deletedAt: null, isHistorical: false, status: { in: ACTIVE_STATUSES }, lastContactedAt: { lt: daysAgo(3) } },
        select: { id: true, companyName: true, contactName: true, contactPhone: true, status: true, estimatedValue: true, zone: true, lastContactedAt: true, industry: true },
        orderBy: { estimatedValue: { sort: 'desc', nulls: 'last' } },
        take: 10,
      }),
      // Deals to push (mid-to-late pipeline)
      this.prisma.lead.findMany({
        where: { assignedToId: advisorId, deletedAt: null, isHistorical: false, status: { in: CLOSING_STATUSES } },
        select: { id: true, companyName: true, contactName: true, contactPhone: true, status: true, estimatedValue: true, zone: true, lastContactedAt: true, updatedAt: true, industry: true },
        orderBy: { estimatedValue: { sort: 'desc', nulls: 'last' } },
        take: 10,
      }),
    ]);

    const contactAttempts = callsToday + whatsappsToday + emailsToday;

    // Weekly/monthly targets
    const weeklyTargets = { deals: 2, cotizaciones: 8, reactivations: 10, contacts: 100 };
    const monthlyTargets = { revenue: 1_500_000, deals: 8, pipeline: 5_000_000 };

    // Revenue this month
    const revenueMonth = await this.prisma.lead.aggregate({
      where: { assignedToId: advisorId, deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO' as any, convertedAt: { gte: monthStart } },
      _sum: { estimatedValue: true },
    });

    // Pipeline by stage
    const stageOrder = ['PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR', 'EN_PROSPECCION',
      'AGENDAR_CITA', 'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO'];
    const pipelineByStage = stageOrder.map(status => {
      const match = stageBreakdown.find(s => s.status === status);
      return { status, label: STAGE_LABELS[status], count: match?._count ?? 0, value: match?._sum?.estimatedValue ?? 0 };
    });

    return {
      advisor: user,
      // Today KPIs
      todayKpis: {
        tasksAssigned: tasksToday,
        tasksCompleted: completedToday,
        callsMade: callsToday,
        whatsappsSent: whatsappsToday,
        emailsSent: emailsToday,
        contactAttempts,
        followUpsCompleted: followUpsToday,
        quotesDelivered: quotesToday,
        reactivations: reactivationsToday,
      },
      // Portfolio
      portfolio: {
        activeLeads, closingDeals, wonMonth, wonWeek, lostMonth,
        pipelineValue: pipelineAgg._sum.estimatedValue ?? 0,
        avgTicket: Math.round(pipelineAgg._avg?.estimatedValue ?? 0),
        revenueMonth: revenueMonth._sum.estimatedValue ?? 0,
      },
      // Targets
      targets: {
        daily: { calls: 15, contacts: 20, quotes: 2, reactivations: 3 },
        weekly: weeklyTargets,
        monthly: monthlyTargets,
      },
      // Progress vs target
      progress: {
        revenueVsTarget: `${fmt(revenueMonth._sum.estimatedValue ?? 0)} / ${fmt(monthlyTargets.revenue)}`,
        dealsVsTarget: `${wonMonth} / ${monthlyTargets.deals}`,
        weeklyConversions: wonWeek,
        completionRate: tasksToday > 0 ? Math.round((completedToday / tasksToday) * 100) : 0,
      },
      // Pipeline detail
      pipelineByStage,
      // Top deals
      topDeals: topDeals.map(d => ({
        ...d, stageLabel: STAGE_LABELS[d.status] ?? d.status,
        probability: STAGE_PROBABILITY[d.status] ?? 0,
        daysSinceContact: d.lastContactedAt ? Math.round((Date.now() - d.lastContactedAt.getTime()) / 86400000) : 999,
      })),
      // Today's work plan
      workplan: {
        toContact: leadsToContact.map(l => ({ ...l, stageLabel: STAGE_LABELS[l.status] ?? l.status, action: 'Llamar / WhatsApp' })),
        toFollowUp: leadsToFollowUp.map(l => ({
          ...l, stageLabel: STAGE_LABELS[l.status] ?? l.status,
          daysSinceContact: l.lastContactedAt ? Math.round((Date.now() - l.lastContactedAt.getTime()) / 86400000) : 999,
          action: 'Dar seguimiento',
        })),
        toClose: dealsToPush.map(l => ({
          ...l, stageLabel: STAGE_LABELS[l.status] ?? l.status,
          daysSinceUpdate: l.updatedAt ? Math.round((Date.now() - l.updatedAt.getTime()) / 86400000) : 999,
          action: l.status === 'PENDIENTE_PAGO' ? 'Confirmar pago' : l.status === 'ESPERANDO_CONTRATO' ? 'Cerrar contrato' : 'Entregar cotizacion',
        })),
      },
      // Recent activity
      recentTasks: recentTasks.map(t => ({
        ...t, icon: TASK_ICONS[t.type] ?? '📋',
      })),
      // Discipline score (simple metric based on completion)
      disciplineScore: Math.min(100, Math.round(
        ((completedToday / Math.max(tasksToday, 1)) * 40) +
        ((contactAttempts / 20) * 30) +
        ((completedWeek / Math.max(completedWeek + 10, 1)) * 30)
      )),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 7. ADVISOR LIST — All advisors summary
  // ═══════════════════════════════════════════════════════════

  async getAdvisors() {
    const teamUsers = await this.getTeamUsers();
    return teamUsers.map(u => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`,
      email: u.email,
    }));
  }

  // ═══════════════════════════════════════════════════════════
  // 8. AGENT GUIDANCE — Per-advisor actionable recommendations
  // ═══════════════════════════════════════════════════════════

  async getAgentGuidance() {
    const today = startOfDay();
    const teamUsers = await this.getTeamUsers();
    const teamMap = Object.fromEntries(teamUsers.map(u => [u.id, u.firstName]));

    const guidance: Array<{
      agent: string; icon: string; recommendations: Array<{ advisor: string; advisorId: string; action: string; priority: string; context?: string }>;
    }> = [];

    // Gather data for all advisors
    const advisorData: Array<{
      id: string; name: string;
      closingDeals: number; activeLeads: number; callsToday: number;
      noContactLeads: number; reactivationOpps: number; highValueDeals: number;
    }> = [];

    for (const u of teamUsers) {
      const [closing, active, calls, noContact, reactivations, highValue] = await Promise.all([
        this.prisma.lead.count({ where: { assignedToId: u.id, deletedAt: null, isHistorical: false, status: { in: CLOSING_STATUSES } } }),
        this.prisma.lead.count({ where: { assignedToId: u.id, deletedAt: null, isHistorical: false, status: { in: ACTIVE_STATUSES } } }),
        this.prisma.salesTask.count({ where: { advisorId: u.id, isHistorical: false, type: 'call', status: 'completed', completedAt: { gte: today } } }),
        this.prisma.lead.count({
          where: { assignedToId: u.id, deletedAt: null, isHistorical: false, status: { in: ACTIVE_STATUSES },
            OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: daysAgo(5) } }] },
        }),
        this.prisma.lead.count({
          where: { assignedToId: u.id, deletedAt: null, isHistorical: false, status: { in: ['CONTACTAR_FUTURO'] as any } },
        }),
        this.prisma.lead.count({
          where: { assignedToId: u.id, deletedAt: null, isHistorical: false, status: { in: CLOSING_STATUSES }, estimatedValue: { gte: 200000 } },
        }),
      ]);

      advisorData.push({
        id: u.id, name: u.firstName,
        closingDeals: closing, activeLeads: active, callsToday: calls,
        noContactLeads: noContact, reactivationOpps: reactivations, highValueDeals: highValue,
      });
    }

    // Director Agent — strategic per-advisor guidance
    const directorRecs = advisorData
      .filter(a => a.highValueDeals > 0)
      .map(a => ({
        advisor: a.name, advisorId: a.id,
        action: `${a.highValueDeals} deals de alto valor en cierre — necesitan atencion personal`,
        priority: 'high',
      }));
    guidance.push({
      agent: 'Director Agent', icon: '🎯',
      recommendations: directorRecs.length > 0 ? directorRecs : [{ advisor: 'Equipo', advisorId: '', action: 'Pipeline saludable, mantener ritmo', priority: 'medium' }],
    });

    // Next Action Agent — what each person should do NOW
    const nextActionRecs = advisorData.map(a => {
      if (a.closingDeals > 0 && a.callsToday === 0) {
        return { advisor: a.name, advisorId: a.id, action: `Llamar a ${a.closingDeals} deals en cierre — prioridad inmediata`, priority: 'critical' };
      }
      if (a.noContactLeads > 5) {
        return { advisor: a.name, advisorId: a.id, action: `Contactar ${a.noContactLeads} leads sin actividad reciente`, priority: 'high' };
      }
      return { advisor: a.name, advisorId: a.id, action: `Continuar con plan del dia — ${a.activeLeads} leads activos`, priority: 'medium' };
    });
    guidance.push({ agent: 'Next Action Agent', icon: '🚀', recommendations: nextActionRecs });

    // Reminder Agent
    const reminderRecs = advisorData
      .filter(a => a.callsToday === 0 && new Date().getHours() >= 10)
      .map(a => ({
        advisor: a.name, advisorId: a.id,
        action: 'Sin llamadas hoy — iniciar contactos ahora',
        priority: 'high',
      }));
    guidance.push({
      agent: 'Reminder Agent', icon: '⏰',
      recommendations: reminderRecs.length > 0 ? reminderRecs : [{ advisor: 'Equipo', advisorId: '', action: 'Actividad en curso — sin alertas', priority: 'low' }],
    });

    // Closing Agent — deals to push
    const closingRecs = advisorData
      .filter(a => a.closingDeals > 0)
      .map(a => ({
        advisor: a.name, advisorId: a.id,
        action: `Push ${a.closingDeals} deals en etapa de cierre`,
        priority: a.closingDeals > 3 ? 'critical' : 'high',
      }));
    guidance.push({ agent: 'Closing Agent', icon: '💰', recommendations: closingRecs });

    // Reactivation Agent
    const reactivationRecs = advisorData
      .filter(a => a.reactivationOpps > 0)
      .map(a => ({
        advisor: a.name, advisorId: a.id,
        action: `${a.reactivationOpps} oportunidades de reactivacion disponibles`,
        priority: 'medium',
      }));
    guidance.push({ agent: 'Reactivation Agent', icon: '♻️', recommendations: reactivationRecs.length > 0 ? reactivationRecs : [{ advisor: 'Equipo', advisorId: '', action: 'Sin reactivaciones pendientes', priority: 'low' }] });

    // Supervisor Agent — team health
    const inactiveAdvisors = advisorData.filter(a => a.callsToday === 0 && a.activeLeads > 10);
    const supervisorRecs = inactiveAdvisors.map(a => ({
      advisor: a.name, advisorId: a.id,
      action: `${a.activeLeads} leads asignados pero sin actividad hoy — verificar`,
      priority: 'high',
    }));
    guidance.push({
      agent: 'Supervisor Agent', icon: '👁️',
      recommendations: supervisorRecs.length > 0 ? supervisorRecs : [{ advisor: 'Equipo', advisorId: '', action: 'Equipo activo — sin alertas de inactividad', priority: 'low' }],
    });

    // Revenue Agent
    const monthRevenue = await this.prisma.lead.aggregate({
      where: { deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO' as any, convertedAt: { gte: startOfMonth() } },
      _sum: { estimatedValue: true },
    });
    const gap = 8_000_000 - (monthRevenue._sum.estimatedValue ?? 0);
    guidance.push({
      agent: 'Revenue Agent', icon: '💎',
      recommendations: [{
        advisor: 'Equipo', advisorId: '',
        action: gap > 0 ? `Faltan ${fmt(gap)} para meta mensual — enfocar esfuerzos en deals de cierre` : 'Meta mensual alcanzada!',
        priority: gap > 4_000_000 ? 'critical' : gap > 0 ? 'high' : 'low',
      }],
    });

    // Customer Success Agent
    guidance.push({
      agent: 'Customer Success Agent', icon: '💚',
      recommendations: [{ advisor: 'Equipo', advisorId: '', action: 'Monitoreando satisfaccion de clientes activos', priority: 'low' }],
    });

    return { agents: guidance };
  }

  // ═══════════════════════════════════════════════════════════
  // 9. LIVE ACTIVITY FEED
  // ═══════════════════════════════════════════════════════════

  async getLiveFeed(limit = 50) {
    const since = daysAgo(2);

    const [recentTasks, recentLeads, recentAlerts] = await Promise.all([
      this.prisma.salesTask.findMany({
        where: { isHistorical: false, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, type: true, title: true, status: true, advisorId: true, leadId: true, createdAt: true, completedAt: true, outcome: true, pipelineMoved: true, newStage: true, previousStage: true },
      }),
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, companyName: true, status: true, zone: true, estimatedValue: true, source: true, createdAt: true, assignedToId: true },
      }),
      this.prisma.salesAlert.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, type: true, severity: true, message: true, title: true, status: true, createdAt: true, advisorId: true },
      }),
    ]);

    const allAdvisorIds = [...new Set([
      ...recentTasks.map(t => t.advisorId),
      ...recentLeads.map(l => l.assignedToId),
      ...recentAlerts.map(a => a.advisorId),
    ].filter(Boolean))] as string[];
    const users = allAdvisorIds.length > 0
      ? await this.prisma.user.findMany({ where: { id: { in: allAdvisorIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const uMap = Object.fromEntries(users.map(u => [u.id, `${u.firstName} ${u.lastName}`]));

    const feed: Array<{
      id: string; type: string; icon: string; message: string;
      detail?: string; severity?: string; advisor?: string; timestamp: Date;
    }> = [];

    for (const t of recentTasks) {
      const who = uMap[t.advisorId] ?? 'Sistema';
      const icon = TASK_ICONS[t.type] ?? '📋';

      if (t.status === 'completed') {
        feed.push({
          id: `task-${t.id}`, type: `task_${t.type}`, icon,
          message: `${who}: ${t.title}`,
          detail: t.outcome ? `Resultado: ${t.outcome}` : undefined,
          advisor: who,
          timestamp: t.completedAt ?? t.createdAt,
        });
      }
      if (t.pipelineMoved && t.newStage) {
        feed.push({
          id: `move-${t.id}`, type: 'deal_moved', icon: '📈',
          message: `${who} movio deal: ${STAGE_LABELS[t.previousStage ?? ''] ?? ''} → ${STAGE_LABELS[t.newStage] ?? t.newStage}`,
          detail: t.title,
          advisor: who,
          timestamp: t.completedAt ?? t.createdAt,
        });
      }
    }

    for (const l of recentLeads) {
      const who = l.assignedToId ? uMap[l.assignedToId] ?? '' : '';
      feed.push({
        id: `lead-${l.id}`, type: 'lead_created', icon: '🆕',
        message: `Nuevo lead: ${l.companyName}`,
        detail: [l.zone, l.source, l.estimatedValue ? fmt(l.estimatedValue) : ''].filter(Boolean).join(' · '),
        advisor: who,
        timestamp: l.createdAt,
      });
    }

    for (const a of recentAlerts) {
      const who = a.advisorId ? uMap[a.advisorId] ?? '' : '';
      feed.push({
        id: `alert-${a.id}`, type: 'alert', icon: '🚨',
        message: a.title ?? a.message ?? `Alerta: ${a.type}`,
        detail: a.message ?? undefined,
        severity: a.severity,
        advisor: who,
        timestamp: a.createdAt,
      });
    }

    feed.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return { feed: feed.slice(0, limit), total: feed.length };
  }

  // ═══════════════════════════════════════════════════════════
  // 10. AI EXECUTIVE BRIEFING — Today-focused
  // ═══════════════════════════════════════════════════════════

  async getBriefing() {
    const dashboard = await this.getDashboard();
    const insights: string[] = [];

    const { todaySummary, teamActivityToday, pipeline, problems, activity, funnel } = dashboard;

    // Today's activity
    if (teamActivityToday.totalTasksCompleted > 0) {
      insights.push(`Hoy: ${teamActivityToday.totalTasksCompleted} tareas completadas, ${teamActivityToday.callsMade} llamadas, ${teamActivityToday.contactAttempts} intentos de contacto.`);
    } else if (new Date().getHours() >= 10) {
      insights.push(`ATENCION: El equipo no ha registrado actividad hoy. Verificar inmediatamente.`);
    }

    // New leads
    if (todaySummary.leadsCreated > 0) {
      insights.push(`${todaySummary.leadsCreated} leads creados hoy (${fmt(todaySummary.totalAmountCreated)}).`);
    }

    // Won deals
    if (todaySummary.wonToday > 0) {
      insights.push(`${todaySummary.wonToday} deal(s) cerrado(s) hoy. Excelente!`);
    }

    // Pipeline health
    if (pipeline.closingValue > 0) {
      insights.push(`${pipeline.closingDeals} deals en cierre por ${fmt(pipeline.closingValue)}. Pipeline ponderado: ${fmt(pipeline.weightedPipeline)}.`);
    }

    // Problems — focused on today, not backlog
    if (problems.noContact > 50) {
      insights.push(`${problems.noContact} leads sin contacto en 7+ dias. Priorizar contactos hoy.`);
    }

    if (problems.stuckDeals > 0) {
      insights.push(`${problems.stuckDeals} deals estancados. Revisar con asesores.`);
    }

    // Bottleneck
    const maxStage = funnel.reduce((max, f) => f.count > max.count ? f : max, funnel[0]);
    if (maxStage && maxStage.count > 50) {
      insights.push(`Cuello de botella en ${maxStage.label}: ${maxStage.count} leads (${fmt(maxStage.value)}).`);
    }

    // Top performer
    const topPerformer = activity.teamActivity[0];
    if (topPerformer && topPerformer.tasksCompleted > 0) {
      insights.push(`Mejor rendimiento: ${topPerformer.name} (${topPerformer.tasksCompleted} tareas).`);
    }

    // Inactive
    const inactive = activity.teamActivity.filter(a => a.tasksCompleted === 0);
    if (inactive.length > 0 && new Date().getHours() >= 10) {
      insights.push(`${inactive.length} asesor(es) sin actividad: ${inactive.map(a => a.name.split(' ')[0]).join(', ')}.`);
    }

    // Revenue gap
    const monthRevenue = await this.prisma.lead.aggregate({
      where: { deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO' as any, convertedAt: { gte: startOfMonth() } },
      _sum: { estimatedValue: true },
    });
    const gap = 8_000_000 - (monthRevenue._sum.estimatedValue ?? 0);
    if (gap > 0) {
      insights.push(`Faltan ${fmt(gap)} para meta mensual de $8M.`);
    }

    return {
      date: new Date().toISOString().split('T')[0],
      summary: `Hoy: ${todaySummary.leadsCreated} leads, ${teamActivityToday.contactAttempts} contactos, ${teamActivityToday.callsMade} llamadas. Pipeline: ${pipeline.totalLeads} leads por ${fmt(pipeline.totalValue)}.`,
      insights,
      priority: problems.total > 10 ? 'high' : problems.total > 5 ? 'medium' : 'low',
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 11. AI AGENTS STATUS (backward compat)
  // ═══════════════════════════════════════════════════════════

  async getAgentsStatus() {
    const briefing = await this.getBriefing();
    return {
      agents: [
        { name: 'Director Agent', icon: '🎯', status: 'active', description: 'Analisis ejecutivo y recomendaciones', lastRun: new Date().toISOString(), output: briefing.summary, insights: briefing.insights.slice(0, 3) },
        { name: 'Next Action Agent', icon: '🚀', status: 'active', description: 'Prioriza siguiente accion por asesor', lastRun: new Date().toISOString(), output: 'Prioridades asignadas', insights: ['Revisa Agent Guidance para detalles por asesor'] },
        { name: 'Reminder Agent', icon: '⏰', status: 'active', description: 'Recordatorios automaticos (10, 12, 14, 16)', lastRun: new Date().toISOString(), output: 'Monitoreando actividad', insights: [] },
        { name: 'Closing Agent', icon: '💰', status: 'active', description: 'Motor de cierre de deals', lastRun: new Date().toISOString(), output: 'Monitoreando deals en cierre', insights: [] },
        { name: 'Supervisor Agent', icon: '👁️', status: 'active', description: 'Deteccion de inactividad y riesgos', lastRun: new Date().toISOString(), output: 'Monitoreando equipo', insights: briefing.insights.filter(i => i.includes('asesor') || i.includes('equipo')).slice(0, 2) },
        { name: 'Revenue Agent', icon: '💎', status: 'active', description: 'Forecast y gap analysis', lastRun: new Date().toISOString(), output: briefing.insights.find(i => i.includes('meta')) ?? 'Monitoreando revenue', insights: [] },
        { name: 'Customer Success Agent', icon: '💚', status: 'active', description: 'Post-venta y retention', lastRun: new Date().toISOString(), output: 'Monitoreando clientes', insights: [] },
        { name: 'Performance Agent', icon: '📊', status: 'active', description: 'Evaluacion de rendimiento', lastRun: new Date().toISOString(), output: 'Evaluando disciplina', insights: briefing.insights.filter(i => i.includes('rendimiento') || i.includes('Mejor')).slice(0, 2) },
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════
  // HELPER: Team performance
  // ═══════════════════════════════════════════════════════════

  private async getTeamPerformance() {
    const monthStart = startOfMonth();
    const teamUsers = await this.getTeamUsers();

    const perf = [];
    for (const u of teamUsers) {
      const [active, closed, pipeline, revenue] = await Promise.all([
        this.prisma.lead.count({ where: { assignedToId: u.id, deletedAt: null, isHistorical: false, status: { in: ACTIVE_STATUSES } } }),
        this.prisma.lead.count({ where: { assignedToId: u.id, deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO' as any, convertedAt: { gte: monthStart } } }),
        this.prisma.lead.aggregate({ where: { assignedToId: u.id, deletedAt: null, isHistorical: false, status: { in: ACTIVE_STATUSES } }, _sum: { estimatedValue: true } }),
        this.prisma.lead.aggregate({ where: { assignedToId: u.id, deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO' as any, convertedAt: { gte: monthStart } }, _sum: { estimatedValue: true } }),
      ]);
      perf.push({
        id: u.id, name: `${u.firstName} ${u.lastName}`,
        activeLeads: active, closedMonth: closed,
        pipelineValue: pipeline._sum.estimatedValue ?? 0,
        revenueMonth: revenue._sum.estimatedValue ?? 0,
      });
    }
    return perf.sort((a, b) => b.closedMonth - a.closedMonth);
  }
}
