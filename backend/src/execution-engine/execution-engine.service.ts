import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PriorityEngineService, ScoredLead } from '../priority-engine/priority-engine.service';

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const DIRECTOR_EMAIL = 'admin@iea.com';
const DIRECTOR_DEAL_THRESHOLD = 500000; // $500K+ deals go to director

const TERMINAL = ['CERRADO_GANADO', 'CERRADO_PERDIDO', 'LEAD_BASURA', 'CONTACTAR_FUTURO'];
const LATE_STAGES = ['COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO'];
const MID_STAGES = ['AGENDAR_CITA', 'ESPERANDO_COTIZACION'];
const EARLY_STAGES = ['PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR', 'EN_PROSPECCION'];

const STATUS_LABELS: Record<string, string> = {
  PENDIENTE_CONTACTAR: 'Pendiente de Contactar',
  INTENTANDO_CONTACTAR: 'Intentando Contactar',
  EN_PROSPECCION: 'En Prospeccion',
  AGENDAR_CITA: 'Agendar Cita',
  ESPERANDO_COTIZACION: 'Esperando Cotizacion',
  COTIZACION_ENTREGADA: 'Cotizacion Entregada',
  ESPERANDO_CONTRATO: 'Esperando Contrato',
  PENDIENTE_PAGO: 'Pendiente de Pago',
};

const TASK_TYPE_CONFIG: Record<string, { label: string; icon: string; defaultChannel: string }> = {
  call: { label: 'Llamada', icon: '📞', defaultChannel: 'phone' },
  whatsapp: { label: 'WhatsApp', icon: '💬', defaultChannel: 'whatsapp' },
  email: { label: 'Email', icon: '📧', defaultChannel: 'email' },
  follow_up: { label: 'Seguimiento', icon: '🔄', defaultChannel: 'whatsapp' },
  reactivation: { label: 'Reactivacion', icon: '🔋', defaultChannel: 'whatsapp' },
  close_deal: { label: 'Cierre', icon: '🤝', defaultChannel: 'phone' },
  escalation: { label: 'Escalacion', icon: '⬆️', defaultChannel: 'phone' },
  visit: { label: 'Visita', icon: '🚗', defaultChannel: 'in_person' },
  send_quote: { label: 'Enviar Cotizacion', icon: '📋', defaultChannel: 'email' },
};

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface GenerationResult {
  totalCreated: number;
  bySource: Record<string, number>;
  byType: Record<string, number>;
  skippedDuplicates: number;
  timestamp: string;
}

export interface EnrichedTask {
  id: string;
  type: string;
  typeLabel: string;
  typeIcon: string;
  title: string;
  description: string | null;
  suggestion: string | null;
  channel: string | null;
  priority: string;
  priorityScore: number;
  status: string;
  dueDate: string;
  source: string;
  alertId: string | null;
  // Lead
  leadId: string | null;
  leadName: string | null;
  leadContact: string | null;
  leadPhone: string | null;
  leadStatus: string | null;
  zone: string | null;
  estimatedValue: number | null;
  // Advisor
  advisorId: string;
  advisorName: string | null;
  // Execution
  outcome: string | null;
  outcomeNotes: string | null;
  pipelineMoved: boolean;
  previousStage: string | null;
  newStage: string | null;
  crmSynced: boolean;
  activityLogged: boolean;
  // Timing
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  isOverdue: boolean;
  hoursUntilDue: number;
}

export interface AdvisorDailyView {
  advisorId: string;
  advisorName: string;
  date: string;
  kpis: {
    totalTasks: number;
    completed: number;
    pending: number;
    inProgress: number;
    overdue: number;
    completionRate: number;
    pipelineMoved: number;
    targetTasks: number;
    progressPct: number;
  };
  tasksByPriority: { critical: EnrichedTask[]; high: EnrichedTask[]; medium: EnrichedTask[]; low: EnrichedTask[] };
  tasksByType: Record<string, EnrichedTask[]>;
  completedToday: EnrichedTask[];
  overdueList: EnrichedTask[];
}

export interface SupervisorControl {
  advisors: Array<{
    id: string;
    name: string;
    totalTasks: number;
    completed: number;
    pending: number;
    overdue: number;
    completionRate: number;
    pipelineMovedCount: number;
    avgCompletionHours: number;
    workloadScore: number; // 0-100
  }>;
  teamKpis: {
    totalTasks: number;
    completed: number;
    pending: number;
    overdue: number;
    teamCompletionRate: number;
    pipelineMovedTotal: number;
    avgWorkload: number;
  };
  criticalPending: EnrichedTask[];
  overdueTasks: EnrichedTask[];
  recentCompletions: EnrichedTask[];
}

export interface ExecutionStats {
  totalTasks: number;
  completed: number;
  pending: number;
  overdue: number;
  completionRate: number;
  byType: Array<{ type: string; label: string; count: number; completed: number; rate: number }>;
  byOutcome: Array<{ outcome: string; count: number }>;
  bySource: Array<{ source: string; count: number }>;
  pipelineMoved: number;
  avgCompletionHours: number;
  effectiveness: number; // % tasks that moved pipeline
}

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

@Injectable()
export class ExecutionEngineService {
  private readonly logger = new Logger(ExecutionEngineService.name);

  constructor(
    private prisma: PrismaService,
    private priorityEngine: PriorityEngineService,
  ) {}

  // ─────────────────────────────────────────────────────────
  // GENERATE TASKS — master orchestrator
  // ─────────────────────────────────────────────────────────

