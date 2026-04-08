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

const ACTIVE_STAGES = [
  'PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR', 'EN_PROSPECCION',
  'AGENDAR_CITA', 'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO',
];

const STAGE_ORDER: Record<string, number> = {
  PENDIENTE_CONTACTAR: 1, INTENTANDO_CONTACTAR: 2, EN_PROSPECCION: 3,
  AGENDAR_CITA: 4, ESPERANDO_COTIZACION: 5, COTIZACION_ENTREGADA: 6,
  ESPERANDO_CONTRATO: 7, PENDIENTE_PAGO: 8, CERRADO_GANADO: 9,
};

const STAGE_LABELS: Record<string, string> = {
  PENDIENTE_CONTACTAR: 'Pendiente Contactar', INTENTANDO_CONTACTAR: 'Intentando Contactar',
  EN_PROSPECCION: 'En Prospeccion', AGENDAR_CITA: 'Agendar Cita',
  ESPERANDO_COTIZACION: 'Esperando Cotizacion', COTIZACION_ENTREGADA: 'Cotizacion Entregada',
  ESPERANDO_CONTRATO: 'Esperando Contrato', PENDIENTE_PAGO: 'Pendiente de Pago',
  CERRADO_GANADO: 'Cerrado Ganado', CERRADO_PERDIDO: 'Cerrado Perdido',
};

// ═══════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════

export interface ChannelPerformance {
  channel: string;
  tasksSent: number;
  completed: number;
  completionRate: number;
  avgResponseDays: number;
  pipelineMoved: number;
  conversionRate: number;
}

export interface AdvisorPerformance {
  id: string;
  name: string;
  totalDeals: number;
  wonDeals: number;
  lostDeals: number;
  conversionRate: number;
  avgDaysToClose: number;
  pipeline: number;
  tasksCompleted: number;
  tasksOverdue: number;
  disciplineScore: number;
  strengths: string[];
  improvements: string[];
}

export interface StageConversion {
  stage: string;
  label: string;
  dealsEntered: number;
  dealsAdvanced: number;
  dealsLost: number;
  conversionRate: number;
  dropOffRate: number;
  avgDaysInStage: number;
  isBottleneck: boolean;
  recommendation: string;
}

export interface Optimization {
  id: string;
  category: 'scoring' | 'timing' | 'channel' | 'sequence' | 'priority' | 'assignment';
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  confidence: number; // 0-100
  estimatedRevenueLift: number;
  autoApplicable: boolean;
  status: 'suggested' | 'simulated' | 'applied' | 'rejected';
  evidence: string;
  createdAt: Date;
}

export interface Experiment {
  id: string;
  name: string;
  hypothesis: string;
  variantA: string;
  variantB: string;
  metric: string;
  startDate: Date;
  sampleSize: number;
  resultA: number;
  resultB: number;
  winner: 'A' | 'B' | 'inconclusive' | 'running';
  confidence: number;
  status: 'running' | 'completed' | 'stopped';
}

export interface OptimizationAgentResult {
  cycleId: string;
  timestamp: Date;
  patternsDetected: number;
  bottlenecksFound: number;
  optimizationsSuggested: number;
  autoApplied: number;
  insights: string[];
  durationMs: number;
}

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

@Injectable()
export class SelfOptimizationService {
  private readonly logger = new Logger(SelfOptimizationService.name);
  private lastAgentResult: OptimizationAgentResult | null = null;
  private optimizations: Optimization[] = [];
  private experiments: Experiment[] = [];

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────
  // 1. PERFORMANCE ANALYSIS
  // ─────────────────────────────────────────────────────────

  async getPerformanceAnalysis() {
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    const teamIds = await this.getTeamIds();

    // Channel performance from tasks
    const channelPerf = await this.analyzeChannelPerformance(teamIds, ninetyDaysAgo);

    // Advisor performance
    const advisorPerf = await this.analyzeAdvisorPerformance(teamIds, ninetyDaysAgo);

    // Stage conversion funnel
    const stageFunnel = await this.analyzeStageConversions(teamIds, ninetyDaysAgo);

    // Deal velocity
    const velocity = await this.analyzeDealVelocity(teamIds, ninetyDaysAgo);

    // Top findings
    const findings: string[] = [];

    // Best channel
    const bestChannel = channelPerf.reduce((best: any, c: any) => c.conversionRate > best.conversionRate ? c : best, channelPerf[0]);
    if (bestChannel && bestChannel.conversionRate > 0) {
      findings.push(`Mejor canal: ${bestChannel.channel} con ${bestChannel.conversionRate}% conversion (${bestChannel.pipelineMoved} deals avanzados).`);
    }

    // Best advisor
    const bestAdvisor = advisorPerf.filter(a => a.totalDeals >= 5).sort((a: any, b: any) => b.conversionRate - a.conversionRate)[0];
    if (bestAdvisor) {
      findings.push(`Mejor asesor: ${bestAdvisor.name} con ${bestAdvisor.conversionRate}% conversion y ${bestAdvisor.avgDaysToClose}d promedio de cierre.`);
    }

    // Worst bottleneck
    const bottleneck = stageFunnel.find(s => s.isBottleneck);
    if (bottleneck) {
      findings.push(`Cuello de botella: ${bottleneck.label} con ${bottleneck.dropOffRate}% de caida — ${bottleneck.recommendation}`);
    }

    // Velocity insight
    if (velocity.avgDaysToClose > 0) {
      findings.push(`Velocidad promedio de cierre: ${velocity.avgDaysToClose}d. Deals > $200K tardan ${velocity.highValueAvgDays}d en promedio.`);
    }

    return {
      channels: channelPerf,
      advisors: advisorPerf,
      stageFunnel,
      velocity,
      findings,
    };
  }

