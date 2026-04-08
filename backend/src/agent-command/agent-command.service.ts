import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

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

const DEAL_STAGES = [
  'ESPERANDO_COTIZACION',
  'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO',
  'PENDIENTE_PAGO',
  'CERRADO_GANADO',
  'CERRADO_PERDIDO',
];

const CLOSING_STAGES = [
  'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO',
  'PENDIENTE_PAGO',
];

const fmt = (n: number) =>
  n >= 1e6
    ? `$${(n / 1e6).toFixed(1)}M`
    : n >= 1e3
      ? `$${(n / 1e3).toFixed(0)}K`
      : `$${n}`;

@Injectable()
export class AgentCommandService {
  constructor(private prisma: PrismaService) {}

  async getDashboard() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Fetch all tasks once (avoid N+1)
    const allTasks = (await this.prisma.salesTask.findMany({
      where: { isHistorical: false },
      select: {
        id: true,
        type: true,
        source: true,
        status: true,
        createdAt: true,
        advisorId: true,
        leadId: true,
      },
    })) as any[];

    // Build agentStats
    const agentStats = this.buildAgentStats(allTasks, todayStart, weekStart, monthStart);

    // Build activityFeed
    const activityFeed = await this.buildActivityFeed();

    // Build teamSummary
    const teamSummary = this.buildTeamSummary(agentStats, allTasks, todayStart, weekStart, monthStart);

    // Build directorView
    const directorView = await this.buildDirectorView();