  async generateTasks(): Promise<GenerationResult> {
    const result: GenerationResult = {
      totalCreated: 0,
      bySource: {},
      byType: {},
      skippedDuplicates: 0,
      timestamp: new Date().toISOString(),
    };

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    // Check if already generated today
    const existingToday = await this.prisma.salesTask.count({
      where: { source: { not: 'manual' }, dueDate: { gte: today, lt: tomorrow }, isHistorical: false },
    });

    // Get all active leads scored
    const leads = await this.prisma.lead.findMany({
      where: { deletedAt: null, isHistorical: false, status: { notIn: TERMINAL as any } },
      select: {
        id: true, companyName: true, contactName: true, contactPhone: true,
        zone: true, status: true, source: true, estimatedValue: true,
        lastContactedAt: true, createdAt: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const scored = this.priorityEngine.scoreLeads(leads as any);

    // Get open alerts
    const openAlerts = await this.prisma.salesAlert.findMany({
      where: { status: { in: ['open', 'acknowledged'] } },
      orderBy: { priorityScore: 'desc' },
    });

    // Get advisor workloads for balancing
    const advisorWorkloads = await this.getAdvisorWorkloads();

    // 1. Tasks from alerts
    const alertTasks = await this.generateFromAlerts(openAlerts, scored, today);
    this.accumulateResult(result, alertTasks, 'alert');

    // 2. Tasks from priority engine
    const priorityTasks = await this.generateFromPriority(scored, today, existingToday > 0);
    this.accumulateResult(result, priorityTasks, 'priority_engine');

    // 3. Tasks for stalled deals
    const dealTasks = await this.generateForStalledDeals(scored, today);
    this.accumulateResult(result, dealTasks, 'automation');

    // 4. Tasks for inactive leads
    const inactiveTasks = await this.generateForInactive(scored, today);
    this.accumulateResult(result, inactiveTasks, 'automation');

    // 5. Tasks for high-value opportunities
    const highValueTasks = await this.generateForHighValue(scored, today);
    this.accumulateResult(result, highValueTasks, 'ai');

    // 6. Tasks for director (high-value oversight, escalations, critical deals)
    const directorTasks = await this.generateForDirector(scored, today);
    this.accumulateResult(result, directorTasks, 'director');

    // Mark overdue tasks
    await this.markOverdue();

    return result;
  }

  // ─────────────────────────────────────────────────────────
  // 1. From Alerts
  // ─────────────────────────────────────────────────────────

  private async generateFromAlerts(alerts: any[], scored: ScoredLead[], today: Date): Promise<Array<{ type: string; count: number }>> {
    const created: Array<{ type: string; count: number }> = [];

    for (const alert of alerts.slice(0, 30)) {
      // Check if task already exists for this alert
      const existing = await this.prisma.salesTask.findFirst({
        where: { alertId: alert.id, status: { in: ['pending', 'in_progress'] }, isHistorical: false },
      });
      if (existing) continue;

      const lead = scored.find(l => l.id === alert.leadId);
      const advisorId = alert.advisorId || alert.assignedToId || lead?.assignedTo?.id;
      if (!advisorId) continue;

      const { type, channel } = this.mapAlertToTask(alert.type, alert.recommendedAction);
      const priority = alert.severity === 'critical' ? 'critical' : alert.severity;

      await this.prisma.salesTask.create({
        data: {
          advisorId,
          leadId: alert.leadId,
          type,
          channel,
          title: `[Alerta] ${alert.title}`,
          description: alert.message,
          suggestion: alert.suggestion,
          dueDate: today,
          priority,
          priorityScore: alert.priorityScore || 50,
          source: 'alert',
          alertId: alert.id,
          zone: alert.zone || (lead?.zone as string) || null,
          estimatedValue: alert.estimatedValue || lead?.estimatedValue || null,
          leadStatus: lead?.status || null,
        },
      });
      created.push({ type, count: 1 });
    }

    return created;
  }

  // ─────────────────────────────────────────────────────────
  // 2. From Priority Engine
  // ─────────────────────────────────────────────────────────

  private async generateFromPriority(scored: ScoredLead[], today: Date, alreadyGenerated: boolean): Promise<Array<{ type: string; count: number }>> {
    if (alreadyGenerated) return [];
    const created: Array<{ type: string; count: number }> = [];

    // Top 20 urgent leads that need action today
    const urgent = scored.filter(l => l.urgency === 'critical' || l.urgency === 'high').slice(0, 20);

    for (const lead of urgent) {
      const advisorId = lead.assignedTo?.id;
      if (!advisorId) continue;

      const existing = await this.prisma.salesTask.findFirst({
        where: { leadId: lead.id, advisorId, status: { in: ['pending', 'in_progress'] }, dueDate: { gte: today }, isHistorical: false },
      });
      if (existing) continue;

      const { type, channel, suggestion } = this.determineTaskForLead(lead);

      await this.prisma.salesTask.create({
        data: {
          advisorId,
          leadId: lead.id,
          type,
          channel,
          title: this.buildTaskTitle(type, lead),
          description: `Score: ${lead.score}/20 | Probabilidad: ${Math.round(lead.probability * 100)}% | Urgencia: ${lead.urgency}`,
          suggestion,
          dueDate: today,
          priority: lead.urgency,
          priorityScore: Math.round(lead.score * 5),
          source: 'priority_engine',
          zone: lead.zone,
          estimatedValue: lead.estimatedValue || null,
          leadStatus: lead.status,
        },
      });
      created.push({ type, count: 1 });
    }

    return created;
  }

  // ─────────────────────────────────────────────────────────
  // 3. Stalled Deals
  // ─────────────────────────────────────────────────────────

  private async generateForStalledDeals(scored: ScoredLead[], today: Date): Promise<Array<{ type: string; count: number }>> {
    const created: Array<{ type: string; count: number }> = [];
    const deals = scored.filter(l => [...LATE_STAGES, ...MID_STAGES].includes(l.status));

    for (const deal of deals) {
      const days = deal.daysSinceContact ?? 999;
      const threshold = LATE_STAGES.includes(deal.status) ? 3 : 5;
      if (days < threshold) continue;

      const advisorId = deal.assignedTo?.id;
      if (!advisorId) continue;

      const existing = await this.prisma.salesTask.findFirst({
        where: { leadId: deal.id, type: 'close_deal', status: { in: ['pending', 'in_progress'] }, isHistorical: false },
      });
      if (existing) continue;

      const isPayment = deal.status === 'PENDIENTE_PAGO';
      const isContract = deal.status === 'ESPERANDO_CONTRATO';

      await this.prisma.salesTask.create({
        data: {
          advisorId,
          leadId: deal.id,
          type: 'close_deal',
          channel: 'phone',
          title: `Cerrar: ${deal.companyName} (${STATUS_LABELS[deal.status] || deal.status})`,
          description: `Deal en "${STATUS_LABELS[deal.status]}" — ${days}d sin movimiento. Valor: $${(deal.estimatedValue || 0).toLocaleString('es-MX')}`,
          suggestion: this.buildClosingScript(deal),
          dueDate: today,
          priority: LATE_STAGES.includes(deal.status) ? 'critical' : 'high',
          priorityScore: Math.min(100, days * 6 + (deal.estimatedValue ? Math.round((deal.estimatedValue || 0) / 50000) : 0)),
          source: 'automation',
          zone: deal.zone,
          estimatedValue: deal.estimatedValue || null,
          leadStatus: deal.status,
        },
      });
      created.push({ type: 'close_deal', count: 1 });
    }

    return created;
  }

  // ─────────────────────────────────────────────────────────
  // 4. Inactive Leads
  // ─────────────────────────────────────────────────────────

  private async generateForInactive(scored: ScoredLead[], today: Date): Promise<Array<{ type: string; count: number }>> {
    const created: Array<{ type: string; count: number }> = [];
    const inactive = scored.filter(l => (l.daysSinceContact ?? 999) >= 7 && EARLY_STAGES.includes(l.status));

    for (const lead of inactive.slice(0, 15)) {
      const advisorId = lead.assignedTo?.id;
      if (!advisorId) continue;

      const existing = await this.prisma.salesTask.findFirst({
        where: { leadId: lead.id, type: 'reactivation', status: { in: ['pending', 'in_progress'] }, isHistorical: false },
      });
      if (existing) continue;

      const days = lead.daysSinceContact ?? 0;
      const isHighValue = (lead.estimatedValue || 0) >= 200000;

      await this.prisma.salesTask.create({
        data: {
          advisorId,
          leadId: lead.id,
          type: 'reactivation',
          channel: 'whatsapp',
          title: `Reactivar: ${lead.companyName} (${days}d inactivo)`,
          description: `${days} dias sin contacto. ${isHighValue ? `Alto valor: $${(lead.estimatedValue || 0).toLocaleString('es-MX')}` : ''}`,
          suggestion: this.buildReactivationMessage(lead),
          dueDate: today,
          priority: isHighValue ? 'high' : 'medium',
          priorityScore: Math.min(100, days * 4 + (isHighValue ? 25 : 0)),
          source: 'automation',
          zone: lead.zone,
          estimatedValue: lead.estimatedValue || null,
          leadStatus: lead.status,
        },
      });
      created.push({ type: 'reactivation', count: 1 });
    }

    return created;
  }

  // ─────────────────────────────────────────────────────────
  // 5. High-Value Opportunities
  // ─────────────────────────────────────────────────────────

  private async generateForHighValue(scored: ScoredLead[], today: Date): Promise<Array<{ type: string; count: number }>> {
    const created: Array<{ type: string; count: number }> = [];
    const highValue = scored.filter(l => (l.estimatedValue || 0) >= 300000 && !TERMINAL.includes(l.status));

    for (const lead of highValue) {
      const advisorId = lead.assignedTo?.id;
      if (!advisorId) continue;

      const days = lead.daysSinceContact ?? 999;
      if (days < 3) continue;

      const existing = await this.prisma.salesTask.findFirst({
        where: { leadId: lead.id, status: { in: ['pending', 'in_progress'] }, dueDate: { gte: today }, isHistorical: false },
      });
      if (existing) continue;

      const type = LATE_STAGES.includes(lead.status) ? 'close_deal' : MID_STAGES.includes(lead.status) ? 'follow_up' : 'call';

      await this.prisma.salesTask.create({
        data: {
          advisorId,
          leadId: lead.id,
          type,
          channel: 'phone',
          title: `Alto valor: ${lead.companyName} ($${((lead.estimatedValue || 0) / 1000).toFixed(0)}K)`,
          description: `Oportunidad de alto valor — $${(lead.estimatedValue || 0).toLocaleString('es-MX')}. ${days}d sin contacto. Score: ${lead.score}/20.`,
          suggestion: this.buildHighValueScript(lead),
          dueDate: today,
          priority: 'high',
          priorityScore: Math.min(100, 50 + Math.round((lead.estimatedValue || 0) / 100000)),
          source: 'ai',
          zone: lead.zone,
          estimatedValue: lead.estimatedValue || null,
          leadStatus: lead.status,
        },
      });
      created.push({ type, count: 1 });
    }

    return created;
  }

  // ─────────────────────────────────────────────────────────
  // ADVISOR DAILY VIEW
  // ─────────────────────────────────────────────────────────

  async getAdvisorDailyView(advisorId: string, dateStr?: string): Promise<AdvisorDailyView> {
    const date = dateStr ? new Date(dateStr) : new Date();
    date.setHours(0, 0, 0, 0);
    const nextDay = new Date(date); nextDay.setDate(nextDay.getDate() + 1);

    const advisor = await this.prisma.user.findUnique({
      where: { id: advisorId },
      select: { firstName: true, lastName: true },
    });

    const tasks = await this.prisma.salesTask.findMany({
      where: {
        advisorId,
        isHistorical: false,
        OR: [
          { dueDate: { gte: date, lt: nextDay } },
          { status: { in: ['pending', 'in_progress'] }, dueDate: { lt: date } }, // overdue
        ],
      },
      orderBy: [{ priorityScore: 'desc' }, { dueDate: 'asc' }],
    });

    const enriched = await this.enrichTasks(tasks);
    const now = Date.now();

    const completed = enriched.filter(t => t.status === 'completed');
    const pending = enriched.filter(t => t.status === 'pending');
    const inProgress = enriched.filter(t => t.status === 'in_progress');
    const overdue = enriched.filter(t => t.isOverdue);
    const moved = enriched.filter(t => t.pipelineMoved);

    const targetTasks = 10;

    const byPriority = {
      critical: enriched.filter(t => t.priority === 'critical' && t.status !== 'completed' && t.status !== 'skipped'),
      high: enriched.filter(t => t.priority === 'high' && t.status !== 'completed' && t.status !== 'skipped'),
      medium: enriched.filter(t => t.priority === 'medium' && t.status !== 'completed' && t.status !== 'skipped'),
      low: enriched.filter(t => t.priority === 'low' && t.status !== 'completed' && t.status !== 'skipped'),
    };

    const byType: Record<string, EnrichedTask[]> = {};
    enriched.filter(t => t.status !== 'completed' && t.status !== 'skipped').forEach(t => {
      if (!byType[t.type]) byType[t.type] = [];
      byType[t.type].push(t);
    });

    return {
      advisorId,
      advisorName: advisor ? `${advisor.firstName} ${advisor.lastName}` : 'Unknown',
      date: date.toISOString().split('T')[0],
      kpis: {
        totalTasks: enriched.length,
        completed: completed.length,
        pending: pending.length,
        inProgress: inProgress.length,
        overdue: overdue.length,
        completionRate: enriched.length > 0 ? Math.round((completed.length / enriched.length) * 100) : 0,
        pipelineMoved: moved.length,
        targetTasks,
        progressPct: Math.round((completed.length / targetTasks) * 100),
      },
      tasksByPriority: byPriority,
      tasksByType: byType,
      completedToday: completed,
      overdueList: overdue,
    };
  }

  // ─────────────────────────────────────────────────────────
  // SUPERVISOR CONTROL
  // ─────────────────────────────────────────────────────────

  async getSupervisorControl(): Promise<SupervisorControl> {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const nextDay = new Date(today); nextDay.setDate(nextDay.getDate() + 1);

    const advisors = await this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, firstName: true, lastName: true },
    });

    const advisorStats = await Promise.all(advisors.map(async adv => {
      const tasks = await this.prisma.salesTask.findMany({
        where: { advisorId: adv.id, dueDate: { gte: today, lt: nextDay }, isHistorical: false },
      });

      const allOverdue = await this.prisma.salesTask.count({
        where: { advisorId: adv.id, status: { in: ['pending', 'in_progress'] }, dueDate: { lt: today }, isHistorical: false },
      });

      const completed = tasks.filter(t => t.status === 'completed');
      const pending = tasks.filter(t => ['pending', 'in_progress'].includes(t.status));
      const moved = tasks.filter(t => t.pipelineMoved);

      const completionTimes = completed
        .filter(t => t.completedAt && t.createdAt)
        .map(t => (new Date(t.completedAt!).getTime() - new Date(t.createdAt).getTime()) / 3600000);
      const avgHours = completionTimes.length > 0 ? Math.round(completionTimes.reduce((s, h) => s + h, 0) / completionTimes.length) : 0;

      const totalActive = await this.prisma.lead.count({
        where: { assignedToId: adv.id, deletedAt: null, isHistorical: false, status: { notIn: TERMINAL as any } },
      });

      return {
        id: adv.id,
        name: `${adv.firstName} ${adv.lastName}`,
        totalTasks: tasks.length,
        completed: completed.length,
        pending: pending.length,
        overdue: allOverdue,
        completionRate: tasks.length > 0 ? Math.round((completed.length / tasks.length) * 100) : 0,
        pipelineMovedCount: moved.length,
        avgCompletionHours: avgHours,
        workloadScore: Math.min(100, tasks.length * 8 + allOverdue * 15 + totalActive * 2),
      };
    }));

    const active = advisorStats.filter(a => a.totalTasks > 0 || a.overdue > 0);

    const criticalPending = await this.prisma.salesTask.findMany({
      where: { priority: 'critical', status: { in: ['pending', 'in_progress'] }, isHistorical: false },
      orderBy: { priorityScore: 'desc' },
      take: 20,
    });

    const overdueTasks = await this.prisma.salesTask.findMany({
      where: { status: { in: ['pending', 'in_progress'] }, dueDate: { lt: today }, isHistorical: false },
      orderBy: { priorityScore: 'desc' },
      take: 20,
    });

    const recentCompletions = await this.prisma.salesTask.findMany({
      where: { status: 'completed', completedAt: { gte: today }, isHistorical: false },
      orderBy: { completedAt: 'desc' },
      take: 15,
    });

    const totalTasks = active.reduce((s, a) => s + a.totalTasks, 0);
    const totalCompleted = active.reduce((s, a) => s + a.completed, 0);
    const totalPending = active.reduce((s, a) => s + a.pending, 0);
    const totalOverdue = active.reduce((s, a) => s + a.overdue, 0);

    return {
      advisors: active.sort((a: any, b: any) => b.workloadScore - a.workloadScore),
      teamKpis: {
        totalTasks,
        completed: totalCompleted,
        pending: totalPending,
        overdue: totalOverdue,
        teamCompletionRate: totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0,
        pipelineMovedTotal: active.reduce((s, a) => s + a.pipelineMovedCount, 0),
        avgWorkload: active.length > 0 ? Math.round(active.reduce((s, a) => s + a.workloadScore, 0) / active.length) : 0,
      },
      criticalPending: await this.enrichTasks(criticalPending),
      overdueTasks: await this.enrichTasks(overdueTasks),
      recentCompletions: await this.enrichTasks(recentCompletions),
    };
  }