  private async analyzeChannelPerformance(teamIds: string[], since: Date): Promise<ChannelPerformance[]> {
    const tasks = await this.prisma.salesTask.findMany({
      where: {
        advisorId: { in: teamIds },
        createdAt: { gte: since },
        channel: { not: null },
        isHistorical: false,
      },
      select: { channel: true, status: true, pipelineMoved: true, createdAt: true, completedAt: true },
    });

    const channelMap = new Map<string, { sent: number; completed: number; moved: number; totalDays: number; completedCount: number }>();
    for (const t of tasks) {
      const ch = t.channel || 'unknown';
      const cur = channelMap.get(ch) || { sent: 0, completed: 0, moved: 0, totalDays: 0, completedCount: 0 };
      cur.sent++;
      if (t.status === 'completed') {
        cur.completed++;
        if (t.completedAt && t.createdAt) {
          cur.totalDays += (t.completedAt.getTime() - t.createdAt.getTime()) / 86400000;
          cur.completedCount++;
        }
      }
      if (t.pipelineMoved) cur.moved++;
      channelMap.set(ch, cur);
    }

    return [...channelMap.entries()]
      .map(([channel, s]) => ({
        channel,
        tasksSent: s.sent,
        completed: s.completed,
        completionRate: s.sent > 0 ? Math.round((s.completed / s.sent) * 100) : 0,
        avgResponseDays: s.completedCount > 0 ? Math.round((s.totalDays / s.completedCount) * 10) / 10 : 0,
        pipelineMoved: s.moved,
        conversionRate: s.sent > 0 ? Math.round((s.moved / s.sent) * 100) : 0,
      }))
      .sort((a: any, b: any) => b.conversionRate - a.conversionRate);
  }

  private async analyzeAdvisorPerformance(teamIds: string[], since: Date): Promise<AdvisorPerformance[]> {
    const teamUsers = await this.getTeamUsers();
    const results: AdvisorPerformance[] = [];

    for (const user of teamUsers) {
      // Won/lost deals
      const [won, lost, active] = await Promise.all([
        this.prisma.lead.findMany({
          where: { assignedToId: user.id, status: 'CERRADO_GANADO' as any, convertedAt: { gte: since }, deletedAt: null, isHistorical: false },
          select: { estimatedValue: true, createdAt: true, convertedAt: true },
        }),
        this.prisma.lead.count({
          where: { assignedToId: user.id, status: 'CERRADO_PERDIDO' as any, updatedAt: { gte: since }, deletedAt: null, isHistorical: false },
        }),
        this.prisma.lead.findMany({
          where: { assignedToId: user.id, status: { in: ACTIVE_STAGES as any }, deletedAt: null, isHistorical: false, estimatedValue: { gt: 0 } },
          select: { estimatedValue: true },
        }),
      ]);

      const totalDeals = won.length + lost;
      const conversionRate = totalDeals > 0 ? Math.round((won.length / totalDeals) * 100) : 0;
      const avgDays = won.length > 0
        ? Math.round(won.reduce((s: any, d: any) => s + (d.convertedAt ? (d.convertedAt.getTime() - d.createdAt.getTime()) / 86400000 : 30), 0) / won.length)
        : 0;
      const pipeline = active.reduce((s: any, d: any) => s + (d.estimatedValue || 0), 0);

      // Tasks
      const [tasksCompleted, tasksOverdue] = await Promise.all([
        this.prisma.salesTask.count({ where: { advisorId: user.id, status: 'completed', createdAt: { gte: since }, isHistorical: false } }),
        this.prisma.salesTask.count({ where: { advisorId: user.id, status: { in: ['pending', 'in_progress'] }, dueDate: { lt: new Date() }, isHistorical: false } }),
      ]);

      const discipline = tasksCompleted + tasksOverdue > 0
        ? Math.round((tasksCompleted / (tasksCompleted + tasksOverdue)) * 100)
        : 50;

      // Strengths & improvements
      const strengths: string[] = [];
      const improvements: string[] = [];

      if (conversionRate >= 40) strengths.push('Alta conversion');
      else if (conversionRate < 20 && totalDeals >= 5) improvements.push('Conversion baja — revisar tecnica de cierre');

      if (avgDays > 0 && avgDays <= 30) strengths.push('Cierre rapido');
      else if (avgDays > 60) improvements.push('Ciclo de cierre lento — acelerar seguimiento');

      if (discipline >= 80) strengths.push('Alta disciplina');
      else if (discipline < 50) improvements.push('Muchas tareas vencidas — mejorar ejecucion');

      if (tasksOverdue > 30) improvements.push(`${tasksOverdue} tareas vencidas pendientes`);

      results.push({
        id: user.id,
        name: `${user.firstName} ${user.lastName}`,
        totalDeals, wonDeals: won.length, lostDeals: lost,
        conversionRate, avgDaysToClose: avgDays, pipeline,
        tasksCompleted, tasksOverdue, disciplineScore: discipline,
        strengths, improvements,
      });
    }

    return results.sort((a: any, b: any) => b.conversionRate - a.conversionRate);
  }

