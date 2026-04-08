import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const ALL_EXECUTORS_EMAILS = [
  'admin@iea.com', // Director — Andres
  'jaime.nav@iealanis.com',
  'j.pimentel@iealanis.com',
  'atencion@iealanis.com',
  'jenifer@iealanis.com',
  'mariana@iealanis.com',
];

const DIRECTOR_EMAIL = 'admin@iea.com';

const GRADE_THRESHOLDS: Array<{
  min: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  label: string;
}> = [
  { min: 90, grade: 'A', label: 'Excelente' },
  { min: 75, grade: 'B', label: 'Bueno' },
  { min: 60, grade: 'C', label: 'Regular' },
  { min: 45, grade: 'D', label: 'Bajo' },
  { min: 0, grade: 'F', label: 'Critico' },
];

/** Weights for overall score calculation */
const SCORE_WEIGHTS = {
  taskCompletion: 0.3,
  followUpRate: 0.25,
  executionSpeed: 0.15,
  pipelineMovement: 0.2,
  responseToAlerts: 0.1,
};

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface DisciplineScore {
  advisorId: string;
  advisorName: string;
  email: string;
  isDirector: boolean;
  period: string;

  scores: {
    taskCompletion: number;
    followUpRate: number;
    executionSpeed: number;
    pipelineMovement: number;
    responseToAlerts: number;
    overall: number;
  };

  metrics: {
    tasksAssigned: number;
    tasksCompleted: number;
    tasksOverdue: number;
    tasksSkipped: number;
    avgCompletionHours: number;
    leadsContacted: number;
    leadsTotal: number;
    alertsReceived: number;
    alertsResolved: number;
    visitsMade: number;
    pipelineMovedCount: number;
    dealsClosedWon: number;
    dealsClosedLost: number;
  };

  discipline: {
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    label: string;
    trend: 'improving' | 'stable' | 'declining';
    streakDays: number;
    lastActiveDate: string | null;
    daysSinceLastActivity: number | null;
  };

  issues: Array<{
    type: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    message: string;
    recommendation: string;
    detectedAt: string;
  }>;
}

export interface ReminderPayload {
  advisorId: string;
  advisorName: string;
  email: string;
  reminders: Array<{
    type:
      | 'pending_tasks'
      | 'inactive_leads'
      | 'critical_deals'
      | 'overdue_tasks'
      | 'stalled_pipeline';
    count: number;
    urgency: 'critical' | 'high' | 'medium';
    message: string;
    topItems: Array<{ name: string; value: number; daysPending: number }>;
  }>;
  summary: string;
  timestamp: string;
}

export interface TeamDisciplineReport {
  period: string;
  generatedAt: string;
  teamAverage: number;
  scores: DisciplineScore[];
  rankings: Array<{
    rank: number;
    advisorName: string;
    overall: number;
    grade: string;
  }>;
  teamIssues: Array<{
    issue: string;
    severity: string;
    affectedAdvisors: string[];
  }>;
  performanceAlerts: Array<{
    advisorName: string;
    type:
      | 'low_activity'
      | 'missed_followups'
      | 'overdue_tasks'
      | 'declining_performance'
      | 'no_pipeline_movement';
    message: string;
    severity: string;
    recommendation: string;
  }>;
}

export interface PerformanceIssue {
  advisorId: string;
  advisorName: string;
  type:
    | 'low_activity'
    | 'missed_followups'
    | 'overdue_tasks'
    | 'declining_performance'
    | 'no_pipeline_movement';
  severity: string;
  message: string;
  recommendation: string;
}

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

@Injectable()
export class ExecutionDisciplineService {
  private readonly logger = new Logger(ExecutionDisciplineService.name);

  /** In-memory cache for latest cron results */
  latestReminders: ReminderPayload[] = [];
  latestIssues: PerformanceIssue[] = [];

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────