  // ─────────────────────────────────────────────────────────
  // EXECUTION STATS
  // ─────────────────────────────────────────────────────────

  async getExecutionStats(days = 7): Promise<ExecutionStats> {
    const since = new Date(Date.now() - days * 86400000);

    const tasks = await this.prisma.salesTask.findMany({
      where: { createdAt: { gte: since }, isHistorical: false },
    });

    const completed = tasks.filter(t => t.status === 'completed');
    const pending = tasks.filter(t => ['pending', 'in_progress'].includes(t.status));
    const overdue = tasks.filter(t => ['pending', 'in_progress'].includes(t.status) && new Date(t.dueDate) < new Date());
    const moved = tasks.filter(t => t.pipelineMoved);

    const byType: Record<string, { count: number; completed: number }> = {};
    tasks.forEach(t => {
      if (!byType[t.type]) byType[t.type] = { count: 0, completed: 0 };
      byType[t.type].count++;
      if (t.status === 'completed') byType[t.type].completed++;
    });

    const byOutcome: Record<string, number> = {};
    completed.forEach(t => {
      const o = t.outcome || 'untracked';
      byOutcome[o] = (byOutcome[o] || 0) + 1;
    });

    const bySource: Record<string, number> = {};
    tasks.forEach(t => { bySource[t.source] = (bySource[t.source] || 0) + 1; });

    const completionTimes = completed
      .filter(t => t.completedAt)
      .map(t => (new Date(t.completedAt!).getTime() - new Date(t.createdAt).getTime()) / 3600000);
    const avgHours = completionTimes.length > 0 ? Math.round(completionTimes.reduce((s, h) => s + h, 0) / completionTimes.length) : 0;

    return {
      totalTasks: tasks.length,
      completed: completed.length,
      pending: pending.length,
      overdue: overdue.length,
      completionRate: tasks.length > 0 ? Math.round((completed.length / tasks.length) * 100) : 0,
      byType: Object.entries(byType).map(([type, v]) => ({
        type,
        label: TASK_TYPE_CONFIG[type]?.label || type,
        count: v.count,
        completed: v.completed,
        rate: v.count > 0 ? Math.round((v.completed / v.count) * 100) : 0,
      })).sort((a: any, b: any) => b.count - a.count),
      byOutcome: Object.entries(byOutcome).map(([outcome, count]) => ({ outcome, count })),
      bySource: Object.entries(bySource).map(([source, count]) => ({ source, count })).sort((a: any, b: any) => b.count - a.count),
      pipelineMoved: moved.length,
      avgCompletionHours: avgHours,
      effectiveness: completed.length > 0 ? Math.round((moved.length / completed.length) * 100) : 0,
    };
  }