  private async analyzeStageConversions(teamIds: string[], since: Date): Promise<StageConversion[]> {
    const now = new Date();

    // Count deals in each stage
    const stageCounts = await Promise.all(
      ACTIVE_STAGES.map(async (stage) => {
        const count = await this.prisma.lead.count({
          where: { status: stage as any, assignedToId: { in: teamIds }, deletedAt: null, isHistorical: false },
        });
        return { stage, count };
      }),
    );

    // Won and lost counts
    const wonCount = await this.prisma.lead.count({
      where: { status: 'CERRADO_GANADO' as any, convertedAt: { gte: since }, assignedToId: { in: teamIds }, deletedAt: null, isHistorical: false },
    });
    const lostCount = await this.prisma.lead.count({
      where: { status: 'CERRADO_PERDIDO' as any, updatedAt: { gte: since }, assignedToId: { in: teamIds }, deletedAt: null, isHistorical: false },
    });

    // Calculate funnel metrics
    const totalLeads = stageCounts.reduce((s: any, c: any) => s + c.count, 0) + wonCount + lostCount;
    const results: StageConversion[] = [];
    let previousCount = totalLeads;

    for (let i = 0; i < ACTIVE_STAGES.length; i++) {
      const stage = ACTIVE_STAGES[i];
      const current = stageCounts[i].count;
      const nextStages = stageCounts.slice(i + 1).reduce((s: any, c: any) => s + c.count, 0) + wonCount;
      const advancedEstimate = nextStages;
      const lostEstimate = Math.round(lostCount * (current / Math.max(totalLeads, 1)));

      const convRate = previousCount > 0 ? Math.round((advancedEstimate / previousCount) * 100) : 0;
      const dropOff = 100 - convRate;

      // Average days in stage (using updatedAt as proxy)
      const stageDeals = await this.prisma.lead.findMany({
        where: { status: stage as any, assignedToId: { in: teamIds }, deletedAt: null },
        select: { updatedAt: true },
        take: 100,
      });
      const avgDays = stageDeals.length > 0
        ? Math.round(stageDeals.reduce((s: any, d: any) => s + (now.getTime() - d.updatedAt.getTime()) / 86400000, 0) / stageDeals.length)
        : 0;

      const isBottleneck = dropOff > 70 && current >= 10;
      let recommendation = 'Mantener proceso actual.';
      if (isBottleneck) {
        if (stage.includes('CONTACTAR')) recommendation = 'Aumentar intentos de contacto. Probar diferentes horarios y canales.';
        else if (stage.includes('PROSPECCION')) recommendation = 'Mejorar calificacion. Enfocar en leads con mayor potencial.';
        else if (stage.includes('CITA')) recommendation = 'Automatizar agendamiento. Reducir friccion.';
        else if (stage.includes('COTIZACION')) recommendation = 'Acelerar entrega de cotizaciones. Seguimiento inmediato.';
        else if (stage.includes('CONTRATO')) recommendation = 'Simplificar proceso de firma. Enviar contrato digital.';
        else if (stage.includes('PAGO')) recommendation = 'Confirmar transferencias diariamente. Ofrecer facilidades.';
      } else if (avgDays > 14) {
        recommendation = `Deals estancados ${avgDays}d promedio. Revisar y empujar o descartar.`;
      }

      results.push({
        stage,
        label: STAGE_LABELS[stage] || stage,
        dealsEntered: previousCount,
        dealsAdvanced: advancedEstimate,
        dealsLost: lostEstimate,
        conversionRate: convRate,
        dropOffRate: dropOff,
        avgDaysInStage: avgDays,
        isBottleneck,
        recommendation,
      });

      previousCount = current;
    }

    return results;
  }

  private async analyzeDealVelocity(teamIds: string[], since: Date) {
    const wonDeals = await this.prisma.lead.findMany({
      where: {
        status: 'CERRADO_GANADO' as any,
        convertedAt: { gte: since },
        assignedToId: { in: teamIds },
        deletedAt: null,
        isHistorical: false,
      },
      select: { estimatedValue: true, createdAt: true, convertedAt: true },
    });

    const allDays = wonDeals
      .filter(d => d.convertedAt)
      .map(d => (d.convertedAt!.getTime() - d.createdAt.getTime()) / 86400000);

    const highValue = wonDeals
      .filter(d => d.convertedAt && (d.estimatedValue || 0) >= 200_000)
      .map(d => (d.convertedAt!.getTime() - d.createdAt.getTime()) / 86400000);

    const lowValue = wonDeals
      .filter(d => d.convertedAt && (d.estimatedValue || 0) < 200_000)
      .map(d => (d.convertedAt!.getTime() - d.createdAt.getTime()) / 86400000);

    return {
      totalWon: wonDeals.length,
      avgDaysToClose: allDays.length > 0 ? Math.round(allDays.reduce((s: any, d: any) => s + d, 0) / allDays.length) : 0,
      medianDaysToClose: allDays.length > 0 ? Math.round(allDays.sort((a: any, b: any) => a - b)[Math.floor(allDays.length / 2)]) : 0,
      highValueAvgDays: highValue.length > 0 ? Math.round(highValue.reduce((s: any, d: any) => s + d, 0) / highValue.length) : 0,
      lowValueAvgDays: lowValue.length > 0 ? Math.round(lowValue.reduce((s: any, d: any) => s + d, 0) / lowValue.length) : 0,
      fastestClose: allDays.length > 0 ? Math.round(Math.min(...allDays)) : 0,
      slowestClose: allDays.length > 0 ? Math.round(Math.max(...allDays)) : 0,
    };
  }

  // ─────────────────────────────────────────────────────────
  // 2. REVENUE-BASED LEARNING ENGINE
  // ─────────────────────────────────────────────────────────

  async getLearningInsights() {
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);
    const teamIds = await this.getTeamIds();