    return {
      agentStats,
      activityFeed,
      teamSummary,
      directorView,
    };
  }

  private buildAgentStats(
    allTasks: any[],
    todayStart: Date,
    weekStart: Date,
    monthStart: Date,
  ) {
    const agents: Record<string, string[]> = {
      'next-action': [],
      'reminder': [],
      'performance': [],
      'supervisor': [],
      'revenue': [],
      'closing': [],
      'customer-success': [],
    };

    const stats: Record<
      string,
      { tasksToday: number; tasksWeek: number; tasksMonth: number; lastActivity: Date | null }
    > = {};

    // Initialize stats for each agent
    for (const agentName of Object.keys(agents)) {
      stats[agentName] = { tasksToday: 0, tasksWeek: 0, tasksMonth: 0, lastActivity: null };
    }

    // Categorize each task
    for (const task of allTasks) {
      const matched: string[] = [];

      // next-action: source='priority_engine' OR type in ['call','follow_up']
      if (
        task.source === 'priority_engine' ||
        task.type === 'call' ||
        task.type === 'follow_up'
      ) {
        matched.push('next-action');
      }

      // reminder: source='alert' OR type='reactivation'
      if (task.source === 'alert' || task.type === 'reactivation') {
        matched.push('reminder');
      }

      // performance: type='escalation'
      if (task.type === 'escalation') {
        matched.push('performance');
      }

      // supervisor: source='automation' AND type='escalation'
      if (task.source === 'automation' && task.type === 'escalation') {
        matched.push('supervisor');
      }

      // revenue: type='send_quote' OR type='close_deal'
      if (task.type === 'send_quote' || task.type === 'close_deal') {
        matched.push('revenue');
      }

      // closing: type='close_deal'
      if (task.type === 'close_deal') {
        matched.push('closing');
      }

      // customer-success: source='automation' AND type='follow_up' for leads with status CERRADO_GANADO
      if (
        task.source === 'automation' &&
        task.type === 'follow_up' &&
        task.leadStatus === 'CERRADO_GANADO'
      ) {
        matched.push('customer-success');
      }

      const createdAt = new Date(task.createdAt);

      for (const agentName of matched) {
        if (createdAt >= todayStart) stats[agentName].tasksToday++;
        if (createdAt >= weekStart) stats[agentName].tasksWeek++;
        if (createdAt >= monthStart) stats[agentName].tasksMonth++;

        if (
          !stats[agentName].lastActivity ||
          createdAt > stats[agentName].lastActivity!
        ) {
          stats[agentName].lastActivity = createdAt;
        }
      }
    }

    return stats;
  }

  private async buildActivityFeed() {
    // Fetch last 50 non-manual tasks
    const tasks = (await this.prisma.salesTask.findMany({
      where: { source: { not: 'manual' }, isHistorical: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        type: true,
        title: true,
        source: true,
        status: true,
        createdAt: true,
        advisorId: true,
        leadId: true,
        priority: true,
      },
    })) as any[];

    // Collect unique advisor and lead IDs
    const advisorIds = [...new Set(tasks.map((t: any) => t.advisorId).filter(Boolean))] as string[];
    const leadIds = [...new Set(tasks.map((t: any) => t.leadId).filter(Boolean))] as string[];

    // Fetch users and leads in parallel
    const [users, leads] = await Promise.all([
      advisorIds.length > 0
        ? (this.prisma.user.findMany({
            where: { id: { in: advisorIds } },
            select: { id: true, firstName: true, lastName: true },
          }) as any)
        : [],
      leadIds.length > 0
        ? (this.prisma.lead.findMany({
            where: { id: { in: leadIds } },
            select: { id: true, companyName: true },
          }) as any)
        : [],
    ]);

    const userMap = new Map<string, string>();
    for (const u of users as any[]) {
      userMap.set(u.id, `${u.firstName} ${u.lastName}`.trim());
    }

    const leadMap = new Map<string, string | null>();
    for (const l of leads as any[]) {
      leadMap.set(l.id, l.companyName);
    }

    return tasks.map((t: any) => ({
      id: t.id,
      type: t.type,
      title: t.title,
      source: t.source,
      status: t.status,
      priority: t.priority,
      createdAt: t.createdAt,
      advisorName: userMap.get(t.advisorId) || 'Unknown',
      companyName: t.leadId ? (leadMap.get(t.leadId) ?? null) : null,
      agentName: this.mapToAgent(t.source, t.type),
    }));
  }

  private buildTeamSummary(
    agentStats: Record<string, { tasksToday: number; tasksWeek: number; tasksMonth: number; lastActivity: Date | null }>,
    allTasks: any[],
    todayStart: Date,
    weekStart: Date,
    monthStart: Date,
  ) {
    const activeToday = Object.values(agentStats).filter(
      (s: any) => s.tasksToday > 0,
    ).length;

    let totalActionsToday = 0;
    let totalActionsWeek = 0;
    let totalActionsMonth = 0;
    const monthAdvisors = new Set<string>();
    const monthLeads = new Set<string>();

    for (const task of allTasks) {
      const createdAt = new Date(task.createdAt);
      if (createdAt >= todayStart) totalActionsToday++;
      if (createdAt >= weekStart) totalActionsWeek++;
      if (createdAt >= monthStart) {
        totalActionsMonth++;
        if (task.advisorId) monthAdvisors.add(task.advisorId);
        if (task.leadId) monthLeads.add(task.leadId);
      }
    }

    return {
      totalAgents: 11,
      activeToday,
      totalActionsToday,
      totalActionsWeek,
      totalActionsMonth,
      advisorsManaged: monthAdvisors.size,
      leadsAffected: monthLeads.size,
    };
  }

  private async buildDirectorView() {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [
      totalActiveLeads,
      totalDeals,
      pipelineAgg,
      dealsAtRisk,
      unassignedLeads,
    ] = await Promise.all([
      this.prisma.lead.count({
        where: {
          deletedAt: null,
          isHistorical: false,
          status: { in: ACTIVE_STAGES as any },
        },
      }),
      this.prisma.lead.count({
        where: {
          deletedAt: null,
          isHistorical: false,
          status: { in: DEAL_STAGES as any },
        },
      }),
      this.prisma.lead.aggregate({
        where: {
          deletedAt: null,
          isHistorical: false,
          status: { in: DEAL_STAGES as any },
          estimatedValue: { not: null },
        },
        _sum: { estimatedValue: true },
      }),
      this.prisma.lead.count({
        where: {
          deletedAt: null,
          isHistorical: false,
          status: { in: CLOSING_STAGES as any },
          OR: [
            { lastContactedAt: { lt: sevenDaysAgo } },
            { lastContactedAt: null },
          ],
        },
      }),
      this.prisma.lead.count({
        where: {
          deletedAt: null,
          isHistorical: false,
          assignedToId: null,
        },
      }),
    ]);

    const rawPipeline = (pipelineAgg as any)._sum?.estimatedValue ?? 0;

    return {
      totalActiveLeads,
      totalDeals,
      pipelineValue: fmt(rawPipeline),
      pipelineValueRaw: rawPipeline,
      dealsAtRisk,
      unassignedLeads,
    };
  }

  private mapToAgent(source: string, type: string): string {
    if (source === 'priority_engine') return 'Next Action Agent';
    if (type === 'close_deal') return 'Closing Agent';
    if (type === 'send_quote') return 'Revenue Agent';
    if (type === 'reactivation') return 'Reminder Agent';
    if (type === 'escalation') return 'Supervisor Agent';
    if (source === 'alert') return 'Performance Agent';
    if (source === 'ai') return 'Director Agent';
    if (type === 'follow_up') return 'Next Action Agent';
    if (type === 'call') return 'Next Action Agent';
    return 'Automation';
  }
}