  // ─────────────────────────────────────────────────────────
  // TASK ACTIONS
  // ─────────────────────────────────────────────────────────

  async startTask(id: string) {
    return this.prisma.salesTask.update({
      where: { id },
      data: { status: 'in_progress', startedAt: new Date() },
    });
  }

  async completeTask(id: string, data: { outcome: string; outcomeNotes?: string; pipelineMoved?: boolean; newStage?: string }) {
    const task = await this.prisma.salesTask.findUnique({ where: { id } });
    return this.prisma.salesTask.update({
      where: { id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        outcome: data.outcome,
        outcomeNotes: data.outcomeNotes,
        pipelineMoved: data.pipelineMoved || false,
        previousStage: task?.leadStatus,
        newStage: data.newStage,
        activityLogged: true,
      },
    });
  }

  async skipTask(id: string, reason?: string) {
    return this.prisma.salesTask.update({
      where: { id },
      data: { status: 'skipped', outcomeNotes: reason || 'Skipped' },
    });
  }

  async reassignTask(id: string, newAdvisorId: string, reassignedBy: string, reason?: string) {
    const task = await this.prisma.salesTask.findUnique({ where: { id } });
    return this.prisma.salesTask.update({
      where: { id },
      data: {
        advisorId: newAdvisorId,
        originalAdvisorId: task?.advisorId,
        reassignedBy,
        reassignReason: reason,
        status: 'reassigned',
      },
    });
  }