  async getDisciplineScore(
    advisorId: string,
    days = 7,
  ): Promise<DisciplineScore> {
    const period = `${days}d`;
    const since = this.daysAgo(days);
    const prevSince = this.daysAgo(days * 2);

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: advisorId },
    });

    const advisorName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
    const email = user.email;
    const isDirector = email === DIRECTOR_EMAIL;

    // ── Fetch raw data in parallel ──
    const [
      tasks,
      prevTasks,
      leads,
      alerts,
      visits,
      completedTasksWithTime,
      dailyCompletions,
    ] = await Promise.all([
      this.getTasksForPeriod(advisorId, since),
      this.getTasksForPeriod(advisorId, prevSince, since),
      this.getLeadsForAdvisor(advisorId),
      this.getAlertsForPeriod(advisorId, since),
      this.getVisitsForPeriod(advisorId, since),
      this.getCompletedTasksWithDuration(advisorId, since),
      this.getDailyCompletionRates(advisorId, days),
    ]);

    // ── Compute metrics ──
    const tasksCompleted = tasks.filter(
      (t) => t.status === 'completed',
    ).length;
    const tasksOverdue = tasks.filter((t: any) => t.status === 'overdue').length;
    const tasksSkipped = tasks.filter((t: any) => t.status === 'skipped').length;
    const tasksAssigned = tasks.length;
    const pipelineMovedCount = tasks.filter(
      (t) => t.pipelineMoved === true,
    ).length;

    const leadsTotal = leads.length;
    const contactedSince = since;
    const leadsContacted = leads.filter(
      (l) => l.lastContactedAt && l.lastContactedAt >= contactedSince,
    ).length;

    const alertsReceived = alerts.length;
    const alertsResolved = alerts.filter(
      (a) => a.status === 'acknowledged' || a.status === 'resolved',
    ).length;

    const visitsMade = visits.length;

    const avgCompletionHours = this.computeAvgCompletionHours(
      completedTasksWithTime,
    );

    const dealsClosedWon = leads.filter(
      (l) => l.status === 'CERRADO_GANADO',
    ).length;
    const dealsClosedLost = leads.filter(
      (l) => l.status === 'CERRADO_PERDIDO',
    ).length;

    const metrics = {
      tasksAssigned,
      tasksCompleted,
      tasksOverdue,
      tasksSkipped,
      avgCompletionHours,
      leadsContacted,
      leadsTotal,
      alertsReceived,
      alertsResolved,
      visitsMade,
      pipelineMovedCount,
      dealsClosedWon,
      dealsClosedLost,
    };

    // ── Compute scores ──
    const denominator = tasksCompleted + tasksOverdue + tasksSkipped;
    const taskCompletion =
      denominator > 0 ? (tasksCompleted / denominator) * 100 : 100;

    const followUpRate =
      leadsTotal > 0 ? (leadsContacted / leadsTotal) * 100 : 100;

    const executionSpeed = this.mapSpeedToScore(avgCompletionHours);

    const pipelineMovement =
      tasksCompleted > 0 ? (pipelineMovedCount / tasksCompleted) * 100 : 0;

    const responseToAlerts =
      alertsReceived > 0 ? (alertsResolved / alertsReceived) * 100 : 100;

    const overall = this.clamp(
      taskCompletion * SCORE_WEIGHTS.taskCompletion +
        followUpRate * SCORE_WEIGHTS.followUpRate +
        executionSpeed * SCORE_WEIGHTS.executionSpeed +
        pipelineMovement * SCORE_WEIGHTS.pipelineMovement +
        responseToAlerts * SCORE_WEIGHTS.responseToAlerts,
    );

    const scores = {
      taskCompletion: this.clamp(taskCompletion),
      followUpRate: this.clamp(followUpRate),
      executionSpeed: this.clamp(executionSpeed),
      pipelineMovement: this.clamp(pipelineMovement),
      responseToAlerts: this.clamp(responseToAlerts),
      overall: this.clamp(overall),
    };

    // ── Trend ──
    const prevCompleted = prevTasks.filter(
      (t) => t.status === 'completed',
    ).length;
    const prevOverdue = prevTasks.filter(
      (t) => t.status === 'overdue',
    ).length;
    const prevSkipped = prevTasks.filter(
      (t) => t.status === 'skipped',
    ).length;
    const prevDenom = prevCompleted + prevOverdue + prevSkipped;
    const prevCompletionRate =
      prevDenom > 0 ? (prevCompleted / prevDenom) * 100 : 0;
    const currentCompletionRate = taskCompletion;

    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    const delta = currentCompletionRate - prevCompletionRate;
    if (delta >= 10) trend = 'improving';
    else if (delta <= -10) trend = 'declining';

    // ── Streak ──
    const streakDays = this.computeStreak(dailyCompletions);

    // ── Last active date ──
    const lastTask = await this.prisma.salesTask.findFirst({
      where: { advisorId, status: 'completed', isHistorical: false },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    });
    const lastActiveDate = lastTask?.completedAt
      ? lastTask.completedAt.toISOString().split('T')[0]
      : null;
    const daysSinceLastActivity = lastTask?.completedAt
      ? Math.floor(
          (Date.now() - lastTask.completedAt.getTime()) / (1000 * 60 * 60 * 24),
        )
      : null;

    const { grade, label } = this.getGrade(overall);

    // ── Issues ──
    const issues = this.detectIssues(metrics, scores, trend, isDirector);

    return {
      advisorId,
      advisorName,
      email,
      isDirector,
      period,
      scores,
      metrics,
      discipline: {
        grade,
        label,
        trend,
        streakDays,
        lastActiveDate,
        daysSinceLastActivity,
      },
      issues,
    };
  }

  async getTeamDisciplineReport(days = 7): Promise<TeamDisciplineReport> {
    const period = `${days}d`;
    this.logger.log(`Generating team discipline report for period=${period}`);

    const executors = await this.resolveExecutors();
    const scoresList: DisciplineScore[] = [];

    for (const executor of executors) {
      try {
        const score = await this.getDisciplineScore(executor.id, days);
        scoresList.push(score);
      } catch (err) {
        this.logger.warn(
          `Could not compute score for ${executor.email}: ${err.message}`,
        );
      }
    }

    const teamAverage =
      scoresList.length > 0
        ? scoresList.reduce((sum, s) => sum + s.scores.overall, 0) /
          scoresList.length
        : 0;

    // Rankings
    const sorted = [...scoresList].sort(
      (a, b) => b.scores.overall - a.scores.overall,
    );
    const rankings = sorted.map((s, i) => ({
      rank: i + 1,
      advisorName: s.advisorName,
      overall: Math.round(s.scores.overall * 10) / 10,
      grade: s.discipline.grade,
    }));

    // Team-wide issues
    const teamIssues = this.detectTeamIssues(scoresList);

    // Performance alerts
    const performanceAlerts = this.buildPerformanceAlerts(scoresList);

    return {
      period,
      generatedAt: new Date().toISOString(),
      teamAverage: Math.round(teamAverage * 10) / 10,
      scores: scoresList,
      rankings,
      teamIssues,
      performanceAlerts,
    };
  }

  async generateReminders(): Promise<ReminderPayload[]> {
    this.logger.log('Generating reminders for all executors...');
    const executors = await this.resolveExecutors();
    const now = new Date();
    const results: ReminderPayload[] = [];

    for (const executor of executors) {
      try {
        const payload = await this.buildReminderForExecutor(executor, now);
        if (payload.reminders.length > 0) {
          results.push(payload);
        }
      } catch (err) {
        this.logger.warn(
          `Error generating reminders for ${executor.email}: ${err.message}`,
        );
      }
    }

    this.logger.log(
      `Generated reminders for ${results.length}/${executors.length} executors`,
    );
    return results;
  }

  async getExecutorReminder(advisorId: string): Promise<ReminderPayload> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: advisorId },
    });
    const executor = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    };
    return this.buildReminderForExecutor(executor, new Date());
  }

  async detectPerformanceIssues(): Promise<PerformanceIssue[]> {
    this.logger.log('Detecting performance issues across all executors...');
    const executors = await this.resolveExecutors();
    const issues: PerformanceIssue[] = [];
    const threeDaysAgo = this.daysAgo(3);
    const sevenDaysAgo = this.daysAgo(7);
    const fourteenDaysAgo = this.daysAgo(14);

    for (const executor of executors) {
      const name =
        `${executor.firstName ?? ''} ${executor.lastName ?? ''}`.trim();
      const isDirector = executor.email === DIRECTOR_EMAIL;

      try {
        // Low activity: < 3 tasks completed in last 3 days
        const recentCompleted = await this.prisma.salesTask.count({
          where: {
            advisorId: executor.id,
            status: 'completed',
            completedAt: { gte: threeDaysAgo },
            isHistorical: false,
          },
        });
        if (recentCompleted < 3) {
          issues.push({
            advisorId: executor.id,
            advisorName: name,
            type: 'low_activity',
            severity: recentCompleted === 0 ? 'critical' : 'high',
            message: `Solo ${recentCompleted} tareas completadas en los ultimos 3 dias`,
            recommendation:
              'Revisar carga de trabajo y priorizar tareas pendientes urgentes',
          });
        }

        // Missed follow-ups: > 5 leads with no contact in 14+ days
        const staleLeads = await this.prisma.lead.count({
          where: {
            assignedToId: executor.id,
            deletedAt: null,
            isHistorical: false,
            status: {
              notIn: [
                'CERRADO_GANADO',
                'CERRADO_PERDIDO',
                'LEAD_BASURA',
                'CONTACTAR_FUTURO',
              ],
            },
            OR: [
              { lastContactedAt: { lt: fourteenDaysAgo } },
              { lastContactedAt: null },
            ],
          },
        });
        if (staleLeads > 5) {
          issues.push({
            advisorId: executor.id,
            advisorName: name,
            type: 'missed_followups',
            severity: staleLeads > 10 ? 'critical' : 'high',
            message: `${staleLeads} leads sin contacto en 14+ dias`,
            recommendation:
              'Programar sesion de seguimiento masivo con leads inactivos',
          });
        }

        // Overdue tasks: > 3 overdue
        const overdueCount = await this.prisma.salesTask.count({
          where: { advisorId: executor.id, status: 'overdue', isHistorical: false },
        });
        if (overdueCount > 3) {
          issues.push({
            advisorId: executor.id,
            advisorName: name,
            type: 'overdue_tasks',
            severity: overdueCount > 7 ? 'critical' : 'high',
            message: `${overdueCount} tareas vencidas sin completar`,
            recommendation:
              'Completar o reasignar tareas vencidas de mayor prioridad',
          });
        }

        // Declining performance: this week < last week by 15+ points
        try {
          const currentScore = await this.getDisciplineScore(executor.id, 7);
          const previousScore = await this.computeOverallForPeriod(
            executor.id,
            this.daysAgo(14),
            sevenDaysAgo,
          );
          if (previousScore > 0 && currentScore.scores.overall < previousScore - 15) {
            issues.push({
              advisorId: executor.id,
              advisorName: name,
              type: 'declining_performance',
              severity: 'high',
              message: `Rendimiento en declive: ${Math.round(currentScore.scores.overall)} vs ${Math.round(previousScore)} semana anterior`,
              recommendation:
                'Agendar reunion 1:1 para identificar bloqueos y reencauzar',
            });
          }
        } catch {
          // Skip if computation fails
        }

        // No pipeline movement: 0 pipeline moves in last 7 days
        const pipelineMoves = await this.prisma.salesTask.count({
          where: {
            advisorId: executor.id,
            pipelineMoved: true,
            completedAt: { gte: sevenDaysAgo },
            isHistorical: false,
          },
        });
        if (pipelineMoves === 0) {
          issues.push({
            advisorId: executor.id,
            advisorName: name,
            type: 'no_pipeline_movement',
            severity: 'medium',
            message: '0 movimientos de pipeline en los ultimos 7 dias',
            recommendation:
              'Enfocar esfuerzo en avanzar leads existentes al siguiente paso',
          });
        }

        // Director-specific: not completing high-value deal tasks
        if (isDirector) {
          const highValuePending = await this.prisma.salesTask.count({
            where: {
              advisorId: executor.id,
              status: { in: ['pending', 'overdue'] },
              priority: 'critical',
              isHistorical: false,
            },
          });
          if (highValuePending > 0) {
            issues.push({
              advisorId: executor.id,
              advisorName: name,
              type: 'overdue_tasks',
              severity: 'critical',
              message: `Director tiene ${highValuePending} tareas criticas pendientes/vencidas`,
              recommendation:
                'Priorizar cierre de deals de alto valor antes de delegar',
            });
          }
        }
      } catch (err) {
        this.logger.warn(
          `Error detecting issues for ${executor.email}: ${err.message}`,
        );
      }
    }

    this.logger.log(`Detected ${issues.length} total performance issues`);
    return issues;
  }

  // ─────────────────────────────────────────────────────────
  // CRON JOBS
  // ─────────────────────────────────────────────────────────

  /** Every ~2.5h during work hours Mon-Sat 8am-5pm */
  @Cron('0 8,10,13,15,17 * * 1-6')
  async triggerReminders(): Promise<void> {
    this.logger.log('Triggering execution reminders...');
    const reminders = await this.generateReminders();
    this.latestReminders = reminders;
    this.logger.log(`Generated ${reminders.length} reminders`);
  }

  /** Every 6 hours during work week — detect performance issues */
  @Cron('0 9,15,21 * * 1-6')
  async triggerPerformanceCheck(): Promise<void> {
    this.logger.log('Running performance detection...');
    const issues = await this.detectPerformanceIssues();
    this.latestIssues = issues;
    this.logger.log(`Detected ${issues.length} performance issues`);
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────

  private async resolveExecutors(): Promise<
    Array<{
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
    }>
  > {
    const users = await this.prisma.user.findMany({
      where: {
        email: { in: ALL_EXECUTORS_EMAILS },
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, email: true, firstName: true, lastName: true },
    });

    if (users.length === 0) {
      this.logger.warn('No active executors found matching configured emails');
    }

    return users;
  }

  private async getTasksForPeriod(
    advisorId: string,
    since: Date,
    until?: Date,
  ) {
    return this.prisma.salesTask.findMany({
      where: {
        advisorId,
        createdAt: { gte: since, ...(until ? { lt: until } : {}) },
        isHistorical: false,
      },
      select: {
        id: true,
        status: true,
        pipelineMoved: true,
        completedAt: true,
        startedAt: true,
        createdAt: true,
        dueDate: true,
        priority: true,
      },
    });
  }

  private async getLeadsForAdvisor(advisorId: string) {
    return this.prisma.lead.findMany({
      where: {
        assignedToId: advisorId,
        deletedAt: null,
        isHistorical: false,
        status: {
          notIn: ['CERRADO_GANADO', 'CERRADO_PERDIDO', 'LEAD_BASURA'],
        },
      },
      select: {
        id: true,
        status: true,
        lastContactedAt: true,
        estimatedValue: true,
        companyName: true,
      },
    });
  }

  private async getAlertsForPeriod(advisorId: string, since: Date) {
    return this.prisma.salesAlert.findMany({
      where: { advisorId, createdAt: { gte: since } },
      select: { id: true, status: true, createdAt: true },
    });
  }

  private async getVisitsForPeriod(advisorId: string, since: Date) {
    return this.prisma.visit.findMany({
      where: { visitedById: advisorId, visitDate: { gte: since } },
      select: { id: true },
    });
  }

  private async getCompletedTasksWithDuration(
    advisorId: string,
    since: Date,
  ) {
    return this.prisma.salesTask.findMany({
      where: {
        advisorId,
        status: 'completed',
        completedAt: { gte: since },
        startedAt: { not: null },
        isHistorical: false,
      },
      select: { startedAt: true, completedAt: true },
    });
  }

  private async getDailyCompletionRates(
    advisorId: string,
    days: number,
  ): Promise<Array<{ date: string; rate: number }>> {
    const results: Array<{ date: string; rate: number }> = [];

    for (let i = 0; i < days; i++) {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      dayStart.setDate(dayStart.getDate() - i);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const [completed, total] = await Promise.all([
        this.prisma.salesTask.count({
          where: {
            advisorId,
            status: 'completed',
            completedAt: { gte: dayStart, lt: dayEnd },
            isHistorical: false,
          },
        }),
        this.prisma.salesTask.count({
          where: {
            advisorId,
            createdAt: { gte: dayStart, lt: dayEnd },
            isHistorical: false,
          },
        }),
      ]);

      results.push({
        date: dayStart.toISOString().split('T')[0],
        rate: total > 0 ? (completed / total) * 100 : 0,
      });
    }

    return results;
  }

  private computeAvgCompletionHours(
    tasks: Array<{ startedAt: Date | null; completedAt: Date | null }>,
  ): number {
    const validTasks = tasks.filter((t: any) => t.startedAt && t.completedAt);
    if (validTasks.length === 0) return 0;

    const totalHours = validTasks.reduce((sum, t) => {
      const diffMs = t.completedAt!.getTime() - t.startedAt!.getTime();
      return sum + diffMs / (1000 * 60 * 60);
    }, 0);

    return Math.round((totalHours / validTasks.length) * 10) / 10;
  }

  /** Map avg completion hours to 0-100 score. 0h=100, 24h=50, 48h+=0 */
  private mapSpeedToScore(avgHours: number): number {
    if (avgHours <= 0) return 100;
    if (avgHours >= 48) return 0;
    // Linear interpolation: 0h->100, 48h->0
    return Math.round(((48 - avgHours) / 48) * 100 * 10) / 10;
  }

  private clamp(value: number, min = 0, max = 100): number {
    return Math.round(Math.min(max, Math.max(min, value)) * 10) / 10;
  }

  private getGrade(overall: number): { grade: DisciplineScore['discipline']['grade']; label: string } {
    for (const t of GRADE_THRESHOLDS) {
      if (overall >= t.min) return { grade: t.grade, label: t.label };
    }
    return { grade: 'F', label: 'Critico' };
  }

  private computeStreak(
    dailyRates: Array<{ date: string; rate: number }>,
  ): number {
    // dailyRates[0] = most recent day
    let streak = 0;
    for (const day of dailyRates) {
      if (day.rate >= 70) streak++;
      else break;
    }
    return streak;
  }

  private detectIssues(
    metrics: DisciplineScore['metrics'],
    scores: DisciplineScore['scores'],
    trend: string,
    isDirector: boolean,
  ): DisciplineScore['issues'] {
    const issues: DisciplineScore['issues'] = [];
    const now = new Date().toISOString();

    if (metrics.tasksOverdue > 3) {
      issues.push({
        type: 'overdue_tasks',
        severity: metrics.tasksOverdue > 7 ? 'critical' : 'high',
        message: `${metrics.tasksOverdue} tareas vencidas`,
        recommendation: 'Completar o reasignar tareas vencidas urgentes',
        detectedAt: now,
      });
    }

    if (scores.followUpRate < 50 && metrics.leadsTotal > 0) {
      issues.push({
        type: 'inactive_leads',
        severity: scores.followUpRate < 25 ? 'critical' : 'high',
        message: `Solo ${Math.round(scores.followUpRate)}% de leads contactados`,
        recommendation: 'Programar bloque de seguimiento para leads sin contacto',
        detectedAt: now,
      });
    }

    if (scores.taskCompletion < 50) {
      issues.push({
        type: 'low_completion',
        severity: scores.taskCompletion < 30 ? 'critical' : 'high',
        message: `Tasa de completado baja: ${Math.round(scores.taskCompletion)}%`,
        recommendation: 'Reducir carga y enfocar en tareas de mayor impacto',
        detectedAt: now,
      });
    }

    if (metrics.visitsMade === 0 && metrics.leadsTotal > 5) {
      issues.push({
        type: 'no_visits',
        severity: 'medium',
        message: 'Sin visitas registradas en el periodo',
        recommendation: 'Agendar al menos 2-3 visitas semanales a prospectos clave',
        detectedAt: now,
      });
    }

    if (trend === 'declining') {
      issues.push({
        type: 'declining_trend',
        severity: 'high',
        message: 'Rendimiento en declive comparado con periodo anterior',
        recommendation: 'Identificar bloqueos y ajustar prioridades',
        detectedAt: now,
      });
    }

    if (isDirector && scores.pipelineMovement < 20) {
      issues.push({
        type: 'director_low_pipeline',
        severity: 'medium',
        message: 'Director con bajo movimiento de pipeline propio',
        recommendation:
          'Enfocar en avanzar deals estrategicos de alto valor',
        detectedAt: now,
      });
    }

    return issues;
  }

  private detectTeamIssues(
    scores: DisciplineScore[],
  ): TeamDisciplineReport['teamIssues'] {
    const issues: TeamDisciplineReport['teamIssues'] = [];

    // Check for team-wide overdue problem
    const overdueAdvisors = scores.filter(
      (s) => s.metrics.tasksOverdue > 3,
    );
    if (overdueAdvisors.length >= 3) {
      issues.push({
        issue: 'Problema generalizado de tareas vencidas en el equipo',
        severity: 'critical',
        affectedAdvisors: overdueAdvisors.map((s: any) => s.advisorName),
      });
    }

    // Low follow-up across team
    const lowFollowUp = scores.filter((s: any) => s.scores.followUpRate < 50);
    if (lowFollowUp.length >= 3) {
      issues.push({
        issue: 'Seguimiento de leads insuficiente a nivel equipo',
        severity: 'high',
        affectedAdvisors: lowFollowUp.map((s: any) => s.advisorName),
      });
    }

    // No pipeline movement team-wide
    const noPipeline = scores.filter(
      (s) => s.scores.pipelineMovement < 10,
    );
    if (noPipeline.length >= 3) {
      issues.push({
        issue: 'Pipeline estancado — multiples asesores sin movimiento',
        severity: 'high',
        affectedAdvisors: noPipeline.map((s: any) => s.advisorName),
      });
    }

    // Declining trend
    const declining = scores.filter(
      (s) => s.discipline.trend === 'declining',
    );
    if (declining.length >= 2) {
      issues.push({
        issue: 'Tendencia de rendimiento a la baja en multiples asesores',
        severity: 'high',
        affectedAdvisors: declining.map((s: any) => s.advisorName),
      });
    }

    return issues;
  }

  private buildPerformanceAlerts(
    scores: DisciplineScore[],
  ): TeamDisciplineReport['performanceAlerts'] {
    const alerts: TeamDisciplineReport['performanceAlerts'] = [];

    for (const score of scores) {
      for (const issue of score.issues) {
        const alertType = this.mapIssueToAlertType(issue.type);
        if (alertType) {
          alerts.push({
            advisorName: score.advisorName,
            type: alertType,
            message: issue.message,
            severity: issue.severity,
            recommendation: issue.recommendation,
          });
        }
      }
    }

    return alerts;
  }

  private mapIssueToAlertType(
    issueType: string,
  ): TeamDisciplineReport['performanceAlerts'][number]['type'] | null {
    const mapping: Record<
      string,
      TeamDisciplineReport['performanceAlerts'][number]['type']
    > = {
      overdue_tasks: 'overdue_tasks',
      inactive_leads: 'missed_followups',
      low_completion: 'low_activity',
      declining_trend: 'declining_performance',
      no_visits: 'low_activity',
      director_low_pipeline: 'no_pipeline_movement',
    };
    return mapping[issueType] ?? null;
  }

  private async buildReminderForExecutor(
    executor: {
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
    },
    now: Date,
  ): Promise<ReminderPayload> {
    const name =
      `${executor.firstName ?? ''} ${executor.lastName ?? ''}`.trim();
    const isDirector = executor.email === DIRECTOR_EMAIL;
    const sevenDaysAgo = this.daysAgo(7);
    const reminders: ReminderPayload['reminders'] = [];

    // 1. Pending tasks
    const pendingTasks = await this.prisma.salesTask.findMany({
      where: { advisorId: executor.id, status: 'pending', isHistorical: false },
      orderBy: { priorityScore: 'desc' },
      take: 10,
      select: {
        id: true,
        type: true,
        title: true,
        estimatedValue: true,
        createdAt: true,
      },
    });
    if (pendingTasks.length > 0) {
      reminders.push({
        type: 'pending_tasks',
        count: pendingTasks.length,
        urgency: pendingTasks.length > 5 ? 'high' : 'medium',
        message: `${pendingTasks.length} tareas pendientes por completar`,
        topItems: pendingTasks.slice(0, 5).map((t: any) => ({
          name: t.title || t.type,
          value: Number(t.estimatedValue ?? 0),
          daysPending: Math.floor(
            (now.getTime() - t.createdAt.getTime()) / (1000 * 60 * 60 * 24),
          ),
        })),
      });
    }

    // 2. Overdue tasks
    const overdueTasks = await this.prisma.salesTask.findMany({
      where: { advisorId: executor.id, status: 'overdue', isHistorical: false },
      orderBy: { dueDate: 'asc' },
      take: 10,
      select: {
        id: true,
        type: true,
        title: true,
        estimatedValue: true,
        dueDate: true,
      },
    });
    if (overdueTasks.length > 0) {
      reminders.push({
        type: 'overdue_tasks',
        count: overdueTasks.length,
        urgency: overdueTasks.length > 3 ? 'critical' : 'high',
        message: `${overdueTasks.length} tareas vencidas requieren atencion inmediata`,
        topItems: overdueTasks.slice(0, 5).map((t: any) => ({
          name: t.title || t.type,
          value: Number(t.estimatedValue ?? 0),
          daysPending: t.dueDate
            ? Math.floor(
                (now.getTime() - t.dueDate.getTime()) / (1000 * 60 * 60 * 24),
              )
            : 0,
        })),
      });
    }

    // 3. Inactive leads (7+ days no contact)
    const inactiveLeads = await this.prisma.lead.findMany({
      where: {
        assignedToId: executor.id,
        deletedAt: null,
        status: {
          notIn: [
            'CERRADO_GANADO',
            'CERRADO_PERDIDO',
            'LEAD_BASURA',
            'CONTACTAR_FUTURO',
          ],
        },
        OR: [
          { lastContactedAt: { lt: sevenDaysAgo } },
          { lastContactedAt: null },
        ],
      },
      orderBy: { estimatedValue: 'desc' },
      take: 10,
      select: {
        companyName: true,
        estimatedValue: true,
        lastContactedAt: true,
      },
    });
    if (inactiveLeads.length > 0) {
      reminders.push({
        type: 'inactive_leads',
        count: inactiveLeads.length,
        urgency: inactiveLeads.length > 10 ? 'critical' : 'high',
        message: `${inactiveLeads.length} leads sin contacto en 7+ dias`,
        topItems: inactiveLeads.slice(0, 5).map((l: any) => ({
          name: l.companyName ?? 'Sin nombre',
          value: Number(l.estimatedValue ?? 0),
          daysPending: l.lastContactedAt
            ? Math.floor(
                (now.getTime() - l.lastContactedAt.getTime()) /
                  (1000 * 60 * 60 * 24),
              )
            : 999,
        })),
      });
    }

    // 4. Critical deals (high value, stalled)
    const criticalDeals = await this.prisma.lead.findMany({
      where: {
        assignedToId: executor.id,
        deletedAt: null,
        estimatedValue: { gte: 100000 },
        status: {
          notIn: ['CERRADO_GANADO', 'CERRADO_PERDIDO', 'LEAD_BASURA'],
        },
        lastContactedAt: { lt: sevenDaysAgo },
      },
      orderBy: { estimatedValue: 'desc' },
      take: 5,
      select: {
        companyName: true,
        estimatedValue: true,
        lastContactedAt: true,
      },
    });
    if (criticalDeals.length > 0) {
      reminders.push({
        type: 'critical_deals',
        count: criticalDeals.length,
        urgency: 'critical',
        message: `${criticalDeals.length} deals de alto valor estancados`,
        topItems: criticalDeals.map((d: any) => ({
          name: d.companyName ?? 'Sin nombre',
          value: Number(d.estimatedValue ?? 0),
          daysPending: d.lastContactedAt
            ? Math.floor(
                (now.getTime() - d.lastContactedAt.getTime()) /
                  (1000 * 60 * 60 * 24),
              )
            : 999,
        })),
      });
    }

    // 5. Stalled pipeline (tasks with no pipeline movement)
    const stalledCount = await this.prisma.salesTask.count({
      where: {
        advisorId: executor.id,
        status: 'completed',
        pipelineMoved: false,
        completedAt: { gte: sevenDaysAgo },
        isHistorical: false,
      },
    });
    if (stalledCount > 5) {
      reminders.push({
        type: 'stalled_pipeline',
        count: stalledCount,
        urgency: 'medium',
        message: `${stalledCount} tareas completadas sin avance de pipeline`,
        topItems: [],
      });
    }

    // Director-specific: team-level reminders
    if (isDirector) {
      const teamOverdue = await this.prisma.salesTask.count({
        where: { status: 'overdue', isHistorical: false },
      });
      if (teamOverdue > 10) {
        reminders.push({
          type: 'overdue_tasks',
          count: teamOverdue,
          urgency: 'critical',
          message: `[EQUIPO] ${teamOverdue} tareas vencidas en todo el equipo`,
          topItems: [],
        });
      }
    }

    const summaryParts = reminders.map(
      (r) => `${r.type}: ${r.count}`,
    );

    return {
      advisorId: executor.id,
      advisorName: name,
      email: executor.email,
      reminders,
      summary:
        reminders.length > 0
          ? `${name}: ${summaryParts.join(', ')}`
          : `${name}: sin recordatorios pendientes`,
      timestamp: now.toISOString(),
    };
  }

  private async computeOverallForPeriod(
    advisorId: string,
    since: Date,
    until: Date,
  ): Promise<number> {
    const tasks = await this.getTasksForPeriod(advisorId, since, until);
    const completed = tasks.filter((t: any) => t.status === 'completed').length;
    const overdue = tasks.filter((t: any) => t.status === 'overdue').length;
    const skipped = tasks.filter((t: any) => t.status === 'skipped').length;
    const denom = completed + overdue + skipped;
    if (denom === 0) return 0;
    // Simplified: just return task completion as proxy
    return (completed / denom) * 100;
  }

  private daysAgo(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}
