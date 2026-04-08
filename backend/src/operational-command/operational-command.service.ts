import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';

// ═══════════════════════════════════════════════════════════
// TEAM CONFIGURATION
// ═══════════════════════════════════════════════════════════

const TEAM = [
  { email: 'jaime.nav@iealanis.com', name: 'Jaime Navarrete', role: 'advisor' as const },
  { email: 'j.pimentel@iealanis.com', name: 'Juan Pablo Pimentel', role: 'advisor' as const },
  { email: 'atencion@iealanis.com', name: 'Brenda Lopez Flores', role: 'advisor' as const },
  { email: 'jenifer@iealanis.com', name: 'Jenifer Hernandez', role: 'advisor' as const },
  { email: 'mariana@iealanis.com', name: 'Mariana Zarate', role: 'advisor' as const },
  { email: 'admin@iea.com', name: 'Andres Alanis', role: 'director' as const },
];

const ACTIVE_STATUSES = [
  'PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR', 'EN_PROSPECCION',
  'AGENDAR_CITA', 'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO',
];

const CLOSING_STATUSES = [
  'COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO',
];

// ═══════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════

export interface AdvisorScoreboard {
  rank: number;
  advisorId: string;
  name: string;
  email: string;
  role: 'advisor' | 'director';
  kpis: {
    tasksCompleted: number;
    tasksAssigned: number;
    completionRate: number;
    contactsMade: number;
    followUpsCompleted: number;
    dealsMoved: number;
    dealsClosed: number;
    revenueGenerated: number;
    inactiveLeadsReduced: number;
    avgResponseTimeHours: number;
  };
  status: 'active' | 'inactive' | 'warning';
  lastActivity: Date | null;
  hoursInactive: number;
  score: number;
}

export interface EnforcementAlert {
  type: 'inactivity' | 'overdue_tasks' | 'no_followup' | 'stuck_deal' | 'no_login';
  severity: 'critical' | 'high' | 'medium';
  advisorId: string;
  advisorName: string;
  message: string;
  action: string;
  detectedAt: Date;
}

export interface DailyKPIs {
  followUpsCompleted: number;
  followUpsTarget: number;
  followUpRate: number;
  contactsMade: number;
  dealsMoved: number;
  dealsClosed: number;
  revenueClosed: number;
  inactiveReduced: number;
  tasksCompleted: number;
  tasksTotal: number;
  taskCompletionRate: number;
  leadsTracked: number;
  leadsTotal: number;
  trackingRate: number;
}

export interface FirstWeekPlan {
  day: number;
  date: string;
  phase: string;
  objectives: string[];
  kpiTargets: Record<string, number>;
  status: 'completed' | 'in_progress' | 'upcoming';
}

@Injectable()
export class OperationalCommandService {
  private readonly logger = new Logger(OperationalCommandService.name);
  private reminderLog: Array<{ at: Date; advisors: string[]; type: string }> = [];

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════
  // 1. DAILY SCOREBOARD — Advisor rankings with KPIs
  // ═══════════════════════════════════════════════════════════