  async escalateTask(id: string) {
    return this.prisma.salesTask.update({
      where: { id },
      data: { type: 'escalation', priority: 'critical', priorityScore: 95 },
    });
  }

  async createManualTask(data: {
    advisorId: string; leadId?: string; type: string; title: string;
    description?: string; suggestion?: string; channel?: string;
    priority?: string; dueDate?: string;
  }) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return this.prisma.salesTask.create({
      data: {
        advisorId: data.advisorId,
        leadId: data.leadId || null,
        type: data.type,
        title: data.title,
        description: data.description,
        suggestion: data.suggestion,
        channel: data.channel || TASK_TYPE_CONFIG[data.type]?.defaultChannel || null,
        priority: data.priority || 'medium',
        priorityScore: data.priority === 'critical' ? 90 : data.priority === 'high' ? 70 : 50,
        dueDate: data.dueDate ? new Date(data.dueDate) : today,
        source: 'manual',
      },
    });
  }

  // ─────────────────────────────────────────────────────────
  // 6. Director Tasks
  // ─────────────────────────────────────────────────────────

  private async generateForDirector(scored: ScoredLead[], today: Date): Promise<Array<{ type: string; count: number }>> {
    const created: Array<{ type: string; count: number }> = [];

    // Look up director user
    const director = await this.prisma.user.findFirst({
      where: { email: DIRECTOR_EMAIL, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!director) {
      this.logger.warn('Director user not found (email: ' + DIRECTOR_EMAIL + ')');
      return created;
    }

    const directorId = director.id;

    // A) High-value leads ($500K+) in late stages or inactive 5+ days
    const highValueLate = scored.filter(l =>
      (l.estimatedValue || 0) >= DIRECTOR_DEAL_THRESHOLD &&
      (LATE_STAGES.includes(l.status) || (l.daysSinceContact ?? 0) >= 5),
    );

    for (const lead of highValueLate) {
      const existing = await this.prisma.salesTask.findFirst({
        where: { leadId: lead.id, advisorId: directorId, status: { in: ['pending', 'in_progress'] }, isHistorical: false },
      });
      if (existing) continue;

      const advisorName = lead.assignedTo
        ? `${lead.assignedTo.id}`
        : 'sin asesor';

      // Look up advisor name
      let advisorDisplayName = 'sin asesor';
      if (lead.assignedTo?.id) {
        const adv = await this.prisma.user.findUnique({
          where: { id: lead.assignedTo.id },
          select: { firstName: true, lastName: true },
        });
        if (adv) advisorDisplayName = `${adv.firstName} ${adv.lastName}`;
      }

      const valueK = ((lead.estimatedValue || 0) / 1000).toFixed(0);
      const type = LATE_STAGES.includes(lead.status) ? 'close_deal' : 'call';

      await this.prisma.salesTask.create({
        data: {
          advisorId: directorId,
          leadId: lead.id,
          type,
          channel: 'phone',
          title: `🎯 Director: ${lead.companyName} ($${valueK}K) — ${STATUS_LABELS[lead.status] || lead.status}`,
          description: `Deal de alto valor requiere intervencion directa. $${(lead.estimatedValue || 0).toLocaleString('es-MX')} — ${lead.daysSinceContact ?? 0}d sin contacto.`,
          suggestion: `Intervencion directa requerida: ${lead.companyName} — deal de $${valueK}K en ${STATUS_LABELS[lead.status] || lead.status}. Revisar con asesor ${advisorDisplayName} y llamar personalmente.`,
          dueDate: today,
          priority: 'critical',
          priorityScore: Math.min(100, 80 + Math.round((lead.estimatedValue || 0) / 200000)),
          source: 'director',
          zone: lead.zone,
          estimatedValue: lead.estimatedValue || null,
          leadStatus: lead.status,
        },
      });
      created.push({ type, count: 1 });
    }

    // B) Escalated tasks needing director attention
    const escalated = await this.prisma.salesTask.findMany({
      where: {
        type: 'escalation',
        status: { in: ['pending', 'in_progress'] },
        advisorId: { not: directorId },
        isHistorical: false,
      },
      orderBy: { priorityScore: 'desc' },
      take: 15,
    });

    for (const task of escalated) {
      const existing = await this.prisma.salesTask.findFirst({
        where: { leadId: task.leadId, advisorId: directorId, type: 'escalation', status: { in: ['pending', 'in_progress'] }, isHistorical: false },
      });
      if (existing) continue;

      // Get original advisor name
      let origAdvisorName = 'equipo';
      const origAdvisor = await this.prisma.user.findUnique({
        where: { id: task.advisorId },
        select: { firstName: true, lastName: true },
      });
      if (origAdvisor) origAdvisorName = `${origAdvisor.firstName} ${origAdvisor.lastName}`;

      // Get lead info if available
      let companyName = 'Cliente';
      let taskEstimatedValue = task.estimatedValue;
      if (task.leadId) {
        const taskLead = await this.prisma.lead.findUnique({
          where: { id: task.leadId },
          select: { companyName: true, estimatedValue: true },
        });
        if (taskLead) {
          companyName = taskLead.companyName || 'Cliente';
          taskEstimatedValue = taskEstimatedValue || taskLead.estimatedValue;
        }
      }

      await this.prisma.salesTask.create({
        data: {
          advisorId: directorId,
          leadId: task.leadId,
          type: 'escalation',
          channel: 'phone',
          title: `⬆️ Escalacion: ${companyName}`,
          description: `Tarea escalada por ${origAdvisorName}: ${task.title}`,
          suggestion: `Escalacion: ${companyName} requiere tu atencion. ${task.description || 'Revisar situacion'}. Coordinar con ${origAdvisorName}.`,
          dueDate: today,
          priority: 'critical',
          priorityScore: 95,
          source: 'director',
          zone: task.zone,
          estimatedValue: taskEstimatedValue || null,
          leadStatus: task.leadStatus,
        },
      });
      created.push({ type: 'escalation', count: 1 });
    }

    // C) Critical-risk leads: 60+ days no contact, $200K+ value
    const criticalRisk = scored.filter(l =>
      (l.daysSinceContact ?? 0) >= 60 &&
      (l.estimatedValue || 0) >= 200000,
    );

    for (const lead of criticalRisk) {
      const existing = await this.prisma.salesTask.findFirst({
        where: { leadId: lead.id, advisorId: directorId, status: { in: ['pending', 'in_progress'] }, isHistorical: false },
      });
      if (existing) continue;

      let advisorDisplayName = 'sin asesor';
      if (lead.assignedTo?.id) {
        const adv = await this.prisma.user.findUnique({
          where: { id: lead.assignedTo.id },
          select: { firstName: true, lastName: true },
        });
        if (adv) advisorDisplayName = `${adv.firstName} ${adv.lastName}`;
      }

      const valueK = ((lead.estimatedValue || 0) / 1000).toFixed(0);

      await this.prisma.salesTask.create({
        data: {
          advisorId: directorId,
          leadId: lead.id,
          type: 'call',
          channel: 'phone',
          title: `🚨 Riesgo critico: ${lead.companyName} ($${valueK}K) — ${lead.daysSinceContact}d sin contacto`,
          description: `Lead de alto valor sin contacto por ${lead.daysSinceContact} dias. Riesgo de perdida inminente. Valor: $${(lead.estimatedValue || 0).toLocaleString('es-MX')}.`,
          suggestion: `Intervencion urgente: ${lead.companyName} lleva ${lead.daysSinceContact} dias sin contacto con valor de $${valueK}K. Contactar a ${advisorDisplayName} para entender la situacion y llamar personalmente al cliente.`,
          dueDate: today,
          priority: 'critical',
          priorityScore: 100,
          source: 'director',
          zone: lead.zone,
          estimatedValue: lead.estimatedValue || null,
          leadStatus: lead.status,
        },
      });
      created.push({ type: 'call', count: 1 });
    }

    return created;
  }

  // ─────────────────────────────────────────────────────────
  // DIRECTOR DAILY VIEW
  // ─────────────────────────────────────────────────────────

  async getDirectorDailyView(): Promise<{
    directorId: string;
    directorName: string;
    date: string;
    personalTasks: EnrichedTask[];
    teamOverview: {
      advisors: Array<{ id: string; name: string; pending: number; completed: number; overdue: number; completionRate: number }>;
      teamCompletionRate: number;
      criticalUnattended: number;
    };
    highValueDeals: EnrichedTask[];
    escalations: EnrichedTask[];
    kpis: {
      personalTasks: number;
      personalCompleted: number;
      teamTasks: number;
      teamCompleted: number;
      teamOverdue: number;
      pipelineAtRisk: number;
      closingThisWeek: number;
    };
  }> {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const nextDay = new Date(today); nextDay.setDate(nextDay.getDate() + 1);
    const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + (7 - weekEnd.getDay()));

    // Find director
    const director = await this.prisma.user.findFirst({
      where: { email: DIRECTOR_EMAIL, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    });

    if (!director) {
      throw new Error('Director user not found (email: ' + DIRECTOR_EMAIL + ')');
    }

    const directorId = director.id;

    // Director's own tasks
    const directorTasks = await this.prisma.salesTask.findMany({
      where: {
        advisorId: directorId,
        isHistorical: false,
        OR: [
          { dueDate: { gte: today, lt: nextDay } },
          { status: { in: ['pending', 'in_progress'] }, dueDate: { lt: today } },
        ],
      },
      orderBy: [{ priorityScore: 'desc' }, { dueDate: 'asc' }],
    });

    const personalTasks = await this.enrichTasks(directorTasks);

    // Team overview — get all advisors except director
    const advisors = await this.prisma.user.findMany({
      where: { deletedAt: null, id: { not: directorId } },
      select: { id: true, firstName: true, lastName: true },
    });

    const advisorOverview = await Promise.all(advisors.map(async adv => {
      const todayTasks = await this.prisma.salesTask.findMany({
        where: { advisorId: adv.id, dueDate: { gte: today, lt: nextDay }, isHistorical: false },
        select: { status: true },
      });

      const overdue = await this.prisma.salesTask.count({
        where: { advisorId: adv.id, status: { in: ['pending', 'in_progress'] }, dueDate: { lt: today }, isHistorical: false },
      });

      const completed = todayTasks.filter(t => t.status === 'completed').length;
      const pending = todayTasks.filter(t => ['pending', 'in_progress'].includes(t.status)).length;
      const total = todayTasks.length;

      return {
        id: adv.id,
        name: `${adv.firstName} ${adv.lastName}`,
        pending,
        completed,
        overdue,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      };
    }));

    // Only include advisors with activity
    const activeAdvisors = advisorOverview.filter(a => a.pending > 0 || a.completed > 0 || a.overdue > 0);

    const totalTeamTasks = activeAdvisors.reduce((s, a) => s + a.pending + a.completed, 0);
    const totalTeamCompleted = activeAdvisors.reduce((s, a) => s + a.completed, 0);
    const totalTeamOverdue = activeAdvisors.reduce((s, a) => s + a.overdue, 0);
    const teamCompletionRate = totalTeamTasks > 0 ? Math.round((totalTeamCompleted / totalTeamTasks) * 100) : 0;

    // Critical unattended tasks across team
    const criticalUnattended = await this.prisma.salesTask.count({
      where: {
        priority: 'critical',
        status: 'pending',
        advisorId: { not: directorId },
        isHistorical: false,
      },
    });

    // High-value deal tasks across team
    const highValueRaw = await this.prisma.salesTask.findMany({
      where: {
        estimatedValue: { gte: DIRECTOR_DEAL_THRESHOLD },
        status: { in: ['pending', 'in_progress'] },
        isHistorical: false,
      },
      orderBy: [{ estimatedValue: 'desc' }, { priorityScore: 'desc' }],
      take: 20,
    });
    const highValueDeals = await this.enrichTasks(highValueRaw);

    // Escalation tasks
    const escalationRaw = await this.prisma.salesTask.findMany({
      where: {
        type: 'escalation',
        status: { in: ['pending', 'in_progress'] },
        isHistorical: false,
      },
      orderBy: { priorityScore: 'desc' },
      take: 15,
    });
    const escalations = await this.enrichTasks(escalationRaw);

    // Pipeline at risk: sum of estimatedValue for leads with 30+ days no contact
    const atRiskLeads = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        status: { notIn: TERMINAL as any },
        estimatedValue: { gte: 100000 },
        lastContactedAt: { lt: new Date(Date.now() - 30 * 86400000) },
      },
      select: { estimatedValue: true },
    });
    const pipelineAtRisk = atRiskLeads.reduce((s, l) => s + (l.estimatedValue || 0), 0);

    // Deals expected to close this week (late stages)
    const closingThisWeek = await this.prisma.lead.count({
      where: {
        deletedAt: null,
        status: { in: LATE_STAGES as any },
        lastContactedAt: { gte: new Date(Date.now() - 14 * 86400000) },
      },
    });

    const personalCompleted = personalTasks.filter(t => t.status === 'completed').length;

    return {
      directorId,
      directorName: `${director.firstName} ${director.lastName}`,
      date: today.toISOString().split('T')[0],
      personalTasks,
      teamOverview: {
        advisors: activeAdvisors.sort((a: any, b: any) => b.overdue - a.overdue),
        teamCompletionRate,
        criticalUnattended,
      },
      highValueDeals,
      escalations,
      kpis: {
        personalTasks: personalTasks.length,
        personalCompleted,
        teamTasks: totalTeamTasks,
        teamCompleted: totalTeamCompleted,
        teamOverdue: totalTeamOverdue,
        pipelineAtRisk,
        closingThisWeek,
      },
    };
  }

  // ─────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────

  private async markOverdue() {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    await this.prisma.salesTask.updateMany({
      where: { status: 'pending', dueDate: { lt: now } },
      data: { status: 'overdue' },
    });
  }

  private async getAdvisorWorkloads(): Promise<Map<string, number>> {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tasks = await this.prisma.salesTask.groupBy({
      by: ['advisorId'],
      where: { status: { in: ['pending', 'in_progress'] }, isHistorical: false },
      _count: true,
    });
    return new Map(tasks.map(t => [t.advisorId, t._count]));
  }

  private mapAlertToTask(alertType: string, recommendedAction?: string): { type: string; channel: string } {
    if (recommendedAction === 'call') return { type: 'call', channel: 'phone' };
    if (recommendedAction === 'message') return { type: 'whatsapp', channel: 'whatsapp' };
    if (recommendedAction === 'escalate') return { type: 'escalation', channel: 'phone' };
    if (recommendedAction === 'close') return { type: 'close_deal', channel: 'phone' };

    switch (alertType) {
      case 'no_followup': return { type: 'follow_up', channel: 'whatsapp' };
      case 'stalled_deal': case 'final_stage_stuck': return { type: 'close_deal', channel: 'phone' };
      case 'high_value_no_contact': case 'high_value_unattended': return { type: 'call', channel: 'phone' };
      case 'reactivation': return { type: 'reactivation', channel: 'whatsapp' };
      default: return { type: 'follow_up', channel: 'whatsapp' };
    }
  }

  private determineTaskForLead(lead: ScoredLead): { type: string; channel: string; suggestion: string } {
    const status = lead.status;
    if (['PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR'].includes(status)) {
      return { type: 'call', channel: 'phone', suggestion: this.buildFirstContactScript(lead) };
    }
    if (['EN_PROSPECCION', 'AGENDAR_CITA'].includes(status)) {
      return { type: 'follow_up', channel: 'whatsapp', suggestion: this.buildFollowUpMessage(lead) };
    }
    if (['ESPERANDO_COTIZACION'].includes(status)) {
      return { type: 'send_quote', channel: 'email', suggestion: `Preparar y enviar cotizacion a ${lead.contactName} de ${lead.companyName}.` };
    }
    if (LATE_STAGES.includes(status)) {
      return { type: 'close_deal', channel: 'phone', suggestion: this.buildClosingScript(lead) };
    }
    return { type: 'follow_up', channel: 'whatsapp', suggestion: this.buildFollowUpMessage(lead) };
  }

  private buildTaskTitle(type: string, lead: ScoredLead): string {
    const config = TASK_TYPE_CONFIG[type];
    return `${config?.icon || '📋'} ${config?.label || type}: ${lead.companyName}`;
  }

  private async enrichTasks(tasks: any[]): Promise<EnrichedTask[]> {
    const leadIds = tasks.filter(t => t.leadId).map(t => t.leadId);
    const advisorIds = tasks.map(t => t.advisorId);

    const [leads, users] = await Promise.all([
      leadIds.length > 0 ? this.prisma.lead.findMany({
        where: { id: { in: leadIds } },
        select: { id: true, companyName: true, contactName: true, contactPhone: true, status: true, zone: true },
      }) : [],
      advisorIds.length > 0 ? this.prisma.user.findMany({
        where: { id: { in: [...new Set(advisorIds)] } },
        select: { id: true, firstName: true, lastName: true },
      }) : [],
    ]);

    const leadMap = new Map(leads.map(l => [l.id, l]));
    const userMap = new Map(users.map(u => [u.id, u]));
    const now = Date.now();

    return tasks.map(t => {
      const lead = t.leadId ? leadMap.get(t.leadId) : null;
      const advisor = userMap.get(t.advisorId);
      const dueTime = new Date(t.dueDate).getTime();
      const config = TASK_TYPE_CONFIG[t.type];

      return {
        id: t.id,
        type: t.type,
        typeLabel: config?.label || t.type,
        typeIcon: config?.icon || '📋',
        title: t.title,
        description: t.description,
        suggestion: t.suggestion,
        channel: t.channel,
        priority: t.priority,
        priorityScore: t.priorityScore || 50,
        status: t.status,
        dueDate: t.dueDate.toISOString(),
        source: t.source,
        alertId: t.alertId,
        leadId: t.leadId,
        leadName: lead?.companyName || null,
        leadContact: lead?.contactName || null,
        leadPhone: lead?.contactPhone || null,
        leadStatus: t.leadStatus || lead?.status || null,
        zone: t.zone || lead?.zone || null,
        estimatedValue: t.estimatedValue,
        advisorId: t.advisorId,
        advisorName: advisor ? `${advisor.firstName} ${advisor.lastName}` : null,
        outcome: t.outcome,
        outcomeNotes: t.outcomeNotes,
        pipelineMoved: t.pipelineMoved,
        previousStage: t.previousStage,
        newStage: t.newStage,
        crmSynced: t.crmSynced,
        activityLogged: t.activityLogged,
        startedAt: t.startedAt?.toISOString() || null,
        completedAt: t.completedAt?.toISOString() || null,
        createdAt: t.createdAt.toISOString(),
        isOverdue: ['pending', 'in_progress', 'overdue'].includes(t.status) && dueTime < now,
        hoursUntilDue: Math.round((dueTime - now) / 3600000),
      };
    });
  }

  private buildFirstContactScript(lead: ScoredLead): string {
    const name = lead.contactName?.split(' ')[0] || 'estimado';
    return `Llamar a ${lead.contactName} (${lead.contactPhone || 'sin tel'}). Script: "Hola ${name}, le llamo de Ingenieria Electrica Alanis. Entiendo que ${lead.companyName} esta interesado en soluciones de energia. ¿Tiene unos minutos para platicar sobre como podemos ayudarle?"`;
  }

  private buildFollowUpMessage(lead: ScoredLead): string {
    const name = lead.contactName?.split(' ')[0] || 'estimado';
    return `Hola ${name}, te escribo de IEA para dar seguimiento a tu proyecto con ${lead.companyName}. ¿Tienes disponibilidad esta semana para avanzar? Quedo al pendiente de tu respuesta.`;
  }

  private buildClosingScript(lead: ScoredLead): string {
    const name = lead.contactName?.split(' ')[0] || 'estimado';
    const stage = lead.status;
    if (stage === 'PENDIENTE_PAGO') return `"${name}, ¿pudiste revisar los detalles del pago? Estamos listos para arrancar tu proyecto en cuanto se concrete."`;
    if (stage === 'ESPERANDO_CONTRATO') return `"${name}, ¿revisaste el contrato? Puedo agendar una llamada para aclarar cualquier punto."`;
    return `"${name}, ¿como vas con la decision? Puedo resolver cualquier duda sobre la cotizacion."`;
  }

  private buildReactivationMessage(lead: ScoredLead): string {
    const name = lead.contactName?.split(' ')[0] || 'estimado';
    return `Hola ${name}, ha pasado un tiempo desde nuestro ultimo contacto. En IEA seguimos con tu proyecto${lead.estimatedValue ? ' de energia' : ''}. Tenemos nuevas opciones que podrian interesarte. ¿Te gustaria agendar una llamada?`;
  }

  private buildHighValueScript(lead: ScoredLead): string {
    const name = lead.contactName?.split(' ')[0] || 'estimado';
    return `Llamar a ${name} (${lead.contactPhone || 'sin tel'}). Oportunidad de $${((lead.estimatedValue || 0) / 1000).toFixed(0)}K. Prioridad alta. Preparar propuesta personalizada antes de llamar.`;
  }

  private accumulateResult(result: GenerationResult, tasks: Array<{ type: string; count: number }>, source: string) {
    tasks.forEach(t => {
      result.totalCreated += t.count;
      result.bySource[source] = (result.bySource[source] || 0) + t.count;
      result.byType[t.type] = (result.byType[t.type] || 0) + t.count;
    });
  }
}
