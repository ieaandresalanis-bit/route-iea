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

// ── KPI targets ──────────────────────────────────────────────

const KPI_TARGETS = {
  calls: 15,
  followUps: 10,
  quotes: 2,
  dealsMoved: 3,
  dealsClosed: 1,
};

const MONTHLY_REVENUE_TARGET = 500_000;
const WORKING_DAYS_PER_MONTH = 22;
const DAILY_TARGET = Math.round(MONTHLY_REVENUE_TARGET / WORKING_DAYS_PER_MONTH);
const WEEKLY_TARGET = Math.round(MONTHLY_REVENUE_TARGET / 4);

@Injectable()
export class MiDiaService {
  private readonly logger = new Logger(MiDiaService.name);

  constructor(private prisma: PrismaService) {}

  // ── Helpers ──────────────────────────────────────────────────

  private fmt(n: number): string {
    return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  private pct(done: number, target: number): number {
    return target > 0 ? Math.round((done / target) * 100) : 0;
  }

  private kpiStatus(pct: number): 'green' | 'yellow' | 'red' {
    if (pct >= 70) return 'green';
    if (pct >= 40) return 'yellow';
    return 'red';
  }

  private daysBetween(from: Date, to: Date): number {
    return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
  }

  private timeStr(d: Date): string {
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  // ── Main method ──────────────────────────────────────────────

  async getMiDia(userId: string) {
    // ── Fetch user ───────────────────────────────────────────
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // ── Time boundaries ──────────────────────────────────────
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // ── Fetch all data in parallel ───────────────────────────
    const [rawLeads, rawTasks, rawAlerts] = await Promise.all([
      this.prisma.lead.findMany({
        where: { assignedToId: userId, deletedAt: null, isHistorical: false },
      }),
      this.prisma.salesTask.findMany({
        where: { advisorId: userId, isHistorical: false },
      }),
      this.prisma.salesAlert.findMany({
        where: {
          advisorId: userId,
          status: { in: ['open', 'acknowledged'] as any },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const leads = rawLeads as any[];
    const tasks = rawTasks as any[];
    const alerts = rawAlerts as any[];

    // ── Lead classifications ─────────────────────────────────
    const activeLeads = leads.filter((l: any) =>
      ACTIVE_STAGES.includes(l.status),
    );
    const closingLeads = leads.filter((l: any) =>
      CLOSING_STAGES.includes(l.status),
    );
    const wonLeadsMonth = leads.filter(
      (l: any) =>
        l.status === 'CERRADO_GANADO' &&
        l.convertedAt &&
        new Date(l.convertedAt) >= monthStart,
    );
    const lostLeadsMonth = leads.filter(
      (l: any) =>
        l.status === 'CERRADO_PERDIDO' &&
        l.updatedAt &&
        new Date(l.updatedAt) >= monthStart,
    );
    const wonLeadsWeek = leads.filter(
      (l: any) =>
        l.status === 'CERRADO_GANADO' &&
        l.convertedAt &&
        new Date(l.convertedAt) >= weekStart,
    );

    const wonAmountMonth = wonLeadsMonth.reduce(
      (sum: number, l: any) => sum + (l.estimatedValue || 0),
      0,
    );
    const wonAmountWeek = wonLeadsWeek.reduce(
      (sum: number, l: any) => sum + (l.estimatedValue || 0),
      0,
    );

    // ── Task classifications ─────────────────────────────────
    const todayTasks = tasks.filter(
      (t: any) =>
        t.dueDate &&
        new Date(t.dueDate) >= todayStart &&
        new Date(t.dueDate) < todayEnd,
    );
    const weekTasks = tasks.filter(
      (t: any) =>
        t.dueDate &&
        new Date(t.dueDate) >= weekStart &&
        new Date(t.dueDate) < todayEnd,
    );
    const monthTasks = tasks.filter(
      (t: any) =>
        t.dueDate &&
        new Date(t.dueDate) >= monthStart &&
        new Date(t.dueDate) < todayEnd,
    );

    const completedToday = todayTasks.filter(
      (t: any) => t.status === 'completed',
    );
    const completedWeek = weekTasks.filter(
      (t: any) => t.status === 'completed',
    );
    const completedMonth = monthTasks.filter(
      (t: any) => t.status === 'completed',
    );

    const overdueTasks = tasks.filter(
      (t: any) =>
        t.dueDate &&
        t.status !== 'completed' &&
        t.status !== 'skipped' &&
        new Date(t.dueDate) < todayStart,
    );

    // ── 1. PERSONAL HEADER ───────────────────────────────────
    const advisor = {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`,
      email: user.email,
      role: user.role,
    };

    const dailyTarget = {
      label: `Meta diaria: $${this.fmt(DAILY_TARGET)}`,
      amount: DAILY_TARGET,
    };

    const weeklyProgress = {
      target: WEEKLY_TARGET,
      actual: wonAmountWeek,
      pct: this.pct(wonAmountWeek, WEEKLY_TARGET),
    };

    // ── 2. DAILY KPIs ────────────────────────────────────────
    const dailyCalls = completedToday.filter(
      (t: any) => t.type === 'call',
    ).length;

    const dailyFollowUps = completedToday.filter((t: any) =>
      ['follow_up', 'whatsapp', 'email'].includes(t.type),
    ).length;

    const dailyQuotes = completedToday.filter(
      (t: any) => t.type === 'send_quote',
    ).length;

    const dailyDealsMoved = completedToday.filter(
      (t: any) => t.pipelineMoved === true,
    ).length;

    const dailyDealsClosed = leads.filter(
      (l: any) =>
        l.status === 'CERRADO_GANADO' &&
        l.convertedAt &&
        new Date(l.convertedAt) >= todayStart &&
        new Date(l.convertedAt) < todayEnd,
    ).length;

    const callsPct = this.pct(dailyCalls, KPI_TARGETS.calls);
    const followUpsPct = this.pct(dailyFollowUps, KPI_TARGETS.followUps);
    const quotesPct = this.pct(dailyQuotes, KPI_TARGETS.quotes);
    const dealsMovedPct = this.pct(dailyDealsMoved, KPI_TARGETS.dealsMoved);
    const dealsClosedPct = this.pct(dailyDealsClosed, KPI_TARGETS.dealsClosed);

    const allPcts = [callsPct, followUpsPct, quotesPct, dealsMovedPct, dealsClosedPct];
    const overallScore = Math.round(
      allPcts.reduce((a: number, b: number) => a + b, 0) / allPcts.length,
    );

    const kpis = {
      calls: { done: dailyCalls, target: KPI_TARGETS.calls, pct: callsPct, status: this.kpiStatus(callsPct) },
      followUps: { done: dailyFollowUps, target: KPI_TARGETS.followUps, pct: followUpsPct, status: this.kpiStatus(followUpsPct) },
      quotes: { done: dailyQuotes, target: KPI_TARGETS.quotes, pct: quotesPct, status: this.kpiStatus(quotesPct) },
      dealsMoved: { done: dailyDealsMoved, target: KPI_TARGETS.dealsMoved, pct: dealsMovedPct, status: this.kpiStatus(dealsMovedPct) },
      dealsClosed: { done: dailyDealsClosed, target: KPI_TARGETS.dealsClosed, pct: dealsClosedPct, status: this.kpiStatus(dealsClosedPct) },
      overallScore,
      overallStatus: this.kpiStatus(overallScore),
    };

    // ── Motivational message ─────────────────────────────────
    let motivational: string;
    if (overallScore >= 80) {
      motivational = 'Excelente dia! Vas por encima de tu meta.';
    } else if (overallScore >= 50) {
      motivational = 'Buen avance. Manten el ritmo para cumplir la meta.';
    } else if (overallScore >= 20) {
      motivational = 'Todavia hay tiempo. Enfocate en las acciones de mayor impacto.';
    } else {
      motivational = 'El dia apenas empieza. Tu primera llamada puede cambiar todo.';
    }

    // ── 3. AGENDA ────────────────────────────────────────────
    const agendaTasks = todayTasks
      .filter((t: any) => t.status === 'pending' || t.status === 'in_progress')
      .sort((a: any, b: any) => {
        const scoreDiff = (b.priorityScore || 0) - (a.priorityScore || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      });

    const agenda = agendaTasks.map((t: any) => {
      const lead = t.leadId
        ? leads.find((l: any) => l.id === t.leadId)
        : null;
      return {
        id: t.id,
        time: this.timeStr(new Date(t.dueDate)),
        type: t.type,
        title: t.title,
        priority: t.priority,
        status: t.status,
        lead: lead
          ? {
              id: lead.id,
              companyName: lead.companyName,
              contactName: lead.contactName,
              contactPhone: lead.contactPhone,
              contactEmail: lead.contactEmail,
              stage: lead.status,
              estimatedValue: lead.estimatedValue || 0,
            }
          : null,
        suggestion: t.suggestion || null,
      };
    });

    // ── 4. NEXT BEST ACTIONS ─────────────────────────────────
    const nextBestActions: any[] = [];
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // High-value deals not contacted in 3+ days
    const highValueStale = activeLeads
      .filter(
        (l: any) =>
          (l.estimatedValue || 0) > 0 &&
          l.lastContactedAt &&
          new Date(l.lastContactedAt) < threeDaysAgo,
      )
      .sort((a: any, b: any) => (b.estimatedValue || 0) - (a.estimatedValue || 0))
      .slice(0, 3);

    highValueStale.forEach((l: any) => {
      const days = this.daysBetween(new Date(l.lastContactedAt), now);
      nextBestActions.push({
        type: 'high_value',
        title: `Retomar contacto con ${l.companyName}`,
        description: `Deal de $${this.fmt(l.estimatedValue || 0)} sin contacto en ${days} dias.`,
        lead: {
          id: l.id,
          companyName: l.companyName,
          estimatedValue: l.estimatedValue || 0,
          stage: l.status,
          daysSinceContact: days,
        },
        priority: 'high',
        action: `Llamar o enviar WhatsApp a ${l.contactName || l.companyName} hoy.`,
      });
    });

    // Closing stages — push to close
    const closingOpportunities = closingLeads
      .sort((a: any, b: any) => (b.estimatedValue || 0) - (a.estimatedValue || 0))
      .slice(0, 2);

    closingOpportunities.forEach((l: any) => {
      const days = l.lastContactedAt
        ? this.daysBetween(new Date(l.lastContactedAt), now)
        : null;
      nextBestActions.push({
        type: 'closing',
        title: `Cerrar deal: ${l.companyName}`,
        description: `En etapa ${STAGE_LABELS[l.status] || l.status} por $${this.fmt(l.estimatedValue || 0)}.`,
        lead: {
          id: l.id,
          companyName: l.companyName,
          estimatedValue: l.estimatedValue || 0,
          stage: l.status,
          daysSinceContact: days,
        },
        priority: 'critical',
        action: `Dar seguimiento agresivo para avanzar a cierre.`,
      });
    });

    // Overdue tasks
    const topOverdue = overdueTasks
      .sort((a: any, b: any) => (b.priorityScore || 0) - (a.priorityScore || 0))
      .slice(0, 2);

    topOverdue.forEach((t: any) => {
      const lead = t.leadId ? leads.find((l: any) => l.id === t.leadId) : null;
      const days = this.daysBetween(new Date(t.dueDate), now);
      nextBestActions.push({
        type: 'urgent_followup',
        title: `Tarea vencida: ${t.title}`,
        description: `Vencida hace ${days} dias. ${lead ? `Lead: ${lead.companyName}` : ''}`,
        lead: lead
          ? {
              id: lead.id,
              companyName: lead.companyName,
              estimatedValue: lead.estimatedValue || 0,
              stage: lead.status,
              daysSinceContact: lead.lastContactedAt
                ? this.daysBetween(new Date(lead.lastContactedAt), now)
                : null,
            }
          : null,
        priority: t.priority || 'high',
        action: `Completar esta tarea de inmediato o reasignar.`,
      });
    });

    // Leads with no contact in 7+ days
    const inactive = activeLeads
      .filter(
        (l: any) =>
          l.lastContactedAt &&
          new Date(l.lastContactedAt) < sevenDaysAgo &&
          !CLOSING_STAGES.includes(l.status),
      )
      .sort((a: any, b: any) => (b.estimatedValue || 0) - (a.estimatedValue || 0))
      .slice(0, 2);

    inactive.forEach((l: any) => {
      const days = this.daysBetween(new Date(l.lastContactedAt), now);
      nextBestActions.push({
        type: 'inactive',
        title: `Reactivar: ${l.companyName}`,
        description: `Sin contacto en ${days} dias. Riesgo de perder oportunidad de $${this.fmt(l.estimatedValue || 0)}.`,
        lead: {
          id: l.id,
          companyName: l.companyName,
          estimatedValue: l.estimatedValue || 0,
          stage: l.status,
          daysSinceContact: days,
        },
        priority: 'medium',
        action: `Contactar hoy para reactivar la relacion.`,
      });
    });

    // ── 5. TASK SUMMARY ──────────────────────────────────────
    const pendingTodayCount = todayTasks.filter(
      (t: any) => t.status === 'pending' || t.status === 'in_progress',
    ).length;

    const escalatedCount = tasks.filter(
      (t: any) => t.status === 'reassigned',
    ).length;

    const taskTypeMap: Record<string, number> = {};
    todayTasks.forEach((t: any) => {
      taskTypeMap[t.type] = (taskTypeMap[t.type] || 0) + 1;
    });
    const byType = Object.entries(taskTypeMap).map(
      ([type, count]: [string, number]) => ({ type, count }),
    );

    const tasksSummary = {
      pendingToday: pendingTodayCount,
      completedToday: completedToday.length,
      overdueCount: overdueTasks.length,
      completedWeek: completedWeek.length,
      byType,
      escalated: escalatedCount,
    };

    // ── 6. PERSONAL PIPELINE ─────────────────────────────────
    const pipelineByStage = ACTIVE_STAGES.map((stage: string) => {
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

    const totalDeals = activeLeads.length;
    const totalValue = activeLeads.reduce(
      (sum: number, l: any) => sum + (l.estimatedValue || 0),
      0,
    );
    const probableValue = closingLeads.reduce(
      (sum: number, l: any) => sum + (l.estimatedValue || 0),
      0,
    );

    const pipeline = {
      totalDeals,
      totalValue,
      probableValue,
      byStage: pipelineByStage,
    };

    // ── 7. ALERTS ────────────────────────────────────────────
    const alertLeadIds = Array.from(
      new Set(alerts.filter((a: any) => a.leadId).map((a: any) => a.leadId)),
    );
    const alertLeadMap: Record<string, any> = {};
    leads.forEach((l: any) => {
      if (alertLeadIds.includes(l.id)) {
        alertLeadMap[l.id] = l;
      }
    });

    const formattedAlerts = alerts.map((a: any) => {
      const lead = a.leadId ? alertLeadMap[a.leadId] : null;
      return {
        id: a.id,
        type: a.type,
        severity: a.severity,
        title: a.title,
        message: a.message,
        lead: lead ? { id: lead.id, companyName: lead.companyName } : null,
        daysSinceActivity: a.daysSinceActivity ?? null,
        riskOfLoss: a.riskOfLoss ?? null,
        createdAt: a.createdAt?.toISOString() || null,
      };
    });

    // ── 8. PERFORMANCE ───────────────────────────────────────
    const dailyTaskTarget = KPI_TARGETS.calls + KPI_TARGETS.followUps + KPI_TARGETS.quotes + KPI_TARGETS.dealsMoved + KPI_TARGETS.dealsClosed;
    const weeklyTaskTarget = dailyTaskTarget * 5;
    const monthlyTaskTarget = dailyTaskTarget * WORKING_DAYS_PER_MONTH;

    const wonCountMonth = wonLeadsMonth.length;
    const lostCountMonth = lostLeadsMonth.length;
    const conversionRate =
      wonCountMonth + lostCountMonth > 0
        ? Math.round((wonCountMonth / (wonCountMonth + lostCountMonth)) * 100)
        : 0;

    const performance = {
      daily: {
        completed: completedToday.length,
        target: dailyTaskTarget,
        pct: this.pct(completedToday.length, dailyTaskTarget),
      },
      weekly: {
        completed: completedWeek.length,
        target: weeklyTaskTarget,
        pct: this.pct(completedWeek.length, weeklyTaskTarget),
      },
      monthly: {
        completed: completedMonth.length,
        target: monthlyTaskTarget,
        pct: this.pct(completedMonth.length, monthlyTaskTarget),
        wonDeals: wonCountMonth,
        wonAmount: wonAmountMonth,
        lostDeals: lostCountMonth,
        conversionRate,
      },
    };

    // ── 9. ACTIVITY LOG ──────────────────────────────────────
    const activityLog = tasks
      .filter((t: any) => t.status === 'completed' && t.completedAt)
      .sort(
        (a: any, b: any) =>
          new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
      )
      .slice(0, 20)
      .map((t: any) => {
        const lead = t.leadId
          ? leads.find((l: any) => l.id === t.leadId)
          : null;
        return {
          id: t.id,
          type: t.type,
          title: t.title,
          outcome: t.outcome || null,
          completedAt: t.completedAt?.toISOString() || null,
          lead: lead ? { id: lead.id, companyName: lead.companyName } : null,
        };
      });

    // ── 10. AI SUGGESTIONS ───────────────────────────────────
    const aiSuggestions: { icon: string; text: string }[] = [];

    if (overdueTasks.length > 0) {
      const topOverdueValue = overdueTasks
        .filter((t: any) => t.leadId)
        .map((t: any) => {
          const lead = leads.find((l: any) => l.id === t.leadId);
          return lead?.estimatedValue || 0;
        })
        .sort((a: number, b: number) => b - a)[0] || 0;
      aiSuggestions.push({
        icon: '\u26A0\uFE0F',
        text: `Tienes ${overdueTasks.length} tareas vencidas. ${topOverdueValue > 0 ? `La de mayor valor: $${this.fmt(topOverdueValue)}.` : ''} Completa las de mayor valor primero.`,
      });
    }

    if (closingLeads.length > 0) {
      aiSuggestions.push({
        icon: '\uD83C\uDFAF',
        text: `Tienes ${closingLeads.length} deals cerca del cierre por $${this.fmt(probableValue)}. Prioriza seguimiento.`,
      });
    }

    if (dailyCalls === 0) {
      aiSuggestions.push({
        icon: '\uD83D\uDCDE',
        text: `Aun no haces llamadas hoy. Tu meta es ${KPI_TARGETS.calls}.`,
      });
    }

    if (overallScore >= 70) {
      aiSuggestions.push({
        icon: '\uD83D\uDE80',
        text: `Vas al ${overallScore}% de tu meta diaria. Buen ritmo!`,
      });
    }

    // Pipeline health
    const emptyEarlyStages = ['PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR', 'EN_PROSPECCION']
      .filter((stage: string) => {
        const count = leads.filter((l: any) => l.status === stage).length;
        return count === 0;
      });
    if (emptyEarlyStages.length > 0) {
      aiSuggestions.push({
        icon: '\uD83D\uDCA1',
        text: `Tu pipeline tiene etapas iniciales vacias. Considera prospectar nuevos leads para mantener flujo constante.`,
      });
    }

    // General tip if few suggestions
    if (aiSuggestions.length < 3) {
      const inactiveCount = activeLeads.filter(
        (l: any) =>
          l.lastContactedAt &&
          new Date(l.lastContactedAt) < sevenDaysAgo,
      ).length;
      if (inactiveCount > 0) {
        aiSuggestions.push({
          icon: '\u23F0',
          text: `Tienes ${inactiveCount} leads sin contacto en 7+ dias. Reactivarlos puede destrabar oportunidades.`,
        });
      }
    }

    if (aiSuggestions.length < 3) {
      aiSuggestions.push({
        icon: '\uD83D\uDCC8',
        text: `Revisa tu pipeline diariamente. Mover al menos ${KPI_TARGETS.dealsMoved} deals de etapa mantiene tu embudo saludable.`,
      });
    }

    // ── Assemble response ────────────────────────────────────
    return {
      advisor,
      dailyTarget,
      weeklyProgress,
      motivational,
      kpis,
      agenda,
      nextBestActions,
      tasks: tasksSummary,
      pipeline,
      alerts: formattedAlerts,
      performance,
      activityLog,
      aiSuggestions,
    };
  }
}