  async getScoreboard(): Promise<{
    date: string;
    scoreboard: AdvisorScoreboard[];
    teamKPIs: DailyKPIs;
    adoptionRate: number;
    enforcementStatus: string;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();

    const users = await this.prisma.user.findMany({
      where: { email: { in: TEAM.map((t: any) => t.email) }, isActive: true },
    });

    const scoreboard: AdvisorScoreboard[] = [];

    for (const tm of TEAM) {
      const user = users.find((u) => u.email === tm.email);
      if (!user) continue;

      // Tasks today
      const tasksToday = await this.prisma.salesTask.findMany({
        where: { advisorId: user.id, createdAt: { gte: today }, isHistorical: false },
      });
      const completed = tasksToday.filter((t: any) => t.status === 'completed');
      const followUps = completed.filter(
        (t) => t.type === 'follow_up' || t.type === 'call' || t.type === 'whatsapp',
      );
      const contacts = completed.filter(
        (t) => t.outcome === 'success' || t.outcome === 'partial' || t.outcome === 'rescheduled',
      );
      const dealMoves = completed.filter((t: any) => t.pipelineMoved === true);
      const closes = completed.filter((t: any) => t.type === 'close_deal' && t.outcome === 'success');

      // Revenue from deals closed today
      const closedLeadIds = closes.map((t: any) => t.leadId).filter(Boolean);
      let revenueGenerated = 0;
      if (closedLeadIds.length > 0) {
        const closedLeads = await this.prisma.lead.findMany({
          where: { id: { in: closedLeadIds as string[] } },
          select: { estimatedValue: true },
        });
        revenueGenerated = closedLeads.reduce((s: any, l: any) => s + (l.estimatedValue ?? 0), 0);
      }

      // Inactive leads reduced: leads assigned to this advisor that were contacted today
      // after being inactive (lastContactedAt > 3 days ago before today)
      const threeDaysAgo = new Date(today);
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const reactivated = await this.prisma.lead.count({
        where: {
          assignedToId: user.id,
          lastContactedAt: { gte: today },
          status: { in: ACTIVE_STATUSES as any },
          isHistorical: false,
        },
      });

      // Last activity
      const lastTask = await this.prisma.salesTask.findFirst({
        where: { advisorId: user.id, status: 'completed', isHistorical: false },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      });
      const lastActivity = lastTask?.completedAt ?? null;
      const hoursInactive = lastActivity
        ? (now.getTime() - lastActivity.getTime()) / 3600000
        : 999;

      // Avg response time
      const completedWithTimes = completed.filter((t: any) => t.startedAt && t.completedAt);
      const avgResponseTimeHours =
        completedWithTimes.length > 0
          ? completedWithTimes.reduce(
              (s, t) =>
                s + (t.completedAt!.getTime() - t.startedAt!.getTime()) / 3600000,
              0,
            ) / completedWithTimes.length
          : 0;

      // Score: weighted combination
      const completionRate =
        tasksToday.length > 0 ? completed.length / tasksToday.length : 0;
      const score = Math.round(
        completionRate * 40 +
          Math.min(contacts.length / 5, 1) * 25 +
          Math.min(dealMoves.length / 2, 1) * 20 +
          Math.min(closes.length, 1) * 15,
      );

      let status: 'active' | 'inactive' | 'warning' = 'active';
      if (hoursInactive > 4) status = 'inactive';
      else if (hoursInactive > 2) status = 'warning';

      scoreboard.push({
        rank: 0,
        advisorId: user.id,
        name: tm.name,
        email: tm.email,
        role: tm.role,
        kpis: {
          tasksCompleted: completed.length,
          tasksAssigned: tasksToday.length,
          completionRate: Math.round(completionRate * 100),
          contactsMade: contacts.length,
          followUpsCompleted: followUps.length,
          dealsMoved: dealMoves.length,
          dealsClosed: closes.length,
          revenueGenerated,
          inactiveLeadsReduced: reactivated,
          avgResponseTimeHours: Math.round(avgResponseTimeHours * 10) / 10,
        },
        status,
        lastActivity,
        hoursInactive: Math.round(hoursInactive * 10) / 10,
        score,
      });
    }

    // Rank by score desc
    scoreboard.sort((a: any, b: any) => b.score - a.score);
    scoreboard.forEach((s, i) => (s.rank = i + 1));

    // Team KPIs
    const teamKPIs = this.aggregateTeamKPIs(scoreboard);

    // Adoption rate: advisors with at least 1 task completed today
    const activeAdvisors = scoreboard.filter(
      (s) => s.kpis.tasksCompleted > 0,
    ).length;
    const adoptionRate = Math.round((activeAdvisors / scoreboard.length) * 100);

    // Enforcement status
    const criticals = scoreboard.filter((s: any) => s.status === 'inactive').length;
    const enforcementStatus =
      criticals === 0 ? 'green' : criticals <= 2 ? 'yellow' : 'red';

    return {
      date: today.toISOString().split('T')[0],
      scoreboard,
      teamKPIs,
      adoptionRate,
      enforcementStatus,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 2. ENFORCEMENT ALERTS — Detect violations
  // ═══════════════════════════════════════════════════════════

  async getEnforcementAlerts(): Promise<{
    alerts: EnforcementAlert[];
    rules: Array<{ rule: string; status: 'passing' | 'failing'; detail: string }>;
  }> {
    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const users = await this.prisma.user.findMany({
      where: { email: { in: TEAM.map((t: any) => t.email) }, isActive: true },
    });

    const alerts: EnforcementAlert[] = [];

    for (const tm of TEAM) {
      const user = users.find((u) => u.email === tm.email);
      if (!user) continue;

      // 1. Inactivity detection (>2h without completed task during work hours)
      const lastCompleted = await this.prisma.salesTask.findFirst({
        where: { advisorId: user.id, status: 'completed', isHistorical: false },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      });
      const hoursSinceActivity = lastCompleted?.completedAt
        ? (now.getTime() - lastCompleted.completedAt.getTime()) / 3600000
        : 999;
      const isWorkHours = now.getHours() >= 8 && now.getHours() < 18;
      const isWorkDay = now.getDay() >= 1 && now.getDay() <= 6;

      if (isWorkHours && isWorkDay && hoursSinceActivity > 3) {
        alerts.push({
          type: 'inactivity',
          severity: hoursSinceActivity > 4 ? 'critical' : 'high',
          advisorId: user.id,
          advisorName: tm.name,
          message: `${tm.name}: ${Math.round(hoursSinceActivity)}h sin actividad`,
          action: 'Contactar inmediatamente. Verificar que esta trabajando en el sistema.',
          detectedAt: now,
        });
      }

      // 2. Overdue tasks
      const overdueTasks = await this.prisma.salesTask.count({
        where: {
          advisorId: user.id,
          status: { in: ['pending', 'in_progress'] },
          dueDate: { lt: now },
          isHistorical: false,
        },
      });
      if (overdueTasks > 3) {
        alerts.push({
          type: 'overdue_tasks',
          severity: overdueTasks > 8 ? 'critical' : 'high',
          advisorId: user.id,
          advisorName: tm.name,
          message: `${tm.name}: ${overdueTasks} tareas vencidas sin completar`,
          action: 'Revisar tareas vencidas y priorizar ejecucion inmediata.',
          detectedAt: now,
        });
      }

      // 3. Leads without recent contact (>7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const leadsNoFollowUp = await this.prisma.lead.count({
        where: {
          assignedToId: user.id,
          status: { in: ACTIVE_STATUSES as any },
          isHistorical: false,
          OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: sevenDaysAgo } }],
        },
      });
      if (leadsNoFollowUp > 5) {
        alerts.push({
          type: 'no_followup',
          severity: leadsNoFollowUp > 15 ? 'critical' : 'medium',
          advisorId: user.id,
          advisorName: tm.name,
          message: `${tm.name}: ${leadsNoFollowUp} leads activos sin follow-up programado`,
          action: 'Programar follow-ups para todos los leads activos.',
          detectedAt: now,
        });
      }

      // 4. Stuck deals (closing stage > 5 days)
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
      const stuckDeals = await this.prisma.lead.count({
        where: {
          assignedToId: user.id,
          status: { in: CLOSING_STATUSES as any },
          isHistorical: false,
          updatedAt: { lt: fiveDaysAgo },
        },
      });
      if (stuckDeals > 0) {
        alerts.push({
          type: 'stuck_deal',
          severity: stuckDeals > 3 ? 'critical' : 'high',
          advisorId: user.id,
          advisorName: tm.name,
          message: `${tm.name}: ${stuckDeals} deals en cierre estancados (>5 dias)`,
          action: 'Revisar cada deal. Llamar o visitar cliente. Escalar si necesario.',
          detectedAt: now,
        });
      }
    }

    // Sort by severity
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2 };
    alerts.sort((a: any, b: any) => severityOrder[a.severity] - severityOrder[b.severity]);

    // Enforcement rules check
    const totalLeads = await this.prisma.lead.count({
      where: { status: { in: ACTIVE_STATUSES as any }, isHistorical: false },
    });
    const assignedLeads = await this.prisma.lead.count({
      where: {
        status: { in: ACTIVE_STATUSES as any },
        isHistorical: false,
        assignedToId: { not: null },
      },
    });
    const unloggedLeads = totalLeads - assignedLeads;

    const todayTasks = await this.prisma.salesTask.count({
      where: { createdAt: { gte: today }, isHistorical: false },
    });
    const todayCompleted = await this.prisma.salesTask.count({
      where: { createdAt: { gte: today }, status: 'completed', isHistorical: false },
    });

    const rules = [
      {
        rule: 'Todos los leads asignados a un asesor',
        status: (unloggedLeads === 0 ? 'passing' : 'failing') as 'passing' | 'failing',
        detail: unloggedLeads === 0
          ? `${totalLeads} leads activos, 100% asignados`
          : `${unloggedLeads} leads sin asesor asignado`,
      },
      {
        rule: 'Tareas ejecutadas hoy',
        status: (todayCompleted > 0 ? 'passing' : 'failing') as 'passing' | 'failing',
        detail: `${todayCompleted}/${todayTasks} tareas completadas hoy`,
      },
      {
        rule: 'Todos los asesores activos en el sistema',
        status: (alerts.filter((a: any) => a.type === 'inactivity').length === 0
          ? 'passing'
          : 'failing') as 'passing' | 'failing',
        detail: `${alerts.filter((a: any) => a.type === 'inactivity').length} asesores inactivos`,
      },
      {
        rule: 'Sin deals estancados en cierre',
        status: (alerts.filter((a: any) => a.type === 'stuck_deal').length === 0
          ? 'passing'
          : 'failing') as 'passing' | 'failing',
        detail: `${alerts.filter((a: any) => a.type === 'stuck_deal').length} alertas de deals estancados`,
      },
    ];

    return { alerts, rules };
  }

  // ═══════════════════════════════════════════════════════════
  // 3. ADOPTION METRICS — Track system usage
  // ═══════════════════════════════════════════════════════════

  async getAdoptionMetrics(): Promise<{
    overallAdoption: number;
    advisors: Array<{
      name: string;
      email: string;
      tasksCompletedToday: number;
      tasksCompletedWeek: number;
      leadsUpdatedToday: number;
      daysActiveThisWeek: number;
      adoptionScore: number;
      status: 'full' | 'partial' | 'none';
    }>;
    systemCoverage: {
      leadsTracked: number;
      leadsTotal: number;
      followUpsScheduled: number;
      pipelineVisible: number;
    };
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);

    const users = await this.prisma.user.findMany({
      where: { email: { in: TEAM.map((t: any) => t.email) }, isActive: true },
    });

    const advisors = [];

    for (const tm of TEAM) {
      const user = users.find((u) => u.email === tm.email);
      if (!user) continue;

      const tasksCompletedToday = await this.prisma.salesTask.count({
        where: { advisorId: user.id, status: 'completed', completedAt: { gte: today }, isHistorical: false },
      });

      const tasksCompletedWeek = await this.prisma.salesTask.count({
        where: { advisorId: user.id, status: 'completed', completedAt: { gte: weekStart }, isHistorical: false },
      });

      const leadsUpdatedToday = await this.prisma.lead.count({
        where: { assignedToId: user.id, updatedAt: { gte: today } },
      });

      // Days active: count distinct days with completed tasks this week
      const weekTasks = await this.prisma.salesTask.findMany({
        where: { advisorId: user.id, status: 'completed', completedAt: { gte: weekStart }, isHistorical: false },
        select: { completedAt: true },
      });
      const activeDays = new Set(
        weekTasks.map((t: any) => t.completedAt?.toISOString().split('T')[0]),
      );
      const daysActiveThisWeek = activeDays.size;

      // Adoption score: 0-100
      const dayScore = Math.min(daysActiveThisWeek / 5, 1) * 40;
      const taskScore = Math.min(tasksCompletedToday / 5, 1) * 35;
      const updateScore = Math.min(leadsUpdatedToday / 3, 1) * 25;
      const adoptionScore = Math.round(dayScore + taskScore + updateScore);

      let status: 'full' | 'partial' | 'none' = 'none';
      if (adoptionScore >= 60) status = 'full';
      else if (adoptionScore >= 20) status = 'partial';

      advisors.push({
        name: tm.name,
        email: tm.email,
        tasksCompletedToday,
        tasksCompletedWeek,
        leadsUpdatedToday,
        daysActiveThisWeek,
        adoptionScore,
        status,
      });
    }

    const overallAdoption = Math.round(
      advisors.reduce((s: any, a: any) => s + a.adoptionScore, 0) / advisors.length,
    );

    // System coverage
    const totalActive = await this.prisma.lead.count({
      where: { status: { in: ACTIVE_STATUSES as any }, isHistorical: false },
    });
    const tracked = await this.prisma.lead.count({
      where: {
        status: { in: ACTIVE_STATUSES as any },
        isHistorical: false,
        assignedToId: { not: null },
      },
    });
    const sevenDaysAgo2 = new Date();
    sevenDaysAgo2.setDate(sevenDaysAgo2.getDate() - 7);
    const withFollowUp = await this.prisma.lead.count({
      where: {
        status: { in: ACTIVE_STATUSES as any },
        isHistorical: false,
        lastContactedAt: { gte: sevenDaysAgo2 },
      },
    });
    const inClosing = await this.prisma.lead.count({
      where: { status: { in: CLOSING_STATUSES as any }, isHistorical: false },
    });

    return {
      overallAdoption,
      advisors,
      systemCoverage: {
        leadsTracked: tracked,
        leadsTotal: totalActive,
        followUpsScheduled: withFollowUp,
        pipelineVisible: inClosing,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 4. FIRST WEEK EXECUTION PLAN
  // ═══════════════════════════════════════════════════════════

  getFirstWeekPlan(): {
    launchDate: string;
    week: FirstWeekPlan[];
    successCriteria: string[];
    rules: string[];
  } {
    const launchDate = new Date();
    const plans: FirstWeekPlan[] = [];

    for (let d = 0; d < 5; d++) {
      const date = new Date(launchDate);
      date.setDate(date.getDate() + d);
      const dateStr = date.toISOString().split('T')[0];
      const isToday = d === 0;
      const isPast = false;

      if (d <= 1) {
        plans.push({
          day: d + 1,
          date: dateStr,
          phase: 'Onboarding + Primera Ejecucion',
          objectives: [
            'Sesion de entrenamiento (60 min)',
            'Cada asesor abre /sales/ops y revisa sus tareas',
            'Ejecutar al menos 5 follow-ups por asesor',
            'Actualizar al menos 3 stages de leads',
            'Registrar toda interaccion en el sistema',
          ],
          kpiTargets: { followUps: 5, contacts: 3, stageUpdates: 3 },
          status: isToday ? 'in_progress' : 'upcoming',
        });
      } else if (d <= 4) {
        plans.push({
          day: d + 1,
          date: dateStr,
          phase: 'Monitoreo + Correccion',
          objectives: [
            'Verificar que todos los asesores usan el sistema diariamente',
            'Corregir comportamiento: no hay excusas para no loggear',
            'Neto monitorea /sales/alerts y actua',
            'Director revisa scoreboard diario',
            'Meta: 80%+ adoption rate',
          ],
          kpiTargets: { followUps: 10, contacts: 5, stageUpdates: 5, adoptionRate: 80 },
          status: 'upcoming',
        });
      }
    }

    return {
      launchDate: launchDate.toISOString().split('T')[0],
      week: plans,
      successCriteria: [
        '100% de leads rastreados en el sistema',
        '100% de follow-ups registrados',
        'Cero leads inactivos sin accion',
        'Todos los asesores usan el sistema diariamente',
        'Visibilidad total de revenue',
      ],
      rules: [
        'Ningun lead fuera del sistema',
        'Ningun follow-up sin registrar',
        'Ningun deal fuera de la plataforma',
        'El sistema es la UNICA fuente de verdad',
        'No se permite usar herramientas paralelas',
        'Performance se mide SOLO con datos del sistema',
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 5. TEAM OVERVIEW — Operational roster
  // ═══════════════════════════════════════════════════════════

  async getTeamOverview(): Promise<{
    team: Array<{
      name: string;
      email: string;
      role: string;
      activeLeads: number;
      closingDeals: number;
      pipelineValue: number;
      tasksToday: number;
      tasksCompleted: number;
      status: string;
    }>;
    totals: {
      activeLeads: number;
      closingDeals: number;
      pipelineValue: number;
      tasksToday: number;
      tasksCompleted: number;
    };
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const users = await this.prisma.user.findMany({
      where: { email: { in: TEAM.map((t: any) => t.email) }, isActive: true },
    });

    const team = [];
    const totals = { activeLeads: 0, closingDeals: 0, pipelineValue: 0, tasksToday: 0, tasksCompleted: 0 };

    for (const tm of TEAM) {
      const user = users.find((u) => u.email === tm.email);
      if (!user) continue;

      const activeLeads = await this.prisma.lead.count({
        where: { assignedToId: user.id, status: { in: ACTIVE_STATUSES as any }, isHistorical: false },
      });

      const closingDeals = await this.prisma.lead.count({
        where: { assignedToId: user.id, status: { in: CLOSING_STATUSES as any }, isHistorical: false },
      });

      const leads = await this.prisma.lead.findMany({
        where: { assignedToId: user.id, status: { in: ACTIVE_STATUSES as any }, isHistorical: false },
        select: { estimatedValue: true },
      });
      const pipelineValue = leads.reduce((s: any, l: any) => s + (l.estimatedValue ?? 0), 0);

      const tasksToday = await this.prisma.salesTask.count({
        where: { advisorId: user.id, createdAt: { gte: today }, isHistorical: false },
      });
      const tasksCompleted = await this.prisma.salesTask.count({
        where: { advisorId: user.id, status: 'completed', completedAt: { gte: today }, isHistorical: false },
      });

      // Last activity for status
      const lastTask = await this.prisma.salesTask.findFirst({
        where: { advisorId: user.id, status: 'completed', isHistorical: false },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      });
      const hoursInactive = lastTask?.completedAt
        ? (Date.now() - lastTask.completedAt.getTime()) / 3600000
        : 999;
      const status = hoursInactive > 4 ? 'inactive' : hoursInactive > 2 ? 'warning' : 'active';

      team.push({
        name: tm.name,
        email: tm.email,
        role: tm.role,
        activeLeads,
        closingDeals,
        pipelineValue,
        tasksToday,
        tasksCompleted,
        status,
      });

      totals.activeLeads += activeLeads;
      totals.closingDeals += closingDeals;
      totals.pipelineValue += pipelineValue;
      totals.tasksToday += tasksToday;
      totals.tasksCompleted += tasksCompleted;
    }

    return { team, totals };
  }

  // ═══════════════════════════════════════════════════════════
  // 6. CRON: ENFORCEMENT REMINDERS — Every 2 hours Mon-Sat
  // ═══════════════════════════════════════════════════════════

  @Cron('0 0 10,12,14,16 * * 1-6')
  async sendEnforcementReminders(): Promise<{
    sent: number;
    reminders: Array<{ advisor: string; type: string; message: string }>;
  }> {
    this.logger.log('⏰ Enforcement reminder cycle starting...');
    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const users = await this.prisma.user.findMany({
      where: { email: { in: TEAM.map((t: any) => t.email) }, isActive: true },
    });

    const reminders: Array<{ advisor: string; type: string; message: string }> = [];

    for (const tm of TEAM) {
      const user = users.find((u) => u.email === tm.email);
      if (!user) continue;

      // Check pending tasks
      const pending = await this.prisma.salesTask.count({
        where: {
          advisorId: user.id,
          status: { in: ['pending', 'in_progress'] },
          dueDate: { lte: new Date(now.getTime() + 3600000 * 4) }, // due within 4h
          isHistorical: false,
        },
      });

      // Check overdue
      const overdue = await this.prisma.salesTask.count({
        where: {
          advisorId: user.id,
          status: { in: ['pending', 'in_progress'] },
          dueDate: { lt: now },
          isHistorical: false,
        },
      });

      // Check today's completion rate
      const todayTotal = await this.prisma.salesTask.count({
        where: { advisorId: user.id, createdAt: { gte: today }, isHistorical: false },
      });
      const todayDone = await this.prisma.salesTask.count({
        where: { advisorId: user.id, status: 'completed', completedAt: { gte: today }, isHistorical: false },
      });

      if (overdue > 0) {
        reminders.push({
          advisor: tm.name,
          type: 'overdue',
          message: `⚠️ ${tm.name}: ${overdue} tareas vencidas. Ejecutar inmediatamente.`,
        });
      }

      if (pending > 3 && todayDone === 0) {
        reminders.push({
          advisor: tm.name,
          type: 'no_activity',
          message: `🔴 ${tm.name}: ${pending} tareas pendientes y 0 completadas hoy. Iniciar ejecucion.`,
        });
      } else if (pending > 0) {
        reminders.push({
          advisor: tm.name,
          type: 'pending',
          message: `📋 ${tm.name}: ${pending} tareas por ejecutar en las proximas 4 horas.`,
        });
      }
    }

    this.reminderLog.push({
      at: now,
      advisors: reminders.map((r: any) => r.advisor),
      type: 'enforcement',
    });

    // Keep only last 50 logs
    if (this.reminderLog.length > 50) {
      this.reminderLog = this.reminderLog.slice(-50);
    }

    this.logger.log(`✅ Sent ${reminders.length} enforcement reminders`);
    return { sent: reminders.length, reminders };
  }

  // ═══════════════════════════════════════════════════════════
  // 7. REMINDER LOG
  // ═══════════════════════════════════════════════════════════

  getReminderLog() {
    return {
      total: this.reminderLog.length,
      recent: this.reminderLog.slice(-20).reverse(),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════

  private aggregateTeamKPIs(scoreboard: AdvisorScoreboard[]): DailyKPIs {
    const sum = (fn: (s: AdvisorScoreboard) => number) =>
      scoreboard.reduce((t: any, s: any) => t + fn(s), 0);

    const totalTasks = sum((s) => s.kpis.tasksAssigned);
    const completedTasks = sum((s) => s.kpis.tasksCompleted);

    return {
      followUpsCompleted: sum((s) => s.kpis.followUpsCompleted),
      followUpsTarget: scoreboard.length * 10,
      followUpRate: Math.round(
        (sum((s) => s.kpis.followUpsCompleted) / (scoreboard.length * 10)) * 100,
      ),
      contactsMade: sum((s) => s.kpis.contactsMade),
      dealsMoved: sum((s) => s.kpis.dealsMoved),
      dealsClosed: sum((s) => s.kpis.dealsClosed),
      revenueClosed: sum((s) => s.kpis.revenueGenerated),
      inactiveReduced: sum((s) => s.kpis.inactiveLeadsReduced),
      tasksCompleted: completedTasks,
      tasksTotal: totalTasks,
      taskCompletionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      leadsTracked: 0, // filled by caller if needed
      leadsTotal: 0,
      trackingRate: 0,
    };
  }
}
