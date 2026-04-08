import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PriorityEngineService } from '../priority-engine/priority-engine.service';

/** Terminal statuses — excluded from work plans */
const TERMINAL_STATUSES = ['CERRADO_GANADO', 'CERRADO_PERDIDO', 'LEAD_BASURA', 'CONTACTAR_FUTURO'];

/** Pipeline statuses where deals can be "pushed" forward */
const PUSHABLE_STATUSES = [
  'AGENDAR_CITA',
  'ESPERANDO_COTIZACION',
  'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO',
  'PENDIENTE_PAGO',
];

/** Stage order for funnel progression */
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
};

@Injectable()
export class WorkPlanService {
  constructor(
    private prisma: PrismaService,
    private priorityEngine: PriorityEngineService,
  ) {}

  // ──────────────────────────────────────────────────────
  // Advisor list
  // ──────────────────────────────────────────────────────

  /** All advisors (users with assigned leads) */
  async getAdvisors() {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        _count: { select: { assignedLeads: { where: { deletedAt: null, isHistorical: false } } } },
      },
    });

    // Only return users who have at least one lead or are in OPERATOR/SUPERADMIN role
    return users
      .filter((u) => u._count.assignedLeads > 0)
      .map((u) => ({
        id: u.id,
        name: `${u.firstName} ${u.lastName}`,
        email: u.email,
        totalLeads: u._count.assignedLeads,
      }));
  }

  // ──────────────────────────────────────────────────────
  // Daily Work Plan for a single advisor
  // ──────────────────────────────────────────────────────

  async getDailyPlan(advisorId: string | null) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const advisorFilter = advisorId ? { assignedToId: advisorId } : {};
    const visitAdvisorFilter = advisorId ? { visitedById: advisorId } : {};

    // Run all queries in parallel
    const [
      leadsToContact,
      followUpsDue,
      dealsToPush,
      reactivations,
      highPriority,
      todayVisits,
      advisorLeadsSummary,
    ] = await Promise.all([
      // 1. Leads to contact today — new leads never contacted + early stage
      this.prisma.lead.findMany({
        where: {
          ...advisorFilter,
          deletedAt: null,
          isHistorical: false,
          status: { in: ['PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR'] as any },
        },
        select: this.leadSelect(),
        orderBy: [{ estimatedValue: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
      }),

      // 2. Follow-ups pending — from visits with followUpDate <= today
      this.prisma.visit.findMany({
        where: {
          ...visitAdvisorFilter,
          followUpDate: { lte: tomorrow },
          lead: {
            deletedAt: null,
            isHistorical: false,
            status: { notIn: TERMINAL_STATUSES as any },
          },
        },
        select: {
          id: true,
          followUpDate: true,
          followUpNotes: true,
          outcome: true,
          visitDate: true,
          lead: {
            select: this.leadSelectInner(),
          },
          visitedBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { followUpDate: 'asc' },
      }),

      // 3. Deals to push — mid-to-late pipeline that need action
      this.prisma.lead.findMany({
        where: {
          ...advisorFilter,
          deletedAt: null,
          isHistorical: false,
          status: { in: PUSHABLE_STATUSES as any },
        },
        select: this.leadSelect(),
        orderBy: [{ estimatedValue: { sort: 'desc', nulls: 'last' } }],
      }),

      // 4. Reactivations — leads inactive 14+ days that are not terminal
      this.prisma.lead.findMany({
        where: {
          ...advisorFilter,
          deletedAt: null,
          isHistorical: false,
          status: { notIn: TERMINAL_STATUSES as any },
          OR: [
            { lastContactedAt: null },
            { lastContactedAt: { lt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } },
          ],
        },
        select: this.leadSelect(),
        orderBy: [{ estimatedValue: { sort: 'desc', nulls: 'last' } }],
      }),

      // 5. High priority — scored opportunities
      this.prisma.lead.findMany({
        where: {
          ...advisorFilter,
          deletedAt: null,
          isHistorical: false,
          status: { notIn: TERMINAL_STATUSES as any },
        },
        select: this.leadSelect(),
      }),

      // 6. Today's scheduled visits/routes
      this.prisma.visit.findMany({
        where: {
          ...visitAdvisorFilter,
          visitDate: { gte: today, lt: tomorrow },
        },
        select: {
          id: true,
          visitDate: true,
          outcome: true,
          notes: true,
          lead: { select: this.leadSelectInner() },
        },
        orderBy: { visitDate: 'asc' },
      }),

      // 7. Summary — lead counts by status for this advisor
      this.prisma.lead.groupBy({
        by: ['status'],
        where: {
          ...advisorFilter,
          deletedAt: null,
          isHistorical: false,
        },
        _count: true,
        _sum: { estimatedValue: true },
      }),
    ]);

    // Score high priority leads via Priority Engine
    const scored = this.priorityEngine.scoreLeads(highPriority);

    // Classify follow-ups
    const overdue = followUpsDue.filter(
      (f) => f.followUpDate && new Date(f.followUpDate) < today,
    );
    const dueToday = followUpsDue.filter(
      (f) => f.followUpDate && new Date(f.followUpDate) >= today && new Date(f.followUpDate) < tomorrow,
    );

    // Build pipeline summary
    const pipelineSummary = advisorLeadsSummary.map((g) => ({
      status: g.status,
      count: g._count,
      value: g._sum.estimatedValue || 0,
    }));

    // Critical tasks — combine overdue + high-value inactive + near-close deals
    const criticalTasks = this.buildCriticalTasks(overdue, scored, dealsToPush);

    // Score other lead lists too
    const scoredToContact = this.priorityEngine.scoreLeads(leadsToContact);
    const scoredDeals = this.priorityEngine.scoreLeads(dealsToPush);
    const scoredReactivations = this.priorityEngine.scoreLeads(reactivations);

    return {
      leadsToContact: scoredToContact.map((l) => ({
        ...l,
        leadAge: this.priorityEngine.daysSince(l.createdAt),
        stageOrder: STAGE_ORDER[l.status as string] || 0,
      })),
      followUps: {
        overdue: overdue.map((f) => ({
          ...f,
          daysOverdue: this.priorityEngine.daysSince(f.followUpDate),
        })),
        dueToday,
        total: followUpsDue.length,
      },
      dealsToPush: scoredDeals.map((l) => ({
        ...l,
        stageOrder: STAGE_ORDER[l.status as string] || 0,
      })),
      reactivations: scoredReactivations,
      highPriority: scored.slice(0, 10),
      todayVisits,
      criticalTasks,
      pipelineSummary,
      stats: {
        totalActive: highPriority.length,
        toContact: leadsToContact.length,
        pendingFollowUps: followUpsDue.length,
        overdueFollowUps: overdue.length,
        dealsPushing: dealsToPush.length,
        needsReactivation: reactivations.length,
        scheduledToday: todayVisits.length,
      },
    };
  }

  // ──────────────────────────────────────────────────────
  // Weekly Plan
  // ──────────────────────────────────────────────────────

  async getWeeklyPlan(advisorId: string | null) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Monday of current week
    const dayOfWeek = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 7);

    const advisorFilter = advisorId ? { assignedToId: advisorId } : {};
    const visitAdvisorFilter = advisorId ? { visitedById: advisorId } : {};

    const [
      weekVisits,
      weekFollowUps,
      activeLeads,
      wonThisWeek,
      lostThisWeek,
      newThisWeek,
    ] = await Promise.all([
      // Visits this week
      this.prisma.visit.findMany({
        where: {
          ...visitAdvisorFilter,
          visitDate: { gte: monday, lt: sunday },
        },
        select: {
          id: true,
          visitDate: true,
          outcome: true,
          lead: { select: this.leadSelectInner() },
          visitedBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { visitDate: 'asc' },
      }),

      // Follow-ups this week
      this.prisma.visit.findMany({
        where: {
          ...visitAdvisorFilter,
          followUpDate: { gte: monday, lt: sunday },
          lead: { deletedAt: null, isHistorical: false, status: { notIn: TERMINAL_STATUSES as any } },
        },
        select: {
          id: true,
          followUpDate: true,
          followUpNotes: true,
          lead: { select: this.leadSelectInner() },
        },
        orderBy: { followUpDate: 'asc' },
      }),

      // Active pipeline
      this.prisma.lead.findMany({
        where: {
          ...advisorFilter,
          deletedAt: null,
          isHistorical: false,
          status: { notIn: TERMINAL_STATUSES as any },
        },
        select: this.leadSelect(),
        orderBy: [{ estimatedValue: { sort: 'desc', nulls: 'last' } }],
      }),

      // Won this week
      this.prisma.lead.count({
        where: {
          ...advisorFilter,
          deletedAt: null,
          isHistorical: false,
          status: 'CERRADO_GANADO' as any,
          convertedAt: { gte: monday, lt: sunday },
        },
      }),

      // Lost this week
      this.prisma.lead.count({
        where: {
          ...advisorFilter,
          deletedAt: null,
          isHistorical: false,
          status: 'CERRADO_PERDIDO' as any,
          updatedAt: { gte: monday, lt: sunday },
        },
      }),

      // New leads this week
      this.prisma.lead.count({
        where: {
          ...advisorFilter,
          deletedAt: null,
          isHistorical: false,
          createdAt: { gte: monday, lt: sunday },
        },
      }),
    ]);

    // Group visits by day of week
    const dayNames = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];
    const dailyBreakdown = Array.from({ length: 7 }, (_, i) => {
      const dayStart = new Date(monday);
      dayStart.setDate(monday.getDate() + i);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayStart.getDate() + 1);

      const dayVisits = weekVisits.filter((v) => {
        const d = new Date(v.visitDate);
        return d >= dayStart && d < dayEnd;
      });

      const dayFollowUps = weekFollowUps.filter((f) => {
        const d = new Date(f.followUpDate!);
        return d >= dayStart && d < dayEnd;
      });

      return {
        day: dayNames[i],
        date: dayStart.toISOString().split('T')[0],
        isPast: dayStart < today,
        isToday: dayStart.getTime() === today.getTime(),
        visits: dayVisits.length,
        followUps: dayFollowUps.length,
        visitDetails: dayVisits,
        followUpDetails: dayFollowUps,
      };
    });

    // Pipeline value
    const pipelineValue = activeLeads.reduce(
      (sum, l) => sum + (l.estimatedValue || 0),
      0,
    );

    // Deals by stage
    const byStage: Record<string, { count: number; value: number }> = {};
    activeLeads.forEach((l) => {
      const s = l.status as string;
      if (!byStage[s]) byStage[s] = { count: 0, value: 0 };
      byStage[s].count++;
      byStage[s].value += l.estimatedValue || 0;
    });

    return {
      weekOf: monday.toISOString().split('T')[0],
      dailyBreakdown,
      stats: {
        totalVisits: weekVisits.length,
        totalFollowUps: weekFollowUps.length,
        activeLeads: activeLeads.length,
        pipelineValue,
        wonThisWeek,
        lostThisWeek,
        newThisWeek,
      },
      byStage: Object.entries(byStage)
        .map(([status, data]) => ({
          status,
          ...data,
          order: STAGE_ORDER[status] || 0,
        }))
        .sort((a, b) => a.order - b.order),
      topDeals: this.priorityEngine.scoreLeads(activeLeads).slice(0, 5),
    };
  }

  // ──────────────────────────────────────────────────────
  // Monthly Summary
  // ──────────────────────────────────────────────────────

  async getMonthlySummary(advisorId: string | null) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Previous month for comparison
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);

    const advisorFilter = advisorId ? { assignedToId: advisorId } : {};
    const visitAdvisorFilter = advisorId ? { visitedById: advisorId } : {};

    const [
      visitsThisMonth,
      visitsPrevMonth,
      wonThisMonth,
      wonPrevMonth,
      lostThisMonth,
      newThisMonth,
      newPrevMonth,
      activeLeads,
      wonDeals,
    ] = await Promise.all([
      this.prisma.visit.count({
        where: { ...visitAdvisorFilter, visitDate: { gte: monthStart, lt: monthEnd } },
      }),
      this.prisma.visit.count({
        where: { ...visitAdvisorFilter, visitDate: { gte: prevMonthStart, lt: prevMonthEnd } },
      }),
      this.prisma.lead.findMany({
        where: {
          ...advisorFilter,
          deletedAt: null,
          isHistorical: false,
          status: 'CERRADO_GANADO' as any,
          convertedAt: { gte: monthStart, lt: monthEnd },
        },
        select: { id: true, companyName: true, estimatedValue: true, convertedAt: true, zone: true },
      }),
      this.prisma.lead.findMany({
        where: {
          ...advisorFilter,
          deletedAt: null,
          isHistorical: false,
          status: 'CERRADO_GANADO' as any,
          convertedAt: { gte: prevMonthStart, lt: prevMonthEnd },
        },
        select: { id: true, estimatedValue: true },
      }),
      this.prisma.lead.count({
        where: {
          ...advisorFilter,
          deletedAt: null,
          isHistorical: false,
          status: 'CERRADO_PERDIDO' as any,
          updatedAt: { gte: monthStart, lt: monthEnd },
        },
      }),
      this.prisma.lead.count({
        where: { ...advisorFilter, deletedAt: null, isHistorical: false, createdAt: { gte: monthStart, lt: monthEnd } },
      }),
      this.prisma.lead.count({
        where: { ...advisorFilter, deletedAt: null, isHistorical: false, createdAt: { gte: prevMonthStart, lt: prevMonthEnd } },
      }),
      this.prisma.lead.findMany({
        where: {
          ...advisorFilter,
          deletedAt: null,
          isHistorical: false,
          status: { notIn: TERMINAL_STATUSES as any },
        },
        select: { id: true, status: true, estimatedValue: true, zone: true },
      }),
      this.prisma.lead.findMany({
        where: {
          ...advisorFilter,
          deletedAt: null,
          isHistorical: false,
          status: 'CERRADO_GANADO' as any,
        },
        select: { id: true, estimatedValue: true },
      }),
    ]);

    const revenueThisMonth = wonThisMonth.reduce((s, l) => s + (l.estimatedValue || 0), 0);
    const revenuePrevMonth = wonPrevMonth.reduce((s, l) => s + (l.estimatedValue || 0), 0);
    const pipelineValue = activeLeads.reduce((s, l) => s + (l.estimatedValue || 0), 0);
    const totalWonAll = wonDeals.reduce((s, l) => s + (l.estimatedValue || 0), 0);

    // Pipeline by zone
    const byZone: Record<string, { count: number; value: number }> = {};
    activeLeads.forEach((l) => {
      const z = l.zone as string;
      if (!byZone[z]) byZone[z] = { count: 0, value: 0 };
      byZone[z].count++;
      byZone[z].value += l.estimatedValue || 0;
    });

    // Pipeline by stage
    const byStage: Record<string, { count: number; value: number }> = {};
    activeLeads.forEach((l) => {
      const s = l.status as string;
      if (!byStage[s]) byStage[s] = { count: 0, value: 0 };
      byStage[s].count++;
      byStage[s].value += l.estimatedValue || 0;
    });

    // Days elapsed and remaining in month
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysElapsed = now.getDate();
    const daysRemaining = daysInMonth - daysElapsed;

    return {
      month: monthStart.toISOString().split('T')[0],
      daysElapsed,
      daysRemaining,
      current: {
        visits: visitsThisMonth,
        won: wonThisMonth.length,
        lost: lostThisMonth,
        newLeads: newThisMonth,
        revenue: revenueThisMonth,
        pipelineValue,
        activeLeads: activeLeads.length,
      },
      previous: {
        visits: visitsPrevMonth,
        won: wonPrevMonth.length,
        newLeads: newPrevMonth,
        revenue: revenuePrevMonth,
      },
      trends: {
        visitsDelta: visitsPrevMonth > 0
          ? Math.round(((visitsThisMonth - visitsPrevMonth) / visitsPrevMonth) * 100)
          : null,
        revenueDelta: revenuePrevMonth > 0
          ? Math.round(((revenueThisMonth - revenuePrevMonth) / revenuePrevMonth) * 100)
          : null,
        newLeadsDelta: newPrevMonth > 0
          ? Math.round(((newThisMonth - newPrevMonth) / newPrevMonth) * 100)
          : null,
      },
      projections: {
        // Linear projection based on current pace
        projectedVisits: daysElapsed > 0
          ? Math.round((visitsThisMonth / daysElapsed) * daysInMonth)
          : 0,
        projectedRevenue: daysElapsed > 0
          ? Math.round((revenueThisMonth / daysElapsed) * daysInMonth)
          : 0,
      },
      wonDeals: wonThisMonth,
      byZone: Object.entries(byZone).map(([zone, data]) => ({ zone, ...data })),
      byStage: Object.entries(byStage)
        .map(([status, data]) => ({ status, ...data, order: STAGE_ORDER[status] || 0 }))
        .sort((a, b) => a.order - b.order),
      totalRevenue: totalWonAll,
    };
  }

  // ──────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────

  private leadSelect() {
    return {
      id: true,
      companyName: true,
      contactName: true,
      contactPhone: true,
      zone: true,
      status: true,
      source: true,
      estimatedValue: true,
      lastContactedAt: true,
      createdAt: true,
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
    } as const;
  }

  private leadSelectInner() {
    return {
      id: true,
      companyName: true,
      contactName: true,
      contactPhone: true,
      zone: true,
      status: true,
      source: true,
      estimatedValue: true,
      lastContactedAt: true,
    } as const;
  }

  private buildCriticalTasks(
    overdue: any[],
    scored: any[],
    dealsToPush: any[],
  ) {
    const tasks: Array<{
      type: 'overdue_followup' | 'high_value_inactive' | 'near_close' | 'stale_deal';
      priority: 'critical' | 'high' | 'medium';
      message: string;
      leadId: string;
      companyName: string;
      value: number | null;
    }> = [];

    // Overdue follow-ups are always critical
    overdue.forEach((f) => {
      tasks.push({
        type: 'overdue_followup',
        priority: 'critical',
        message: `Follow-up vencido desde ${new Date(f.followUpDate).toLocaleDateString('es-MX')}`,
        leadId: f.lead.id,
        companyName: f.lead.companyName,
        value: f.lead.estimatedValue,
      });
    });

    // High-value leads that haven't been contacted
    scored
      .filter((l) => l.score >= 4 && (l.daysSinceContact === null || l.daysSinceContact > 7))
      .forEach((l) => {
        tasks.push({
          type: 'high_value_inactive',
          priority: 'high',
          message: `Lead de alto valor sin contacto${l.daysSinceContact !== null ? ` (${l.daysSinceContact}d)` : ' (nunca contactado)'}`,
          leadId: l.id,
          companyName: l.companyName,
          value: l.estimatedValue,
        });
      });

    // Near-close deals that are stale
    dealsToPush
      .filter((l) => {
        const days = this.priorityEngine.daysSince(l.lastContactedAt);
        return (
          ['PENDIENTE_PAGO', 'ESPERANDO_CONTRATO', 'COTIZACION_ENTREGADA'].includes(
            l.status as string,
          ) && (days === null || days > 5)
        );
      })
      .forEach((l) => {
        tasks.push({
          type: 'near_close',
          priority: 'high',
          message: `Deal en ${l.status === 'PENDIENTE_PAGO' ? 'espera de pago' : l.status === 'ESPERANDO_CONTRATO' ? 'espera de contrato' : 'cotizacion entregada'} sin seguimiento`,
          leadId: l.id,
          companyName: l.companyName,
          value: l.estimatedValue,
        });
      });

    // Sort: critical first, then high, then medium
    const priorityOrder = { critical: 0, high: 1, medium: 2 };
    tasks.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return tasks;
  }
}
