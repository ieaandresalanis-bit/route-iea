import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';

// All orchestrated services
import { ExecutionEngineService } from '../execution-engine/execution-engine.service';
import { PriorityEngineService } from '../priority-engine/priority-engine.service';
import { AlertIntelligenceService } from '../alert-intelligence/alert-intelligence.service';
import { FollowUpAutomationService } from '../followup-automation/followup-automation.service';
import { FollowUpIntelligenceService } from '../follow-up-intelligence/follow-up-intelligence.service';
import { SupervisorAgentService } from '../supervisor-agent/supervisor-agent.service';
import { ExecutionDisciplineService } from '../execution-discipline/execution-discipline.service';
import { TeamManagementService } from '../team-management/team-management.service';
import { MultiChannelService } from '../multi-channel/multi-channel.service';
import { AutomationEngineService } from '../automation-engine/automation-engine.service';
import { CommercialDirectorService } from '../commercial-director/commercial-director.service';

// ── Constants ─────────────────────────────────────────────
const DIRECTOR_ID = '9b9d9e50-0097-4848-a197-5d7f4bd0ef50';
const DIRECTOR_EMAIL = 'admin@iea.com';

const TERMINAL_STATUSES = [
  'CERRADO_GANADO',
  'CERRADO_PERDIDO',
  'LEAD_BASURA',
  'CONTACTAR_FUTURO',
];

const HIGH_VALUE_THRESHOLD = 100000; // $100K MXN
const CRITICAL_VALUE_THRESHOLD = 500000; // $500K MXN
const INACTIVITY_HOURS = 48; // 2 days without action
const STALE_TASK_HOURS = 24; // task overdue 24h+

// Priority override thresholds
const OVERRIDE_THRESHOLDS = {
  CRITICAL_DEAL_VALUE: 500000,
  HIGH_DEAL_VALUE: 200000,
  STUCK_DAYS_ESCALATE: 5,
  OVERDUE_TASKS_ESCALATE: 3,
};

// ── Types (exported for controller) ───────────────────────
export interface OrchestrationCycleResult {
  cycleId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  phases: {
    stateAnalysis: PhaseResult;
    detectionScan: PhaseResult;
    actionAssignment: PhaseResult;
    taskGeneration: PhaseResult;
    prioritization: PhaseResult;
    ownerAssignment: PhaseResult;
    executionMonitor: PhaseResult;
    escalation: PhaseResult;
  };
  summary: {
    leadsProcessed: number;
    actionsGenerated: number;
    tasksCreated: number;
    alertsRaised: number;
    escalations: number;
    overrides: number;
    followUpsExecuted: number;
    remindersGenerated: number;
  };
}

export interface PhaseResult {
  phase: string;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  count: number;
  durationMs: number;
  details?: any;
}

export interface LeadDecision {
  leadId: string;
  companyName: string;
  currentStatus: string;
  assignedTo: string | null;
  estimatedValue: number;
  daysSinceLastContact: number | null;
  priorityScore: number;
  decision: 'generate_task' | 'send_reminder' | 'escalate' | 'reassign' | 'override_priority' | 'no_action';
  reason: string;
  urgency: 'critical' | 'high' | 'medium' | 'low';
}

export interface DirectorPriorityItem {
  leadId: string;
  companyName: string;
  status: string;
  estimatedValue: number;
  daysSinceLastContact: number | null;
  assignedAdvisor: string;
  urgency: 'critical' | 'high' | 'medium';
  action: string;
  reason: string;
}

export interface OrchestrationStatus {
  isRunning: boolean;
  lastCycleAt: string | null;
  lastCycleDurationMs: number | null;
  totalCyclesToday: number;
  nextScheduledRun: string;
  systemHealth: 'optimal' | 'degraded' | 'critical';
  agentStatuses: AgentStatus[];
  directorPriorities: DirectorPriorityItem[];
  realtimeMetrics: RealtimeMetrics;
}

export interface AgentStatus {
  agent: string;
  lastRun: string | null;
  status: 'active' | 'idle' | 'error';
  lastResult?: any;
}

export interface RealtimeMetrics {
  activeLeads: number;
  leadsWithoutNextAction: number;
  overdueTasksCount: number;
  stuckDealsCount: number;
  inactiveAdvisorsCount: number;
  todayTasksCompleted: number;
  todayTasksTotal: number;
  completionRate: number;
  pipelineValue: number;
  highValueAtRisk: number;
}

export interface PriorityOverride {
  leadId: string;
  previousPriority: number;
  newPriority: number;
  reason: string;
  triggeredBy: 'value' | 'stuck' | 'escalation' | 'director';
}

/**
 * ExecutionOrchestrationService — The central nervous system of the commercial operation.
 *
 * Coordinates ALL agents into a unified decision-making engine:
 * - ExecutionEngine: task generation & daily views
 * - PriorityEngine: lead scoring & priority lists
 * - AlertIntelligence: alert generation & management
 * - FollowUpAutomation: sequence enrollment & execution
 * - FollowUpIntelligence: lead intelligence & director briefing
 * - SupervisorAgent: inactivity & stuck deal detection
 * - ExecutionDiscipline: team scoring & reminders
 * - TeamManagement: reassignment & distribution
 * - MultiChannel: communication preparation & logging
 * - AutomationEngine: full automation cycles
 * - CommercialDirector: bottlenecks, strategy, risk analysis
 *
 * Runs every 45 minutes Mon-Sat 7AM-7PM. Each cycle:
 * 1. Analyze state (all leads, tasks, alerts)
 * 2. Detect issues (inactivity, stuck, overdue)
 * 3. Assign next actions per lead
 * 4. Generate/update tasks
 * 5. Assign priorities
 * 6. Assign owners
 * 7. Monitor execution
 * 8. Escalate if no action
 */