    // What generates revenue — tasks that moved pipeline on won deals
    const revenueTasks = await this.prisma.salesTask.findMany({
      where: {
        advisorId: { in: teamIds },
        pipelineMoved: true,
        status: 'completed',
        createdAt: { gte: ninetyDaysAgo },
        isHistorical: false,
      },
      select: { type: true, channel: true, priority: true, estimatedValue: true },
    });

    // Revenue by task type
    const typeRevenue = new Map<string, { count: number; value: number }>();
    for (const t of revenueTasks) {
      const cur = typeRevenue.get(t.type) || { count: 0, value: 0 };
      cur.count++;
      cur.value += t.estimatedValue || 0;
      typeRevenue.set(t.type, cur);
    }

    // Revenue by channel
    const channelRevenue = new Map<string, { count: number; value: number }>();
    for (const t of revenueTasks) {
      const ch = t.channel || 'unknown';
      const cur = channelRevenue.get(ch) || { count: 0, value: 0 };
      cur.count++;
      cur.value += t.estimatedValue || 0;
      channelRevenue.set(ch, cur);
    }

    // Priority effectiveness
    const priorityEff = new Map<string, { total: number; moved: number }>();
    const allTasks = await this.prisma.salesTask.findMany({
      where: { advisorId: { in: teamIds }, status: 'completed', createdAt: { gte: ninetyDaysAgo }, isHistorical: false },
      select: { priority: true, pipelineMoved: true },
    });
    for (const t of allTasks) {
      const cur = priorityEff.get(t.priority) || { total: 0, moved: 0 };
      cur.total++;
      if (t.pipelineMoved) cur.moved++;
      priorityEff.set(t.priority, cur);
    }

    // Won deals characteristics
    const wonDeals = await this.prisma.lead.findMany({
      where: {
        status: 'CERRADO_GANADO' as any,
        convertedAt: { gte: ninetyDaysAgo },
        assignedToId: { in: teamIds },
        deletedAt: null,
        isHistorical: false,
      },
      select: { estimatedValue: true, zone: true, industry: true, source: true, createdAt: true, convertedAt: true },
    });

    // Best-performing zones for won deals
    const zoneWins = new Map<string, { count: number; revenue: number }>();
    for (const d of wonDeals) {
      const cur = zoneWins.get(d.zone) || { count: 0, revenue: 0 };
      cur.count++;
      cur.revenue += d.estimatedValue || 0;
      zoneWins.set(d.zone, cur);
    }

    // Best-performing sources
    const sourceWins = new Map<string, { count: number; revenue: number }>();
    for (const d of wonDeals) {
      const cur = sourceWins.get(d.source) || { count: 0, revenue: 0 };
      cur.count++;
      cur.revenue += d.estimatedValue || 0;
      sourceWins.set(d.source, cur);
    }

    // Generate learning insights
    const learnings: string[] = [];

    const bestType = [...typeRevenue.entries()].sort((a: any, b: any) => b[1].value - a[1].value)[0];
    if (bestType) learnings.push(`Tipo de tarea mas efectivo para revenue: "${bestType[0]}" con $${this.fmt(bestType[1].value)} generado (${bestType[1].count} acciones).`);

    const bestCh = [...channelRevenue.entries()].sort((a: any, b: any) => b[1].value - a[1].value)[0];
    if (bestCh) learnings.push(`Canal mas rentable: ${bestCh[0]} — $${this.fmt(bestCh[1].value)} en deals avanzados.`);

    for (const [priority, stats] of priorityEff) {
      const rate = stats.total > 0 ? Math.round((stats.moved / stats.total) * 100) : 0;
      if (rate > 0) learnings.push(`Prioridad "${priority}": ${rate}% de tareas mueven pipeline (${stats.moved}/${stats.total}).`);
    }

    const bestZone = [...zoneWins.entries()].sort((a: any, b: any) => b[1].revenue - a[1].revenue)[0];
    if (bestZone) learnings.push(`Zona con mas cierres: ${bestZone[0]} — ${bestZone[1].count} deals, $${this.fmt(bestZone[1].revenue)}.`);

