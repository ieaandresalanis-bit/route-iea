import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// ── Stage constants ──────────────────────────────────────────

const ACTIVE_STAGES = [
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

const NEAR_CLOSE = ['ESPERANDO_CONTRATO', 'PENDIENTE_PAGO'];

const STAGE_LABELS: Record<string, string> = {
  PENDIENTE_CONTACTAR: 'Pendiente Contactar',
  INTENTANDO_CONTACTAR: 'Intentando Contactar',
  EN_PROSPECCION: 'En Prospeccion',
  AGENDAR_CITA: 'Agendar Cita',
  ESPERANDO_COTIZACION: 'Esperando Cotizacion',
  COTIZACION_ENTREGADA: 'Cotizacion Entregada',
  ESPERANDO_CONTRATO: 'Esperando Contrato',
  PENDIENTE_PAGO: 'Pendiente de Pago',
};

@Injectable()
export class MyDashboardService {
  private readonly logger = new Logger(MyDashboardService.name);

  constructor(private prisma: PrismaService) {}

  /** Format a number with thousands separator */
  private fmt(n: number): string {
    return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  /**
   * Build the full personal advisor dashboard.
   * All data is scoped to the given userId.
   */
  async getMyDashboard(userId: string) {
    // ── Fetch user ────────────────────────────────────────────
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // ── Fetch all leads & tasks in parallel ───────────────────
    const [rawLeads, rawTasks] = await Promise.all([
      this.prisma.lead.findMany({
        where: { assignedToId: userId, deletedAt: null, isHistorical: false },
      }),
      this.prisma.salesTask.findMany({
        where: { advisorId: userId, isHistorical: false },
      }),
    ]);

    const leads = rawLeads as any[];
    const tasks = rawTasks as any[];

    // ── Time boundaries ───────────────────────────────────────
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // ── Lead classifications ──────────────────────────────────
    const activeLeads = leads.filter((l: any) =>
      ACTIVE_STAGES.includes(l.status),
    );
    const closingLeads = leads.filter((l: any) =>
      CLOSING_STAGES.includes(l.status),
    );
    const wonLeads = leads.filter(
      (l: any) =>
        l.status === 'CERRADO_GANADO' &&
        l.convertedAt &&
        new Date(l.convertedAt) >= monthStart,
    );
    const lostLeads = leads.filter(
      (l: any) =>
        l.status === 'CERRADO_PERDIDO' &&
        l.updatedAt &&
        new Date(l.updatedAt) >= monthStart,
    );

    const wonAmount = wonLeads.reduce(
      (sum: number, l: any) => sum + (l.estimatedValue || 0),
      0,
    );
    const pipelineValue = activeLeads.reduce(
      (sum: number, l: any) => sum + (l.estimatedValue || 0),
      0,
    );
    const closingValue = closingLeads.reduce(
      (sum: number, l: any) => sum + (l.estimatedValue || 0),
      0,
    );

    // ── Task classifications ──────────────────────────────────
    const todayTasks = tasks.filter(
      (t: any) => new Date(t.dueDate) >= todayStart && new Date(t.dueDate) < todayEnd,
    );
    const weekTasks = tasks.filter(
      (t: any) => new Date(t.dueDate) >= weekStart && new Date(t.dueDate) < todayEnd,
    );
    const monthTasks = tasks.filter(
      (t: any) => new Date(t.dueDate) >= monthStart && new Date(t.dueDate) < todayEnd,
    );

    const completedToday = todayTasks.filter(
      (t: any) => t.status === 'completed',
    );
    const completedWeek = weekTasks.filter(
      (t: any) => t.status === 'completed',
    );

    const overdueTasks = tasks.filter(
      (t: any) =>
        t.status !== 'completed' &&
        t.status !== 'skipped' &&
        new Date(t.dueDate) < todayStart,
    );

    // ── Pressure: daily counts ────────────────────────────────
    const todayCompleted = todayTasks.filter(
      (t: any) => t.status === 'completed',
    );
    const dailyCalls = todayCompleted.filter(
      (t: any) => t.type === 'call',
    ).length;
    const dailyContacts = todayCompleted.filter((t: any) =>
      ['call', 'whatsapp', 'email', 'visit'].includes(t.type),
    ).length;
    const dailyQuotes = todayCompleted.filter(
      (t: any) => t.type === 'send_quote',
    ).length;
    const dailyReactivations = todayCompleted.filter(
      (t: any) => t.type === 'reactivation',
    ).length;
    const dailyDealsMoved = todayCompleted.filter(
      (t: any) => t.pipelineMoved === true,
    ).length;

    // ── Pressure: weekly counts ───────────────────────────────
    const weekCompleted = weekTasks.filter(
      (t: any) => t.status === 'completed',
    );
    const weeklyCalls = weekCompleted.filter(
      (t: any) => t.type === 'call',
    ).length;
    const weeklyContacts = weekCompleted.filter((t: any) =>
      ['call', 'whatsapp', 'email', 'visit'].includes(t.type),
    ).length;
    const weeklyQuotes = weekCompleted.filter(
      (t: any) => t.type === 'send_quote',
    ).length;

    // ── Pressure: monthly counts ──────────────────────────────
    const monthCompleted = monthTasks.filter(
      (t: any) => t.status === 'completed',
    );
    const monthlyCalls = monthCompleted.filter(
      (t: any) => t.type === 'call',
    ).length;
    const monthlyContacts = monthCompleted.filter((t: any) =>
      ['call', 'whatsapp', 'email', 'visit'].includes(t.type),
    ).length;

    // ── Pressure: overall status ──────────────────────────────
    const pct = (done: number, target: number) =>
      target > 0 ? Math.round((done / target) * 100) : 0;

    const dailyPcts = [
      pct(dailyCalls, 15),
      pct(dailyContacts, 20),
      pct(dailyQuotes, 2),
    ];
    const avgDaily = dailyPcts.reduce((a, b) => a + b, 0) / dailyPcts.length;

    let overallStatus: 'on_track' | 'behind' | 'critical';
    if (avgDaily >= 70) overallStatus = 'on_track';
    else if (avgDaily >= 40) overallStatus = 'behind';
    else overallStatus = 'critical';

    // ── Pending tasks today (max 20) ──────────────────────────
    const pendingToday = todayTasks
      .filter((t: any) => t.status === 'pending' || t.status === 'in_progress')
      .sort((a: any, b: any) => {
        const priorityOrder: Record<string, number> = {
          critical: 0,
          high: 1,
          medium: 2,
          low: 3,
        };
        return (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
      })
      .slice(0, 20)
      .map((t: any) => {
        const lead = leads.find((l: any) => l.id === t.leadId);
        return {
          id: t.id,
          type: t.type,
          title: t.title,
          leadCompany: lead?.companyName || null,
          leadValue: lead?.estimatedValue || null,
          dueDate: t.dueDate,
          priority: t.priority,
        };
      });

    // ── Micro-actions ─────────────────────────────────────────

    // callFirst: top 5 closing deals by value
    const callFirst = closingLeads
      .sort((a: any, b: any) => (b.estimatedValue || 0) - (a.estimatedValue || 0))
      .slice(0, 5)
      .map((l: any) => ({
        id: l.id,
        company: l.companyName,
        value: l.estimatedValue || 0,
        stage: l.status,
        zone: l.zone,
        daysSinceContact: l.lastContactedAt
          ? Math.floor(
              (now.getTime() - new Date(l.lastContactedAt).getTime()) /
                (1000 * 60 * 60 * 24),
            )
          : null,
      }));

    // deliverQuotes: leads waiting for a quote
    const deliverQuotes = leads
      .filter((l: any) => l.status === 'ESPERANDO_COTIZACION')
      .map((l: any) => ({
        id: l.id,
        company: l.companyName,
        value: l.estimatedValue || 0,
        zone: l.zone,
      }));

    // reactivate: 14+ days no contact, top 5 by value
    const fourteenDaysAgo = new Date(
      now.getTime() - 14 * 24 * 60 * 60 * 1000,
    );
    const reactivate = activeLeads
      .filter(
        (l: any) =>
          l.lastContactedAt &&
          new Date(l.lastContactedAt) < fourteenDaysAgo,
      )
      .sort((a: any, b: any) => (b.estimatedValue || 0) - (a.estimatedValue || 0))
      .slice(0, 5)
      .map((l: any) => ({
        id: l.id,
        company: l.companyName,
        value: l.estimatedValue || 0,
        stage: l.status,
        zone: l.zone,
        daysSinceContact: Math.floor(
          (now.getTime() - new Date(l.lastContactedAt).getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      }));

    // pushClosing: near-close leads, top 3 by value
    const pushClosing = leads
      .filter((l: any) => NEAR_CLOSE.includes(l.status))
      .sort((a: any, b: any) => (b.estimatedValue || 0) - (a.estimatedValue || 0))
      .slice(0, 3)
      .map((l: any) => ({
        id: l.id,
        company: l.companyName,
        value: l.estimatedValue || 0,
        stage: l.status,
        zone: l.zone,
      }));

    // ── Pipeline by stage ─────────────────────────────────────
    const byStage = ACTIVE_STAGES.map((stage) => {
      const stageLeads = leads.filter((l: any) => l.status === stage);
      return {
        stage,
        label: STAGE_LABELS[stage] || stage,
        count: stageLeads.length,
        amount: stageLeads.reduce(
          (sum: number, l: any) => sum + (l.estimatedValue || 0),
          0,
        ),
      };
    });

    // ── Performance ───────────────────────────────────────────
    const wonCount = wonLeads.length;
    const lostCount = lostLeads.length;
    const conversionRate =
      wonCount + lostCount > 0
        ? Math.round((wonCount / (wonCount + lostCount)) * 100)
        : 0;
    const avgTicket = wonCount > 0 ? Math.round(wonAmount / wonCount) : 0;

    const leadsWithTasksThisMonth = new Set(
      monthTasks
        .filter((t: any) => t.leadId)
        .map((t: any) => t.leadId),
    ).size;

    const responseRate =
      activeLeads.length > 0
        ? Math.round((leadsWithTasksThisMonth / activeLeads.length) * 100)
        : 0;

    // ── Coaching messages ─────────────────────────────────────
    const topClosingValue = closingLeads
      .slice(0, 3)
      .reduce((sum: number, l: any) => sum + (l.estimatedValue || 0), 0);

    const daily = `Enfocate en ${closingLeads.length} deals en cierre ($${this.fmt(topClosingValue)}). Meta: 15 llamadas, 2 cotizaciones.`;

    // Weekly: best zone analysis
    const zoneCounts: Record<string, { count: number; amount: number }> = {};
    wonLeads.forEach((l: any) => {
      if (!zoneCounts[l.zone]) zoneCounts[l.zone] = { count: 0, amount: 0 };
      zoneCounts[l.zone].count++;
      zoneCounts[l.zone].amount += l.estimatedValue || 0;
    });
    const bestZone = Object.entries(zoneCounts).sort(
      (a, b) => b[1].amount - a[1].amount,
    )[0];
    const weekly = bestZone
      ? `Tu mejor zona este mes: ${bestZone[0]} con ${bestZone[1].count} cierres ($${this.fmt(bestZone[1].amount)}). Concentra esfuerzos ahi.`
      : 'Sin cierres este mes aun. Prioriza deals en etapas avanzadas para generar momentum.';

    // Monthly: revenue vs target
    const revenueTarget = 1500000;
    const revPct = pct(wonAmount, revenueTarget);
    const monthly =
      wonAmount >= revenueTarget
        ? `Meta mensual alcanzada: $${this.fmt(wonAmount)} / $${this.fmt(revenueTarget)} (${revPct}%). Excelente!`
        : `Revenue: $${this.fmt(wonAmount)} / $${this.fmt(revenueTarget)} (${revPct}%). Faltan $${this.fmt(revenueTarget - wonAmount)}. Pipeline en cierre: $${this.fmt(closingValue)}.`;

    // ── Recent activity ───────────────────────────────────────
    const recentActivity = tasks
      .filter((t: any) => t.status === 'completed' && t.completedAt)
      .sort(
        (a: any, b: any) =>
          new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
      )
      .slice(0, 10)
      .map((t: any) => {
        const lead = leads.find((l: any) => l.id === t.leadId);
        return {
          type: t.type,
          leadCompany: lead?.companyName || null,
          completedAt: t.completedAt,
          outcome: t.outcome,
        };
      });

    // ── Assemble response ─────────────────────────────────────
    return {
      advisor: {
        id: user.id,
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
      },
      summary: {
        activeLeads: activeLeads.length,
        closingDeals: closingLeads.length,
        wonMonth: wonCount,
        wonAmount,
        lostMonth: lostCount,
        pipelineValue,
        closingValue,
      },
      pressure: {
        calls: { done: dailyCalls, target: 15, pct: pct(dailyCalls, 15) },
        contacts: {
          done: dailyContacts,
          target: 20,
          pct: pct(dailyContacts, 20),
        },
        quotes: { done: dailyQuotes, target: 2, pct: pct(dailyQuotes, 2) },
        reactivations: {
          done: dailyReactivations,
          target: 3,
          pct: pct(dailyReactivations, 3),
        },
        dealsMoved: {
          done: dailyDealsMoved,
          target: 3,
          pct: pct(dailyDealsMoved, 3),
        },
        weekly: {
          calls: { done: weeklyCalls, target: 75, pct: pct(weeklyCalls, 75) },
          contacts: {
            done: weeklyContacts,
            target: 100,
            pct: pct(weeklyContacts, 100),
          },
          quotes: {
            done: weeklyQuotes,
            target: 10,
            pct: pct(weeklyQuotes, 10),
          },
        },
        monthly: {
          calls: {
            done: monthlyCalls,
            target: 300,
            pct: pct(monthlyCalls, 300),
          },
          contacts: {
            done: monthlyContacts,
            target: 400,
            pct: pct(monthlyContacts, 400),
          },
          revenue: {
            done: wonAmount,
            target: 1500000,
            pct: pct(wonAmount, 1500000),
          },
        },
        overallStatus,
      },
      tasks: {
        pendingToday,
        completedToday: completedToday.length,
        completedWeek: completedWeek.length,
        overdueCount: overdueTasks.length,
      },
      micro: {
        callFirst,
        deliverQuotes,
        reactivate,
        pushClosing,
      },
      pipeline: { byStage },
      performance: {
        conversionRate,
        avgTicket,
        leadsContacted: leadsWithTasksThisMonth,
        responseRate,
      },
      coaching: { daily, weekly, monthly },
      recentActivity,
    };
  }
}