@Injectable()
export class ExecutionOrchestrationService {
  private readonly logger = new Logger(ExecutionOrchestrationService.name);

  // State
  private isRunning = false;
  private lastCycleResult: OrchestrationCycleResult | null = null;
  private cyclesToday = 0;
  private lastCycleDate: string | null = null;
  private directorPriorities: DirectorPriorityItem[] = [];
  private priorityOverrides: PriorityOverride[] = [];
  private agentStatuses: Map<string, AgentStatus> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly executionEngine: ExecutionEngineService,
    private readonly priorityEngine: PriorityEngineService,
    private readonly alertIntelligence: AlertIntelligenceService,
    private readonly followUpAutomation: FollowUpAutomationService,
    private readonly followUpIntelligence: FollowUpIntelligenceService,
    private readonly supervisorAgent: SupervisorAgentService,
    private readonly executionDiscipline: ExecutionDisciplineService,
    private readonly teamManagement: TeamManagementService,
    private readonly multiChannel: MultiChannelService,
    private readonly automationEngine: AutomationEngineService,
    private readonly commercialDirector: CommercialDirectorService,
  ) {
    this.logger.log(
      '🚀 EXECUTION ORCHESTRATION ENGINE ONLINE — All agents coordinated',
    );
    // Initialize agent statuses
    const agents = [
      'ExecutionEngine', 'PriorityEngine', 'AlertIntelligence',
      'FollowUpAutomation', 'FollowUpIntelligence', 'SupervisorAgent',
      'ExecutionDiscipline', 'TeamManagement', 'MultiChannel',
      'AutomationEngine', 'CommercialDirector',
    ];
    agents.forEach((a: any) =>
      this.agentStatuses.set(a, { agent: a, lastRun: null, status: 'idle' }),
    );
  }

  // ═══════════════════════════════════════════════════════════
  // CRON: Main orchestration loop — every 45 min, Mon-Sat 7AM-7PM
  // ═══════════════════════════════════════════════════════════

  @Cron('0 */45 7-19 * * 1-6')
  async runOrchestrationCycle(): Promise<OrchestrationCycleResult> {
    if (this.isRunning) {
      this.logger.warn('⚠️ Orchestration cycle already running, skipping');
      return this.lastCycleResult!;
    }

    // Reset daily counter
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastCycleDate !== today) {
      this.cyclesToday = 0;
      this.lastCycleDate = today;
    }

    this.isRunning = true;
    const cycleId = `orch-${Date.now()}`;
    const startedAt = new Date();
    this.logger.log(`\n${'═'.repeat(60)}`);
    this.logger.log(`🔄 ORCHESTRATION CYCLE ${cycleId} STARTED`);
    this.logger.log(`${'═'.repeat(60)}`);

    const result: OrchestrationCycleResult = {
      cycleId,
      startedAt: startedAt.toISOString(),
      completedAt: '',
      durationMs: 0,
      phases: {} as any,
      summary: {
        leadsProcessed: 0,
        actionsGenerated: 0,
        tasksCreated: 0,
        alertsRaised: 0,
        escalations: 0,
        overrides: 0,
        followUpsExecuted: 0,
        remindersGenerated: 0,
      },
    };

    try {
      // ── Phase 1: State Analysis ──────────────────────────
      result.phases.stateAnalysis = await this.phaseStateAnalysis();

      // ── Phase 2: Detection Scan ──────────────────────────
      result.phases.detectionScan = await this.phaseDetectionScan();

      // ── Phase 3: Action Assignment ───────────────────────
      result.phases.actionAssignment = await this.phaseActionAssignment();

      // ── Phase 4: Task Generation ─────────────────────────
      result.phases.taskGeneration = await this.phaseTaskGeneration();

      // ── Phase 5: Prioritization ──────────────────────────
      result.phases.prioritization = await this.phasePrioritization();

      // ── Phase 6: Owner Assignment ────────────────────────
      result.phases.ownerAssignment = await this.phaseOwnerAssignment();

      // ── Phase 7: Execution Monitor ───────────────────────
      result.phases.executionMonitor = await this.phaseExecutionMonitor();

      // ── Phase 8: Escalation ──────────────────────────────
      result.phases.escalation = await this.phaseEscalation();

      // Build summary
      result.summary = this.buildCycleSummary(result.phases);

      this.logger.log(`\n✅ ORCHESTRATION CYCLE COMPLETE`);
      this.logger.log(
        `   Leads: ${result.summary.leadsProcessed} | Tasks: ${result.summary.tasksCreated} | Alerts: ${result.summary.alertsRaised} | Escalations: ${result.summary.escalations}`,
      );
    } catch (err: any) {
      this.logger.error(`❌ Orchestration cycle failed: ${err.message}`);
    } finally {
      const completedAt = new Date();
      result.completedAt = completedAt.toISOString();
      result.durationMs = completedAt.getTime() - startedAt.getTime();
      this.lastCycleResult = result;
      this.cyclesToday++;
      this.isRunning = false;
    }

    return result;
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 1: STATE ANALYSIS — Snapshot of all leads & pipeline
  // ═══════════════════════════════════════════════════════════

  private async phaseStateAnalysis(): Promise<PhaseResult> {
    const start = Date.now();
    this.logger.log('📊 Phase 1: State Analysis...');

    try {
      // Count active leads and pipeline value
      const [activeLeads, pipelineAgg, todayTasks] = await Promise.all([
        this.prisma.lead.count({
          where: {
            status: { notIn: TERMINAL_STATUSES as any },
            deletedAt: null,
            isHistorical: false,
          },
        }),
        this.prisma.lead.aggregate({
          where: {
            status: { notIn: TERMINAL_STATUSES as any },
            deletedAt: null,
            isHistorical: false,
          },
          _sum: { estimatedValue: true },
          _count: true,
        }),
        this.prisma.salesTask.groupBy({
          by: ['status'],
          where: {
            dueDate: {
              gte: new Date(new Date().setHours(0, 0, 0, 0)),
              lt: new Date(new Date().setHours(23, 59, 59, 999)),
            },
            isHistorical: false,
          },
          _count: true,
        }),
      ]);

      const details = {
        activeLeads,
        pipelineValue: pipelineAgg._sum.estimatedValue || 0,
        todayTaskBreakdown: todayTasks.reduce(
          (acc, t) => ({ ...acc, [t.status]: t._count }),
          {},
        ),
      };

      this.updateAgentStatus('PriorityEngine', 'active', details);

      return {
        phase: 'stateAnalysis',
        status: 'success',
        count: activeLeads,
        durationMs: Date.now() - start,
        details,
      };
    } catch (err: any) {
      this.logger.error(`Phase 1 failed: ${err.message}`);
      return {
        phase: 'stateAnalysis',
        status: 'failed',
        count: 0,
        durationMs: Date.now() - start,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 2: DETECTION SCAN — Inactivity, stuck deals, issues
  // ═══════════════════════════════════════════════════════════

  private async phaseDetectionScan(): Promise<PhaseResult> {
    const start = Date.now();
    this.logger.log('🔍 Phase 2: Detection Scan...');

    try {
      const [inactivity, stuckDeals, performanceIssues] = await Promise.all([
        this.supervisorAgent.detectInactivity(),
        this.supervisorAgent.detectStuckDeals(),
        this.executionDiscipline.detectPerformanceIssues(),
      ]);

      this.updateAgentStatus('SupervisorAgent', 'active', {
        inactiveAdvisors: inactivity.length,
        stuckDeals: stuckDeals.length,
      });
      this.updateAgentStatus('ExecutionDiscipline', 'active', {
        performanceIssues: performanceIssues.length,
      });

      const totalDetected =
        inactivity.length + stuckDeals.length + performanceIssues.length;

      return {
        phase: 'detectionScan',
        status: 'success',
        count: totalDetected,
        durationMs: Date.now() - start,
        details: {
          inactiveAdvisors: inactivity.length,
          stuckDeals: stuckDeals.length,
          performanceIssues: performanceIssues.length,
          stuckDealsSample: stuckDeals.slice(0, 5),
        },
      };
    } catch (err: any) {
      this.logger.error(`Phase 2 failed: ${err.message}`);
      return {
        phase: 'detectionScan',
        status: 'failed',
        count: 0,
        durationMs: Date.now() - start,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 3: ACTION ASSIGNMENT — Decide next action per lead
  // ═══════════════════════════════════════════════════════════

  private async phaseActionAssignment(): Promise<PhaseResult> {
    const start = Date.now();
    this.logger.log('🎯 Phase 3: Action Assignment...');

    try {
      // Get all active leads
      const activeLeads = await this.prisma.lead.findMany({
        where: {
          status: { notIn: TERMINAL_STATUSES as any },
          deletedAt: null,
          isHistorical: false,
        },
        include: {
          assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });

      // Get lead IDs that have pending/in_progress tasks
      const leadsWithPendingTasks = await this.prisma.salesTask.findMany({
        where: {
          status: { in: ['pending', 'in_progress'] },
          leadId: { not: null },
          isHistorical: false,
        },
        select: { leadId: true, dueDate: true },
        orderBy: { createdAt: 'desc' },
      });
      const pendingTaskMap = new Map<string, Date>();
      for (const t of leadsWithPendingTasks) {
        if (t.leadId && !pendingTaskMap.has(t.leadId)) {
          pendingTaskMap.set(t.leadId, t.dueDate);
        }
      }

      // Get lead IDs with active follow-up sequences
      const leadsWithSequences = await this.prisma.followUpSequence.findMany({
        where: { status: 'active' },
        select: { leadId: true },
        distinct: ['leadId'],
      });
      const sequenceLeadIds = new Set(leadsWithSequences.map((s: any) => s.leadId));

      let decisionsCount = 0;
      const decisions: LeadDecision[] = [];

      for (const lead of activeLeads) {
        const hasPendingTask = pendingTaskMap.has(lead.id);
        const hasActiveSequence = sequenceLeadIds.has(lead.id);
        const daysSinceContact = lead.lastContactedAt
          ? Math.floor(
              (Date.now() - new Date(lead.lastContactedAt).getTime()) /
                (1000 * 60 * 60 * 24),
            )
          : null;
        const value = lead.estimatedValue || 0;

        // Score the lead
        const scored = this.priorityEngine.scoreLead(lead as any);

        let decision: LeadDecision['decision'] = 'no_action';
        let reason = '';
        let urgency: LeadDecision['urgency'] = 'low';

        if (!hasPendingTask && !hasActiveSequence) {
          // No active task AND no sequence → generate task
          decision = 'generate_task';
          reason = 'Sin tarea activa ni secuencia de seguimiento';
          urgency = value >= HIGH_VALUE_THRESHOLD ? 'high' : 'medium';
          decisionsCount++;
        } else if (hasPendingTask) {
          const taskDue = pendingTaskMap.get(lead.id)!;
          if (new Date(taskDue) < new Date()) {
            // Has overdue task → send reminder
            decision = 'send_reminder';
            reason = `Tarea vencida desde ${taskDue.toISOString().slice(0, 10)}`;
            urgency = 'high';
            decisionsCount++;
          }
        }

        // Override: high-value lead without recent contact
        if (
          value >= OVERRIDE_THRESHOLDS.CRITICAL_DEAL_VALUE &&
          daysSinceContact !== null &&
          daysSinceContact > 3
        ) {
          decision = 'override_priority';
          reason = `Deal crítico ($${(value / 1000).toFixed(0)}K) sin contacto en ${daysSinceContact} días`;
          urgency = 'critical';
          decisionsCount++;
        }

        // No assigned advisor → needs reassignment
        if (!lead.assignedToId && decision !== 'no_action') {
          decision = 'reassign';
          reason = 'Lead sin asesor asignado';
          urgency = 'high';
        }

        if (decision !== 'no_action') {
          decisions.push({
            leadId: lead.id,
            companyName: lead.companyName,
            currentStatus: lead.status,
            assignedTo: lead.assignedTo ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}` : null,
            estimatedValue: value,
            daysSinceLastContact: daysSinceContact,
            priorityScore: scored.score,
            decision,
            reason,
            urgency,
          });
        }
      }

      return {
        phase: 'actionAssignment',
        status: 'success',
        count: decisionsCount,
        durationMs: Date.now() - start,
        details: {
          totalLeadsAnalyzed: activeLeads.length,
          decisionsGenerated: decisions.length,
          byDecision: decisions.reduce(
            (acc, d) => {
              acc[d.decision] = (acc[d.decision] || 0) + 1;
              return acc;
            },
            {} as Record<string, number>,
          ),
          byUrgency: decisions.reduce(
            (acc, d) => {
              acc[d.urgency] = (acc[d.urgency] || 0) + 1;
              return acc;
            },
            {} as Record<string, number>,
          ),
          topCritical: decisions
            .filter((d: any) => d.urgency === 'critical')
            .slice(0, 5),
        },
      };
    } catch (err: any) {
      this.logger.error(`Phase 3 failed: ${err.message}`);
      return {
        phase: 'actionAssignment',
        status: 'failed',
        count: 0,
        durationMs: Date.now() - start,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 4: TASK GENERATION — Create/update tasks via engine
  // ═══════════════════════════════════════════════════════════

  private async phaseTaskGeneration(): Promise<PhaseResult> {
    const start = Date.now();
    this.logger.log('📝 Phase 4: Task Generation...');

    try {
      const result = await this.executionEngine.generateTasks();
      this.updateAgentStatus('ExecutionEngine', 'active', result);

      return {
        phase: 'taskGeneration',
        status: 'success',
        count: result.totalCreated,
        durationMs: Date.now() - start,
        details: result,
      };
    } catch (err: any) {
      this.logger.error(`Phase 4 failed: ${err.message}`);
      this.updateAgentStatus('ExecutionEngine', 'error');
      return {
        phase: 'taskGeneration',
        status: 'failed',
        count: 0,
        durationMs: Date.now() - start,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 5: PRIORITIZATION — Score all leads, apply overrides
  // ═══════════════════════════════════════════════════════════

  private async phasePrioritization(): Promise<PhaseResult> {
    const start = Date.now();
    this.logger.log('⚡ Phase 5: Prioritization & Overrides...');

    try {
      const [topLeads, topDeals, advisorLists] = await Promise.all([
        this.priorityEngine.getTopLeadsOfDay(20),
        this.priorityEngine.getTopDealsToPush(15),
        this.priorityEngine.getAdvisorPriorityLists(),
      ]);

      // Apply priority overrides for critical deals
      this.priorityOverrides = [];
      for (const deal of topDeals) {
        const dealValue = deal.estimatedValue || 0;
        if (
          dealValue >= OVERRIDE_THRESHOLDS.CRITICAL_DEAL_VALUE &&
          deal.daysSinceContact !== null &&
          deal.daysSinceContact > 3
        ) {
          this.priorityOverrides.push({
            leadId: deal.id,
            previousPriority: deal.score,
            newPriority: 100, // max priority
            reason: `Deal crítico $${(dealValue / 1000).toFixed(0)}K sin contacto ${deal.daysSinceContact}d`,
            triggeredBy: 'value',
          });
        }
      }

      // Generate director priorities
      await this.generateDirectorPriorities(topDeals);

      this.updateAgentStatus('PriorityEngine', 'active', {
        topLeads: topLeads.length,
        topDeals: topDeals.length,
        overrides: this.priorityOverrides.length,
      });

      return {
        phase: 'prioritization',
        status: 'success',
        count: topLeads.length + topDeals.length,
        durationMs: Date.now() - start,
        details: {
          topLeadsCount: topLeads.length,
          topDealsCount: topDeals.length,
          advisorListsCount: advisorLists.length,
          overridesApplied: this.priorityOverrides.length,
          overrides: this.priorityOverrides.slice(0, 5),
        },
      };
    } catch (err: any) {
      this.logger.error(`Phase 5 failed: ${err.message}`);
      return {
        phase: 'prioritization',
        status: 'failed',
        count: 0,
        durationMs: Date.now() - start,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 6: OWNER ASSIGNMENT — Distribute unassigned leads
  // ═══════════════════════════════════════════════════════════

  private async phaseOwnerAssignment(): Promise<PhaseResult> {
    const start = Date.now();
    this.logger.log('👥 Phase 6: Owner Assignment...');

    try {
      // Check for unassigned leads
      const unassigned = await this.prisma.lead.count({
        where: {
          assignedToId: null,
          status: { notIn: TERMINAL_STATUSES as any },
          deletedAt: null,
          isHistorical: false,
        },
      });

      let distributed = 0;
      if (unassigned > 0) {
        const result = await this.teamManagement.autoDistribute();
        distributed = (result as any)?.distributed || 0;
      }

      this.updateAgentStatus('TeamManagement', 'active', {
        unassigned,
        distributed,
      });

      return {
        phase: 'ownerAssignment',
        status: 'success',
        count: distributed,
        durationMs: Date.now() - start,
        details: {
          unassignedBefore: unassigned,
          distributed,
        },
      };
    } catch (err: any) {
      this.logger.error(`Phase 6 failed: ${err.message}`);
      return {
        phase: 'ownerAssignment',
        status: 'failed',
        count: 0,
        durationMs: Date.now() - start,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 7: EXECUTION MONITOR — Follow-ups, reminders, alerts
  // ═══════════════════════════════════════════════════════════

  private async phaseExecutionMonitor(): Promise<PhaseResult> {
    const start = Date.now();
    this.logger.log('📡 Phase 7: Execution Monitor...');

    try {
      // Execute pending follow-up steps
      const followUpResult = await this.followUpAutomation.executePendingSteps();
      this.updateAgentStatus('FollowUpAutomation', 'active', followUpResult);

      // Generate discipline reminders
      const reminders = await this.executionDiscipline.generateReminders();
      this.updateAgentStatus('ExecutionDiscipline', 'active', {
        reminders: reminders.length,
      });

      // Generate fresh alerts
      const alertResult = await this.alertIntelligence.generateAlerts();
      this.updateAgentStatus('AlertIntelligence', 'active', alertResult);

      return {
        phase: 'executionMonitor',
        status: 'success',
        count:
          followUpResult.executed + reminders.length + alertResult.created,
        durationMs: Date.now() - start,
        details: {
          followUps: followUpResult,
          remindersGenerated: reminders.length,
          alertsCreated: alertResult.created,
          alertTypes: alertResult.types,
        },
      };
    } catch (err: any) {
      this.logger.error(`Phase 7 failed: ${err.message}`);
      return {
        phase: 'executionMonitor',
        status: 'failed',
        count: 0,
        durationMs: Date.now() - start,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 8: ESCALATION — Auto-escalate unresolved issues
  // ═══════════════════════════════════════════════════════════

  private async phaseEscalation(): Promise<PhaseResult> {
    const start = Date.now();
    this.logger.log('🚨 Phase 8: Escalation...');

    try {
      let escalationCount = 0;

      // Find overdue tasks > 24h that haven't been escalated
      const overdueTasks = await this.prisma.salesTask.findMany({
        where: {
          status: { in: ['pending', 'in_progress'] },
          dueDate: {
            lt: new Date(Date.now() - STALE_TASK_HOURS * 60 * 60 * 1000),
          },
          isHistorical: false,
        },
        select: {
          id: true,
          advisorId: true,
          leadId: true,
          title: true,
          dueDate: true,
        },
        take: 50,
      });

      // Resolve advisor names for grouping
      const advisorIds = [...new Set(overdueTasks.map((t: any) => t.advisorId))];
      const advisors = await this.prisma.user.findMany({
        where: { id: { in: advisorIds } },
        select: { id: true, firstName: true, lastName: true },
      });
      const advisorNameMap = new Map(
        advisors.map((a) => [a.id, `${a.firstName} ${a.lastName}`]),
      );

      // Group by advisor — if advisor has 3+ overdue, escalate
      const advisorOverdue = new Map<
        string,
        { name: string; count: number; tasks: any[] }
      >();
      for (const task of overdueTasks) {
        const advisorId = task.advisorId || 'unassigned';
        const advisorName = advisorNameMap.get(advisorId) || 'Sin asignar';
        if (!advisorOverdue.has(advisorId)) {
          advisorOverdue.set(advisorId, {
            name: advisorName,
            count: 0,
            tasks: [],
          });
        }
        const entry = advisorOverdue.get(advisorId)!;
        entry.count++;
        entry.tasks.push(task);
      }

      // Escalate advisors with too many overdue tasks
      const escalated: string[] = [];
      for (const [advisorId, data] of advisorOverdue) {
        if (
          data.count >= OVERRIDE_THRESHOLDS.OVERDUE_TASKS_ESCALATE &&
          advisorId !== 'unassigned'
        ) {
          // Create escalation alert
          await this.prisma.salesAlert.create({
            data: {
              type: 'orchestration_escalation',
              severity: 'critical',
              title: `Escalación automática: ${data.name} tiene ${data.count} tareas vencidas`,
              message: `El asesor ${data.name} acumula ${data.count} tareas vencidas (>24h). Se requiere intervención del supervisor. Acción: Revisar carga de trabajo, considerar redistribución.`,
              status: 'open',
              leadId: data.tasks[0]?.leadId || null,
              advisorId: advisorId !== 'unassigned' ? advisorId : null,
            },
          });
          escalated.push(data.name);
          escalationCount++;
        }
      }

      // High-value leads without contact > 5 days → director escalation
      const highValueNoContact = await this.prisma.lead.findMany({
        where: {
          status: { notIn: TERMINAL_STATUSES as any },
          deletedAt: null,
          isHistorical: false,
          estimatedValue: { gte: OVERRIDE_THRESHOLDS.HIGH_DEAL_VALUE },
          lastContactedAt: {
            lt: new Date(
              Date.now() -
                OVERRIDE_THRESHOLDS.STUCK_DAYS_ESCALATE *
                  24 *
                  60 *
                  60 *
                  1000,
            ),
          },
        },
        include: {
          assignedTo: { select: { firstName: true, lastName: true } },
        },
        take: 20,
      });

      for (const lead of highValueNoContact) {
        // Check if already escalated recently
        const recentEscalation = await this.prisma.salesAlert.findFirst({
          where: {
            leadId: lead.id,
            type: 'orchestration_escalation',
            createdAt: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
            },
          },
        });

        if (!recentEscalation) {
          const advisorName = lead.assignedTo
            ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`
            : 'Sin asignar';
          await this.prisma.salesAlert.create({
            data: {
              type: 'orchestration_escalation',
              severity: 'critical',
              title: `Deal alto valor sin contacto: ${lead.companyName}`,
              message: `${lead.companyName} — $${((lead.estimatedValue || 0) / 1000).toFixed(0)}K sin contacto en ${OVERRIDE_THRESHOLDS.STUCK_DAYS_ESCALATE}+ días. Asesor: ${advisorName}. Acción: Contactar inmediatamente o reasignar.`,
              status: 'open',
              leadId: lead.id,
              advisorId: lead.assignedToId,
            },
          });
          escalationCount++;
        }
      }

      return {
        phase: 'escalation',
        status: 'success',
        count: escalationCount,
        durationMs: Date.now() - start,
        details: {
          overdueTasksFound: overdueTasks.length,
          advisorsEscalated: escalated,
          highValueNoContact: highValueNoContact.length,
          totalEscalations: escalationCount,
        },
      };
    } catch (err: any) {
      this.logger.error(`Phase 8 failed: ${err.message}`);
      return {
        phase: 'escalation',
        status: 'failed',
        count: 0,
        durationMs: Date.now() - start,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // DIRECTOR PRIORITIES — Personal priority list for Andrés
  // ═══════════════════════════════════════════════════════════

  @Cron('0 0 8 * * 1-6') // Every day at 8 AM
  async generateDirectorPrioritiesCron() {
    this.logger.log('👔 Generating director priorities for Andrés...');
    try {
      const topDeals = await this.priorityEngine.getTopDealsToPush(30);
      await this.generateDirectorPriorities(topDeals);
    } catch (err: any) {
      this.logger.error(`Director priorities failed: ${err.message}`);
    }
  }

  private async generateDirectorPriorities(topDeals: any[]) {
    const priorities: DirectorPriorityItem[] = [];

    // 1. Andrés's own deals
    const andresDeals = await this.prisma.lead.findMany({
      where: {
        assignedToId: DIRECTOR_ID,
        status: { notIn: TERMINAL_STATUSES as any },
        deletedAt: null,
        isHistorical: false,
      },
      include: {
        assignedTo: { select: { firstName: true, lastName: true } },
      },
      orderBy: { estimatedValue: 'desc' },
      take: 10,
    });

    for (const deal of andresDeals) {
      const daysSince = deal.lastContactedAt
        ? Math.floor(
            (Date.now() - new Date(deal.lastContactedAt).getTime()) /
              (1000 * 60 * 60 * 24),
          )
        : null;
      priorities.push({
        leadId: deal.id,
        companyName: deal.companyName,
        status: deal.status,
        estimatedValue: deal.estimatedValue || 0,
        daysSinceLastContact: daysSince,
        assignedAdvisor: 'Andrés (Director)',
        urgency:
          daysSince !== null && daysSince > 3
            ? 'critical'
            : daysSince !== null && daysSince > 1
              ? 'high'
              : 'medium',
        action:
          daysSince !== null && daysSince > 3
            ? 'Contactar URGENTE'
            : 'Dar seguimiento',
        reason: 'Deal personal del director',
      });
    }

    // 2. Critical deals from team
    for (const deal of topDeals) {
      if (deal.estimatedValue >= CRITICAL_VALUE_THRESHOLD) {
        priorities.push({
          leadId: deal.id,
          companyName: deal.companyName || 'N/A',
          status: deal.status,
          estimatedValue: deal.estimatedValue,
          daysSinceLastContact: deal.daysSinceContact,
          assignedAdvisor: deal.assignedTo
            ? `${deal.assignedTo.firstName} ${deal.assignedTo.lastName}`
            : 'Sin asignar',
          urgency: 'critical',
          action: 'Supervisar cierre',
          reason: `Deal >$500K en ${deal.status}`,
        });
      }
    }

    // 3. Bottlenecks detected
    try {
      const bottlenecks = await this.commercialDirector.detectBottlenecks();
      for (const b of (bottlenecks || []).slice(0, 3)) {
        priorities.push({
          leadId: '',
          companyName: `Bottleneck: ${(b as any).stage || (b as any).type}`,
          status: 'N/A',
          estimatedValue: (b as any).valueAtRisk || 0,
          daysSinceLastContact: null,
          assignedAdvisor: 'Equipo',
          urgency: 'high',
          action: (b as any).recommendation || 'Revisar cuello de botella',
          reason: (b as any).description || 'Bottleneck detectado',
        });
      }
    } catch {
      // Non-critical
    }

    // 4. Risk alerts
    try {
      const risks = await this.commercialDirector.getRiskAlerts();
      for (const r of (risks || []).slice(0, 3)) {
        priorities.push({
          leadId: (r as any).leadId || '',
          companyName: (r as any).title || 'Riesgo detectado',
          status: 'N/A',
          estimatedValue: (r as any).valueAtRisk || 0,
          daysSinceLastContact: null,
          assignedAdvisor: (r as any).advisor || 'Equipo',
          urgency: 'high',
          action: (r as any).action || 'Tomar acción',
          reason: (r as any).reason || 'Alerta de riesgo',
        });
      }
    } catch {
      // Non-critical
    }

    // Sort by urgency then value
    const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2 };
    priorities.sort((a: any, b: any) => {
      const uDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      if (uDiff !== 0) return uDiff;
      return b.estimatedValue - a.estimatedValue;
    });

    this.directorPriorities = priorities.slice(0, 20);
    this.logger.log(
      `👔 Director priorities updated: ${this.directorPriorities.length} items`,
    );
  }

  // ═══════════════════════════════════════════════════════════
  // PUBLIC API METHODS
  // ═══════════════════════════════════════════════════════════

  /** Full orchestration status with all metrics */
  async getOrchestrationStatus(): Promise<OrchestrationStatus> {
    const now = new Date();
    const minutesSinceHour = now.getMinutes();
    const nextRun45 = 45 - (minutesSinceHour % 45);
    const nextScheduled = new Date(
      now.getTime() + nextRun45 * 60 * 1000,
    ).toISOString();

    // Build realtime metrics
    const metrics = await this.getRealTimeMetrics();

    // Determine system health
    let health: 'optimal' | 'degraded' | 'critical' = 'optimal';
    if (
      metrics.leadsWithoutNextAction > 20 ||
      metrics.overdueTasksCount > 15
    ) {
      health = 'degraded';
    }
    if (
      metrics.leadsWithoutNextAction > 50 ||
      metrics.inactiveAdvisorsCount > 3
    ) {
      health = 'critical';
    }

    return {
      isRunning: this.isRunning,
      lastCycleAt: this.lastCycleResult?.completedAt || null,
      lastCycleDurationMs: this.lastCycleResult?.durationMs || null,
      totalCyclesToday: this.cyclesToday,
      nextScheduledRun: nextScheduled,
      systemHealth: health,
      agentStatuses: Array.from(this.agentStatuses.values()),
      directorPriorities: this.directorPriorities,
      realtimeMetrics: metrics,
    };
  }

  /** Real-time system metrics */
  async getRealTimeMetrics(): Promise<RealtimeMetrics> {
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
    const todayEnd = new Date(new Date().setHours(23, 59, 59, 999));

    const [
      activeLeads,
      leadsWithoutTask,
      overdueTasks,
      stuckDeals,
      todayCompleted,
      todayTotal,
      pipelineAgg,
      highValueAtRisk,
    ] = await Promise.all([
      // Active leads
      this.prisma.lead.count({
        where: {
          status: { notIn: TERMINAL_STATUSES as any },
          deletedAt: null,
          isHistorical: false,
        },
      }),
      // Leads without any pending task (count via raw query)
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT l.id)::bigint as count
        FROM leads l
        WHERE l.status NOT IN ('CERRADO_GANADO', 'CERRADO_PERDIDO', 'LEAD_BASURA', 'CONTACTAR_FUTURO')
          AND l.deleted_at IS NULL
          AND l.is_historical = false
          AND NOT EXISTS (
            SELECT 1 FROM sales_tasks st
            WHERE st.lead_id = l.id
              AND st.status IN ('pending', 'in_progress')
          )
      `.then((r) => Number(r[0]?.count || 0)),
      // Overdue tasks
      this.prisma.salesTask.count({
        where: {
          status: { in: ['pending', 'in_progress'] },
          dueDate: { lt: new Date() },
          isHistorical: false,
        },
      }),
      // Stuck deals (COTIZACION_ENTREGADA for 3+ days)
      this.prisma.lead.count({
        where: {
          status: 'COTIZACION_ENTREGADA' as any,
          updatedAt: {
            lt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
          },
          deletedAt: null,
          isHistorical: false,
        },
      }),
      // Today completed tasks
      this.prisma.salesTask.count({
        where: {
          status: 'completed',
          completedAt: { gte: todayStart, lte: todayEnd },
          isHistorical: false,
        },
      }),
      // Today total tasks
      this.prisma.salesTask.count({
        where: {
          dueDate: { gte: todayStart, lte: todayEnd },
          isHistorical: false,
        },
      }),
      // Pipeline value
      this.prisma.lead.aggregate({
        where: {
          status: { notIn: TERMINAL_STATUSES as any },
          deletedAt: null,
          isHistorical: false,
        },
        _sum: { estimatedValue: true },
      }),
      // High value at risk (>$200K, no contact 5+ days)
      this.prisma.lead.aggregate({
        where: {
          status: { notIn: TERMINAL_STATUSES as any },
          deletedAt: null,
          isHistorical: false,
          estimatedValue: { gte: OVERRIDE_THRESHOLDS.HIGH_DEAL_VALUE },
          lastContactedAt: {
            lt: new Date(
              Date.now() -
                OVERRIDE_THRESHOLDS.STUCK_DAYS_ESCALATE *
                  24 *
                  60 *
                  60 *
                  1000,
            ),
          },
        },
        _sum: { estimatedValue: true },
      }),
    ]);

    // Inactive advisors (no task completed today)
    const TEAM_EMAILS = [
      'jaime.nav@iealanis.com',
      'j.pimentel@iealanis.com',
      'atencion@iealanis.com',
      'jenifer@iealanis.com',
      'mariana@iealanis.com',
    ];
    const teamMembers = await this.prisma.user.findMany({
      where: { email: { in: TEAM_EMAILS } },
      select: { id: true },
    });
    const teamIds = teamMembers.map((m: any) => m.id);
    const advisorsWithActivity = await this.prisma.salesTask.findMany({
      where: {
        status: 'completed',
        completedAt: { gte: todayStart },
        advisorId: { in: teamIds },
        isHistorical: false,
      },
      select: { advisorId: true },
      distinct: ['advisorId'],
    });
    const inactiveCount = Math.max(
      0,
      teamIds.length - advisorsWithActivity.length,
    );

    return {
      activeLeads,
      leadsWithoutNextAction: leadsWithoutTask,
      overdueTasksCount: overdueTasks,
      stuckDealsCount: stuckDeals,
      inactiveAdvisorsCount: inactiveCount,
      todayTasksCompleted: todayCompleted,
      todayTasksTotal: todayTotal,
      completionRate:
        todayTotal > 0
          ? Math.round((todayCompleted / todayTotal) * 100)
          : 0,
      pipelineValue: pipelineAgg._sum.estimatedValue || 0,
      highValueAtRisk: highValueAtRisk._sum.estimatedValue || 0,
    };
  }

  /** Get last cycle result */
  getLastCycleResult(): OrchestrationCycleResult | null {
    return this.lastCycleResult;
  }

  /** Get director priorities for Andrés */
  getDirectorPriorities(): DirectorPriorityItem[] {
    return this.directorPriorities;
  }

  /** Get all priority overrides in current cycle */
  getPriorityOverrides(): PriorityOverride[] {
    return this.priorityOverrides;
  }

  /** Full system sync — runs all agents in sequence */
  async fullSystemSync(): Promise<{
    orchestration: OrchestrationCycleResult;
    automationEngine: any;
    followUpScan: any;
    alerts: any;
  }> {
    this.logger.log('🔁 FULL SYSTEM SYNC initiated...');

    const orchestration = await this.runOrchestrationCycle();

    // Additional automation pass
    let automationEngine: any = null;
    try {
      automationEngine = await this.automationEngine.runAllAutomations();
      this.updateAgentStatus('AutomationEngine', 'active', automationEngine);
    } catch (err: any) {
      this.logger.error(`AutomationEngine sync failed: ${err.message}`);
      this.updateAgentStatus('AutomationEngine', 'error');
    }

    // Scan for new follow-up enrollments
    let followUpScan: any = null;
    try {
      followUpScan = await this.followUpAutomation.scanAndEnroll();
      this.updateAgentStatus('FollowUpAutomation', 'active', followUpScan);
    } catch (err: any) {
      this.logger.error(`FollowUp scan failed: ${err.message}`);
    }

    // Fresh alert generation
    let alerts: any = null;
    try {
      alerts = await this.alertIntelligence.generateAlerts();
      this.updateAgentStatus('AlertIntelligence', 'active', alerts);
    } catch (err: any) {
      this.logger.error(`Alert generation failed: ${err.message}`);
    }

    return { orchestration, automationEngine, followUpScan, alerts };
  }

  /** Director's complete dashboard — everything Andrés needs */
  async getDirectorDashboard(): Promise<{
    status: OrchestrationStatus;
    personalPriorities: DirectorPriorityItem[];
    directorBriefing: any;
    teamDiscipline: any;
    strategicRecommendations: any;
    riskAlerts: any;
    lastCycle: OrchestrationCycleResult | null;
  }> {
    const [
      status,
      directorBriefing,
      teamDiscipline,
      strategicRecs,
      riskAlerts,
    ] = await Promise.all([
      this.getOrchestrationStatus(),
      this.followUpIntelligence
        .getDirectorBriefing()
        .catch(() => null),
      this.executionDiscipline
        .getTeamDisciplineReport(7)
        .catch(() => null),
      this.commercialDirector
        .getStrategicRecommendations()
        .catch(() => null),
      this.commercialDirector.getRiskAlerts().catch(() => null),
    ]);

    this.updateAgentStatus('FollowUpIntelligence', 'active');
    this.updateAgentStatus('CommercialDirector', 'active');

    return {
      status,
      personalPriorities: this.directorPriorities,
      directorBriefing,
      teamDiscipline,
      strategicRecommendations: strategicRecs,
      riskAlerts,
      lastCycle: this.lastCycleResult,
    };
  }

  // ── Helpers ─────────────────────────────────────────────

  private updateAgentStatus(
    agent: string,
    status: 'active' | 'idle' | 'error',
    lastResult?: any,
  ) {
    this.agentStatuses.set(agent, {
      agent,
      lastRun: new Date().toISOString(),
      status,
      lastResult,
    });
  }

  private buildCycleSummary(
    phases: OrchestrationCycleResult['phases'],
  ): OrchestrationCycleResult['summary'] {
    return {
      leadsProcessed:
        phases.stateAnalysis?.details?.activeLeads ||
        phases.actionAssignment?.details?.totalLeadsAnalyzed ||
        0,
      actionsGenerated: phases.actionAssignment?.count || 0,
      tasksCreated: phases.taskGeneration?.count || 0,
      alertsRaised:
        phases.executionMonitor?.details?.alertsCreated || 0,
      escalations: phases.escalation?.count || 0,
      overrides: phases.prioritization?.details?.overridesApplied || 0,
      followUpsExecuted:
        phases.executionMonitor?.details?.followUps?.executed || 0,
      remindersGenerated:
        phases.executionMonitor?.details?.remindersGenerated || 0,
    };
  }
}