    return {
      revenueByTaskType: [...typeRevenue.entries()].map(([type, s]) => ({ type, ...s })).sort((a: any, b: any) => b.value - a.value),
      revenueByChannel: [...channelRevenue.entries()].map(([channel, s]) => ({ channel, ...s })).sort((a: any, b: any) => b.value - a.value),
      priorityEffectiveness: [...priorityEff.entries()].map(([priority, s]) => ({
        priority,
        total: s.total,
        moved: s.moved,
        effectivenessRate: s.total > 0 ? Math.round((s.moved / s.total) * 100) : 0,
      })),
      winningZones: [...zoneWins.entries()].map(([zone, s]) => ({ zone, ...s })).sort((a: any, b: any) => b.revenue - a.revenue),
      winningSources: [...sourceWins.entries()].map(([source, s]) => ({ source, ...s })).sort((a: any, b: any) => b.revenue - a.revenue),
      totalRevenueActions: revenueTasks.length,
      learnings,
    };
  }

  // ─────────────────────────────────────────────────────────
  // 3. OPTIMIZATION AGENT
  // ─────────────────────────────────────────────────────────

  @Cron('0 0 6 * * 1') // Monday 6am — weekly optimization analysis
  async runOptimizationAgent(): Promise<OptimizationAgentResult> {
    const start = Date.now();
    const cycleId = `optim-${Date.now()}`;
    this.logger.log(`[Optimization Agent] Cycle ${cycleId} starting...`);

    const now = new Date();
    const teamIds = await this.getTeamIds();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);

    let patternsDetected = 0;
    let bottlenecksFound = 0;
    let optimizationsSuggested = 0;
    let autoApplied = 0;
    const insights: string[] = [];
    const newOptimizations: Optimization[] = [];

    // ── Pattern Detection ──

    // 1. Channel optimization
    const channels = await this.analyzeChannelPerformance(teamIds, ninetyDaysAgo);
    const bestChannel = channels[0];
    const worstChannel = channels[channels.length - 1];

    if (bestChannel && worstChannel && channels.length >= 2) {
      if (bestChannel.conversionRate > worstChannel.conversionRate * 2 && worstChannel.tasksSent >= 20) {
        patternsDetected++;
        const opt: Optimization = {
          id: `opt-ch-${Date.now()}`,
          category: 'channel',
          title: `Priorizar ${bestChannel.channel} sobre ${worstChannel.channel}`,
          description: `${bestChannel.channel} convierte al ${bestChannel.conversionRate}% vs ${worstChannel.channel} al ${worstChannel.conversionRate}%. Redirigir secuencias de follow-up al canal mas efectivo.`,
          impact: 'high',
          confidence: Math.min(95, bestChannel.tasksSent),
          estimatedRevenueLift: 0,
          autoApplicable: false,
          status: 'suggested',
          evidence: `Basado en ${bestChannel.tasksSent + worstChannel.tasksSent} tareas en los ultimos 90 dias.`,
          createdAt: now,
        };
        newOptimizations.push(opt);
        optimizationsSuggested++;
        insights.push(`Canal ${bestChannel.channel} supera a ${worstChannel.channel} por ${bestChannel.conversionRate - worstChannel.conversionRate}pp en conversion.`);
      }
    }

    // 2. Stage bottleneck detection
    const funnel = await this.analyzeStageConversions(teamIds, ninetyDaysAgo);
    const bottlenecks = funnel.filter(s => s.isBottleneck);
    bottlenecksFound = bottlenecks.length;

    for (const bn of bottlenecks) {
      patternsDetected++;
      newOptimizations.push({
        id: `opt-bn-${bn.stage}-${Date.now()}`,
        category: 'sequence',
        title: `Optimizar conversion en ${bn.label}`,
        description: `${bn.label} pierde ${bn.dropOffRate}% de deals con ${bn.avgDaysInStage}d promedio en etapa. ${bn.recommendation}`,
        impact: bn.dropOffRate > 80 ? 'high' : 'medium',
        confidence: Math.min(90, bn.dealsEntered),
        estimatedRevenueLift: 0,
        autoApplicable: false,
        status: 'suggested',
        evidence: `${bn.dealsEntered} deals entraron, solo ${bn.dealsAdvanced} avanzaron.`,
        createdAt: now,
      });
      optimizationsSuggested++;
      insights.push(`Bottleneck: ${bn.label} — ${bn.dropOffRate}% drop-off, ${bn.avgDaysInStage}d promedio.`);
    }

    // 3. Advisor coaching opportunities
    const advisors = await this.analyzeAdvisorPerformance(teamIds, ninetyDaysAgo);
    const avgConversion = advisors.length > 0
      ? advisors.reduce((s: any, a: any) => s + a.conversionRate, 0) / advisors.length
      : 0;

    for (const a of advisors) {
      if (a.conversionRate < avgConversion * 0.5 && a.totalDeals >= 10) {
        patternsDetected++;
        newOptimizations.push({
          id: `opt-adv-${a.id}-${Date.now()}`,
          category: 'assignment',
          title: `Coaching para ${a.name}`,
          description: `Conversion de ${a.name} (${a.conversionRate}%) esta ${Math.round(avgConversion - a.conversionRate)}pp debajo del promedio (${Math.round(avgConversion)}%). ${a.improvements.join('. ')}`,
          impact: 'medium',
          confidence: 75,
          estimatedRevenueLift: 0,
          autoApplicable: false,
          status: 'suggested',
          evidence: `${a.totalDeals} deals, ${a.wonDeals} ganados, ${a.lostDeals} perdidos.`,
          createdAt: now,
        });
        optimizationsSuggested++;
      }
    }

    // 4. Follow-up timing optimization
    const completedTasks = await this.prisma.salesTask.findMany({
      where: {
        advisorId: { in: teamIds },
        status: 'completed',
        createdAt: { gte: ninetyDaysAgo },
        completedAt: { not: null },
        isHistorical: false,
      },
      select: { createdAt: true, completedAt: true, pipelineMoved: true },
    });

    if (completedTasks.length >= 50) {
      const fastTasks = completedTasks.filter(t => {
        const hours = (t.completedAt!.getTime() - t.createdAt.getTime()) / 3600000;
        return hours <= 24;
      });
      const slowTasks = completedTasks.filter(t => {
        const hours = (t.completedAt!.getTime() - t.createdAt.getTime()) / 3600000;
        return hours > 48;
      });

      const fastRate = fastTasks.length > 0 ? fastTasks.filter(t => t.pipelineMoved).length / fastTasks.length : 0;
      const slowRate = slowTasks.length > 0 ? slowTasks.filter(t => t.pipelineMoved).length / slowTasks.length : 0;

      if (fastRate > slowRate * 1.5 && fastTasks.length >= 20) {
        patternsDetected++;
        insights.push(`Tareas completadas en <24h mueven pipeline ${Math.round(fastRate * 100)}% vs ${Math.round(slowRate * 100)}% cuando tardan >48h. Velocidad de ejecucion importa.`);
        newOptimizations.push({
          id: `opt-timing-${Date.now()}`,
          category: 'timing',
          title: 'Priorizar ejecucion rapida de tareas',
          description: `Las tareas ejecutadas en menos de 24h convierten ${Math.round((fastRate / Math.max(slowRate, 0.01)) * 100)}% mas que las que tardan 48h+. Reducir tiempos de respuesta.`,
          impact: 'high',
          confidence: Math.min(90, fastTasks.length),
          estimatedRevenueLift: 0,
          autoApplicable: true,
          status: 'suggested',
          evidence: `${fastTasks.length} tareas rapidas, ${slowTasks.length} tareas lentas analizadas.`,
          createdAt: now,
        });
        optimizationsSuggested++;
      }
    }

    // 5. High-value lead under-contact detection
    const highValueInactive = await this.prisma.lead.count({
      where: {
        status: { in: ACTIVE_STAGES as any },
        assignedToId: { in: teamIds },
        estimatedValue: { gte: 200_000 },
        lastContactedAt: { lt: new Date(now.getTime() - 5 * 86400000) },
        deletedAt: null,
      },
    });

    if (highValueInactive > 10) {
      patternsDetected++;
      insights.push(`${highValueInactive} leads de alto valor ($200K+) sin contacto en 5+ dias. Revenue en riesgo por inactividad.`);
      newOptimizations.push({
        id: `opt-hvl-${Date.now()}`,
        category: 'priority',
        title: 'Aumentar prioridad de leads de alto valor',
        description: `${highValueInactive} leads de $200K+ estan sin contactar. Ajustar prioridad automatica para que estos leads siempre aparezcan al tope de la cola de trabajo.`,
        impact: 'high',
        confidence: 85,
        estimatedRevenueLift: 0,
        autoApplicable: true,
        status: 'suggested',
        evidence: `${highValueInactive} leads con estimatedValue >= $200K y lastContactedAt > 5 dias.`,
        createdAt: now,
      });
      optimizationsSuggested++;
    }

    // Store optimizations
    this.optimizations = [...newOptimizations, ...this.optimizations].slice(0, 50);

    const duration = Date.now() - start;
    this.lastAgentResult = {
      cycleId,
      timestamp: now,
      patternsDetected,
      bottlenecksFound,
      optimizationsSuggested,
      autoApplied,
      insights,
      durationMs: duration,
    };

    this.logger.log(
      `[Optimization Agent] Cycle complete: ${patternsDetected} patterns, ${bottlenecksFound} bottlenecks, ${optimizationsSuggested} optimizations (${duration}ms)`,
    );

    return this.lastAgentResult;
  }

  getLastAgentResult() {
    return this.lastAgentResult;
  }

  // ─────────────────────────────────────────────────────────
  // 4. AUTO-ADJUSTMENT SYSTEM
  // ─────────────────────────────────────────────────────────

  getOptimizations() {
    return this.optimizations;
  }

  applyOptimization(optimizationId: string) {
    const opt = this.optimizations.find(o => o.id === optimizationId);
    if (!opt) return { error: 'Optimization not found' };
    opt.status = 'applied';
    return { message: `Optimization "${opt.title}" applied.`, optimization: opt };
  }

  rejectOptimization(optimizationId: string) {
    const opt = this.optimizations.find(o => o.id === optimizationId);
    if (!opt) return { error: 'Optimization not found' };
    opt.status = 'rejected';
    return { message: `Optimization "${opt.title}" rejected.`, optimization: opt };
  }

  // ─────────────────────────────────────────────────────────
  // 5. EXPERIMENTATION ENGINE
  // ─────────────────────────────────────────────────────────

  async getExperiments() {
    // Generate experiments from real data patterns
    const now = new Date();
    const teamIds = await this.getTeamIds();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);

    // Channel experiment: phone vs whatsapp
    const phoneTasks = await this.prisma.salesTask.count({
      where: { channel: 'phone', status: 'completed', pipelineMoved: true, advisorId: { in: teamIds }, createdAt: { gte: ninetyDaysAgo }, isHistorical: false },
    });
    const phoneTotalTasks = await this.prisma.salesTask.count({
      where: { channel: 'phone', status: 'completed', advisorId: { in: teamIds }, createdAt: { gte: ninetyDaysAgo }, isHistorical: false },
    });
    const waTasks = await this.prisma.salesTask.count({
      where: { channel: 'whatsapp', status: 'completed', pipelineMoved: true, advisorId: { in: teamIds }, createdAt: { gte: ninetyDaysAgo }, isHistorical: false },
    });
    const waTotalTasks = await this.prisma.salesTask.count({
      where: { channel: 'whatsapp', status: 'completed', advisorId: { in: teamIds }, createdAt: { gte: ninetyDaysAgo }, isHistorical: false },
    });

    const phoneRate = phoneTotalTasks > 0 ? Math.round((phoneTasks / phoneTotalTasks) * 100) : 0;
    const waRate = waTotalTasks > 0 ? Math.round((waTasks / waTotalTasks) * 100) : 0;

    const experiments: Experiment[] = [
      {
        id: 'exp-channel-001',
        name: 'Telefono vs WhatsApp — Primer Contacto',
        hypothesis: 'Las llamadas telefonicas generan mayor avance de pipeline que WhatsApp en primer contacto.',
        variantA: 'Llamada telefonica',
        variantB: 'WhatsApp',
        metric: 'Pipeline moved rate',
        startDate: ninetyDaysAgo,
        sampleSize: phoneTotalTasks + waTotalTasks,
        resultA: phoneRate,
        resultB: waRate,
        winner: phoneRate > waRate + 5 ? 'A' : waRate > phoneRate + 5 ? 'B' : (phoneTotalTasks + waTotalTasks < 40 ? 'running' : 'inconclusive'),
        confidence: Math.min(95, Math.round((phoneTotalTasks + waTotalTasks) / 2)),
        status: phoneTotalTasks + waTotalTasks >= 40 ? 'completed' : 'running',
      },
    ];

    // Task type experiment: follow_up vs close_deal
    const fuMoved = await this.prisma.salesTask.count({
      where: { type: 'follow_up', status: 'completed', pipelineMoved: true, advisorId: { in: teamIds }, createdAt: { gte: ninetyDaysAgo }, isHistorical: false },
    });
    const fuTotal = await this.prisma.salesTask.count({
      where: { type: 'follow_up', status: 'completed', advisorId: { in: teamIds }, createdAt: { gte: ninetyDaysAgo }, isHistorical: false },
    });
    const cdMoved = await this.prisma.salesTask.count({
      where: { type: 'close_deal', status: 'completed', pipelineMoved: true, advisorId: { in: teamIds }, createdAt: { gte: ninetyDaysAgo }, isHistorical: false },
    });
    const cdTotal = await this.prisma.salesTask.count({
      where: { type: 'close_deal', status: 'completed', advisorId: { in: teamIds }, createdAt: { gte: ninetyDaysAgo }, isHistorical: false },
    });

    const fuRate = fuTotal > 0 ? Math.round((fuMoved / fuTotal) * 100) : 0;
    const cdRate = cdTotal > 0 ? Math.round((cdMoved / cdTotal) * 100) : 0;

    experiments.push({
      id: 'exp-type-001',
      name: 'Follow-Up vs Close Deal — Efectividad',
      hypothesis: 'Las tareas de tipo "close_deal" avanzan mas pipeline que los follow-ups genericos.',
      variantA: 'Follow-Up',
      variantB: 'Close Deal',
      metric: 'Pipeline moved rate',
      startDate: ninetyDaysAgo,
      sampleSize: fuTotal + cdTotal,
      resultA: fuRate,
      resultB: cdRate,
      winner: cdRate > fuRate + 5 ? 'B' : fuRate > cdRate + 5 ? 'A' : (fuTotal + cdTotal < 20 ? 'running' : 'inconclusive'),
      confidence: Math.min(90, Math.round((fuTotal + cdTotal) / 2)),
      status: fuTotal + cdTotal >= 20 ? 'completed' : 'running',
    });

    // Speed experiment
    const fast = await this.prisma.salesTask.findMany({
      where: { status: 'completed', completedAt: { not: null }, advisorId: { in: teamIds }, createdAt: { gte: ninetyDaysAgo }, isHistorical: false },
      select: { createdAt: true, completedAt: true, pipelineMoved: true },
    });

    const under24h = fast.filter(t => (t.completedAt!.getTime() - t.createdAt.getTime()) / 3600000 <= 24);
    const over48h = fast.filter(t => (t.completedAt!.getTime() - t.createdAt.getTime()) / 3600000 > 48);
    const u24Rate = under24h.length > 0 ? Math.round((under24h.filter(t => t.pipelineMoved).length / under24h.length) * 100) : 0;
    const o48Rate = over48h.length > 0 ? Math.round((over48h.filter(t => t.pipelineMoved).length / over48h.length) * 100) : 0;

    experiments.push({
      id: 'exp-speed-001',
      name: 'Velocidad de Ejecucion — <24h vs >48h',
      hypothesis: 'Ejecutar tareas en menos de 24h genera mejor resultado que esperar mas de 48h.',
      variantA: 'Ejecucion < 24h',
      variantB: 'Ejecucion > 48h',
      metric: 'Pipeline moved rate',
      startDate: ninetyDaysAgo,
      sampleSize: under24h.length + over48h.length,
      resultA: u24Rate,
      resultB: o48Rate,
      winner: u24Rate > o48Rate + 5 ? 'A' : o48Rate > u24Rate + 5 ? 'B' : 'inconclusive',
      confidence: Math.min(90, Math.round((under24h.length + over48h.length) / 3)),
      status: under24h.length + over48h.length >= 30 ? 'completed' : 'running',
    });

    this.experiments = experiments;
    return experiments;
  }

  // ─────────────────────────────────────────────────────────
  // 6. CONTINUOUS FEEDBACK LOOP
  // ─────────────────────────────────────────────────────────

  async getFeedbackLoopStatus() {
    const now = new Date();
    const teamIds = await this.getTeamIds();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 86400000);

    // Compare metrics between last 30d vs previous 30d
    const [recentWon, olderWon, recentLost, olderLost] = await Promise.all([
      this.prisma.lead.count({ where: { status: 'CERRADO_GANADO' as any, convertedAt: { gte: thirtyDaysAgo }, assignedToId: { in: teamIds }, deletedAt: null, isHistorical: false } }),
      this.prisma.lead.count({ where: { status: 'CERRADO_GANADO' as any, convertedAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo }, assignedToId: { in: teamIds }, deletedAt: null, isHistorical: false } }),
      this.prisma.lead.count({ where: { status: 'CERRADO_PERDIDO' as any, updatedAt: { gte: thirtyDaysAgo }, assignedToId: { in: teamIds }, deletedAt: null, isHistorical: false } }),
      this.prisma.lead.count({ where: { status: 'CERRADO_PERDIDO' as any, updatedAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo }, assignedToId: { in: teamIds }, deletedAt: null, isHistorical: false } }),
    ]);

    const recentRate = recentWon + recentLost > 0 ? Math.round((recentWon / (recentWon + recentLost)) * 100) : 0;
    const olderRate = olderWon + olderLost > 0 ? Math.round((olderWon / (olderWon + olderLost)) * 100) : 0;

    // Task completion trend
    const [recentCompleted, olderCompleted] = await Promise.all([
      this.prisma.salesTask.count({ where: { status: 'completed', advisorId: { in: teamIds }, completedAt: { gte: thirtyDaysAgo }, isHistorical: false } }),
      this.prisma.salesTask.count({ where: { status: 'completed', advisorId: { in: teamIds }, completedAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo }, isHistorical: false } }),
    ]);

    const isImproving = recentRate > olderRate || recentCompleted > olderCompleted * 1.1;

    return {
      winRate: { recent: recentRate, previous: olderRate, trend: recentRate - olderRate },
      taskCompletion: { recent: recentCompleted, previous: olderCompleted, trend: olderCompleted > 0 ? Math.round(((recentCompleted - olderCompleted) / olderCompleted) * 100) : 0 },
      systemStatus: isImproving ? 'improving' : recentRate === olderRate ? 'stable' : 'declining',
      optimizationsApplied: this.optimizations.filter(o => o.status === 'applied').length,
      optimizationsPending: this.optimizations.filter(o => o.status === 'suggested').length,
      experimentsCompleted: this.experiments.filter(e => e.status === 'completed').length,
      lastOptimizationCycle: this.lastAgentResult?.timestamp || null,
    };
  }

  // ─────────────────────────────────────────────────────────
  // 7. DIRECTOR INSIGHTS
  // ─────────────────────────────────────────────────────────

  async getDirectorInsights() {
    const perf = await this.getPerformanceAnalysis();
    const learning = await this.getLearningInsights();
    const feedback = await this.getFeedbackLoopStatus();

    const weeklyInsights: string[] = [];

    // Win rate trend
    if (feedback.winRate.trend > 5) {
      weeklyInsights.push(`Win rate mejoro ${feedback.winRate.trend}pp (de ${feedback.winRate.previous}% a ${feedback.winRate.recent}%).`);
    } else if (feedback.winRate.trend < -5) {
      weeklyInsights.push(`ALERTA: Win rate cayo ${Math.abs(feedback.winRate.trend)}pp (de ${feedback.winRate.previous}% a ${feedback.winRate.recent}%).`);
    }

    // Bottleneck summary
    const bottlenecks = perf.stageFunnel.filter(s => s.isBottleneck);
    if (bottlenecks.length > 0) {
      weeklyInsights.push(`${bottlenecks.length} cuellos de botella detectados: ${bottlenecks.map(b => `${b.label} (${b.dropOffRate}% caida)`).join(', ')}.`);
    }

    // Top advisor insights
    const topAdvisor = perf.advisors[0];
    const bottomAdvisor = perf.advisors[perf.advisors.length - 1];
    if (topAdvisor && bottomAdvisor && perf.advisors.length >= 3) {
      weeklyInsights.push(`Mejor asesor: ${topAdvisor.name} (${topAdvisor.conversionRate}% conversion). Necesita coaching: ${bottomAdvisor.name} (${bottomAdvisor.conversionRate}%).`);
    }

    // Revenue learnings
    for (const l of learning.learnings.slice(0, 3)) {
      weeklyInsights.push(l);
    }

    // Findings from performance
    for (const f of perf.findings.slice(0, 2)) {
      weeklyInsights.push(f);
    }

    // Improvement recommendations
    const recommendations: string[] = [];
    const pendingOpts = this.optimizations.filter(o => o.status === 'suggested' && o.impact === 'high');
    if (pendingOpts.length > 0) {
      recommendations.push(`${pendingOpts.length} optimizaciones de alto impacto pendientes de revision.`);
    }
    if (feedback.systemStatus === 'declining') {
      recommendations.push('Sistema en declive — revisar estrategia de seguimiento y priorización.');
    }

    return {
      weeklyInsights,
      performanceTrends: {
        winRate: feedback.winRate,
        taskExecution: feedback.taskCompletion,
        systemStatus: feedback.systemStatus,
      },
      recommendations,
      topOptimizations: this.optimizations.filter(o => o.status === 'suggested').slice(0, 5),
    };
  }

  // ─────────────────────────────────────────────────────────
  // 8. SUPERVISOR INSIGHTS
  // ─────────────────────────────────────────────────────────

  async getSupervisorInsights() {
    const perf = await this.getPerformanceAnalysis();

    const coachingOpportunities: Array<{ advisor: string; area: string; suggestion: string }> = [];
    const executionGaps: string[] = [];

    for (const a of perf.advisors) {
      for (const imp of a.improvements) {
        coachingOpportunities.push({
          advisor: a.name,
          area: imp.includes('conversion') ? 'conversion' : imp.includes('cierre') ? 'velocity' : imp.includes('tareas') ? 'discipline' : 'general',
          suggestion: imp,
        });
      }

      if (a.tasksOverdue > 20) {
        executionGaps.push(`${a.name}: ${a.tasksOverdue} tareas vencidas — ejecutar o reasignar.`);
      }
      if (a.disciplineScore < 50) {
        executionGaps.push(`${a.name}: disciplina al ${a.disciplineScore}% — necesita seguimiento cercano.`);
      }
    }

    return {
      advisorPerformance: perf.advisors,
      coachingOpportunities,
      executionGaps,
      channelRecommendations: perf.channels.slice(0, 5),
    };
  }

  // ─────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────

  private async getTeamIds(): Promise<string[]> {
    const users = await this.getTeamUsers();
    return users.map(u => u.id);
  }

  private async getTeamUsers() {
    return this.prisma.user.findMany({
      where: { email: { in: TEAM_EMAILS } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
  }

  private fmt(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toFixed(0);
  }
}
