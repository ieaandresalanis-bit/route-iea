import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { ClientLifecycleService } from '../client-lifecycle/client-lifecycle.service';
import { MultiChannelService } from '../multi-channel/multi-channel.service';
import { AlertIntelligenceService } from '../alert-intelligence/alert-intelligence.service';
import { ExecutionEngineService } from '../execution-engine/execution-engine.service';

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

/** Experience events calendar — auto-generated communications */
const EXPERIENCE_EVENTS = {
  WELCOME: { dayOffset: 0, channel: 'whatsapp', type: 'welcome' },
  CONFIRMATION: { dayOffset: 3, channel: 'whatsapp', type: 'confirmation' },
  SATISFACTION_15: { dayOffset: 15, channel: 'whatsapp', type: 'satisfaction' },
  PERFORMANCE_30: { dayOffset: 30, channel: 'call', type: 'performance' },
  QUARTERLY_90: { dayOffset: 90, channel: 'whatsapp', type: 'upsell' },
  SEMESTER_180: { dayOffset: 180, channel: 'whatsapp', type: 'referral' },
  ANNUAL_365: { dayOffset: 365, channel: 'call', type: 'anniversary' },
} as const;

const CHURN_THRESHOLD = 60;
const EXPANSION_THRESHOLD = 65;
const SATISFACTION_HIGH = 8;
const SATISFACTION_LOW = 5;
const INACTIVE_DAYS = 45;
const CRITICAL_INACTIVE_DAYS = 90;

// ═══════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════

export interface AgentCycleResult {
  agent: string;
  actionsGenerated: number;
  clientsProcessed: number;
  alerts: number;
  tasks: number;
  duration: number;
  details: Record<string, any>;
}

export interface CustomerSuccessCycleResult {
  cycleId: string;
  startedAt: string;
  completedAt: string;
  duration: number;
  agents: AgentCycleResult[];
  totalActions: number;
  totalAlerts: number;
  totalTasks: number;
  kpiSnapshot: ExperienceKPIs;
}

export interface ExperienceKPIs {
  totalClients: number;
  activeClients: number;
  atRiskClients: number;
  avgSatisfaction: number | null;
  retentionRate: number;
  contactFrequencyDays: number;
  referralRate: number;
  expansionRate: number;
  totalLTV: number;
  avgLTV: number;
  expansionRevenue: number;
  referralRevenue: number;
  npsAvg: number | null;
  clientsWithoutContact30d: number;
  pendingSteps: number;
  overdueSteps: number;
  completedStepsThisMonth: number;
}

export interface AgentStatus {
  name: string;
  role: string;
  lastRun: string | null;
  nextRun: string;
  status: 'active' | 'idle' | 'error';
  actionsLastCycle: number;
  description: string;
}

export interface DirectorClientView {
  healthScore: number;
  topRisks: Array<{ client: string; risk: number; reason: string; value: number }>;
  topExpansions: Array<{ client: string; score: number; type: string; value: number }>;
  referralPipeline: Array<{ client: string; referrals: number; revenue: number }>;
  pendingActions: number;
  overdueActions: number;
  recommendations: string[];
}

export interface SupervisorView {
  advisorPerformance: Array<{
    advisorId: string;
    advisorName: string;
    clientCount: number;
    completedSteps: number;
    pendingSteps: number;
    overdueSteps: number;
    avgSatisfaction: number | null;
    missedInteractions: number;
  }>;
  teamKPIs: {
    totalCompletedThisWeek: number;
    totalOverdue: number;
    avgResponseTime: number;
    clientsCovered: number;
    clientsNeglected: number;
  };
}

export interface DepartmentStatus {
  status: 'operational' | 'degraded' | 'offline' | 'idle';
  agents: AgentStatus[];
  lastCycleResult: CustomerSuccessCycleResult | null;
  kpis: ExperienceKPIs;
  directorView: DirectorClientView;
  supervisorView: SupervisorView;
}

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

@Injectable()
export class CustomerSuccessService {
  private readonly log = new Logger(CustomerSuccessService.name);
  private lastCycleResult: CustomerSuccessCycleResult | null = null;
  private agentLastRun: Record<string, string> = {};

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: ClientLifecycleService,
    private readonly multiChannel: MultiChannelService,
    private readonly alertIntelligence: AlertIntelligenceService,
    private readonly executionEngine: ExecutionEngineService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // CRON — Main cycle every 60 min (Mon-Sat, 7am-7pm)
  // ═══════════════════════════════════════════════════════════

  @Cron('0 15 7-19 * * 1-6')
  async runCustomerSuccessCycle(): Promise<CustomerSuccessCycleResult> {
    const start = Date.now();
    const cycleId = `cs-${Date.now()}`;
    this.log.log(`[${cycleId}] Customer Success cycle starting...`);

    // Phase 0: Sync new clients from won leads
    await this.lifecycle.syncClientsFromWonLeads();

    // Run all 4 agents
    const agents: AgentCycleResult[] = [];

    const successResult = await this.runSuccessAgent();
    agents.push(successResult);

    const experienceResult = await this.runExperienceAgent();
    agents.push(experienceResult);

    const retentionResult = await this.runRetentionAgent();
    agents.push(retentionResult);

    const upsellResult = await this.runUpsellAgent();
    agents.push(upsellResult);

    // Capture KPI snapshot
    const kpis = await this.getExperienceKPIs();

    const result: CustomerSuccessCycleResult = {
      cycleId,
      startedAt: new Date(start).toISOString(),
      completedAt: new Date().toISOString(),
      duration: Date.now() - start,
      agents,
      totalActions: agents.reduce((s, a) => s + a.actionsGenerated, 0),
      totalAlerts: agents.reduce((s, a) => s + a.alerts, 0),
      totalTasks: agents.reduce((s, a) => s + a.tasks, 0),
      kpiSnapshot: kpis,
    };

    this.lastCycleResult = result;
    this.log.log(
      `[${cycleId}] Cycle complete: ${result.totalActions} actions, ${result.totalAlerts} alerts, ${result.totalTasks} tasks in ${result.duration}ms`,
    );
    return result;
  }

  // ═══════════════════════════════════════════════════════════
  // AGENT 1: Customer Success Agent
  // Monitors client health, detects at-risk clients, ensures
  // every client has a next step.
  // ═══════════════════════════════════════════════════════════

  private async runSuccessAgent(): Promise<AgentCycleResult> {
    const start = Date.now();
    const agentName = 'Customer Success Agent';
    this.agentLastRun[agentName] = new Date().toISOString();

    let actionsGenerated = 0;
    let alerts = 0;
    let tasks = 0;

    try {
      const clients = await this.prisma.clientProfile.findMany({
        include: { postSaleSteps: true },
      });
      const now = new Date();

      const atRisk: string[] = [];
      const readyForExpansion: string[] = [];
      const readyForReferral: string[] = [];
      const noNextStep: string[] = [];

      for (const client of clients) {
        const daysSinceContact = client.lastContactedAt
          ? Math.floor((now.getTime() - new Date(client.lastContactedAt).getTime()) / 86400000)
          : 999;

        // Classify client health
        if (client.churnRisk >= CHURN_THRESHOLD || daysSinceContact >= CRITICAL_INACTIVE_DAYS) {
          atRisk.push(client.id);
        }
        if (client.expansionScore >= EXPANSION_THRESHOLD) {
          readyForExpansion.push(client.id);
        }
        if (
          client.satisfactionScore &&
          client.satisfactionScore >= SATISFACTION_HIGH &&
          client.referralCount === 0
        ) {
          readyForReferral.push(client.id);
        }

        // Ensure every client has a pending step
        const hasPendingStep = client.postSaleSteps.some((s) => s.status === 'pending');
        if (!hasPendingStep && client.lifecycleStage !== 'INACTIVE_CLIENT') {
          noNextStep.push(client.id);
        }
      }

      // Generate sequences for clients without next steps
      for (const clientId of noNextStep) {
        try {
          await this.lifecycle.generatePostSaleSequence(clientId);
          tasks++;
          actionsGenerated++;
        } catch {
          // Sequence already exists — skip
        }
      }

      // Generate client alerts for at-risk
      const alertResult = await this.lifecycle.generateClientAlerts();
      alerts = alertResult.generated;
      actionsGenerated += alerts;

      return {
        agent: agentName,
        actionsGenerated,
        clientsProcessed: clients.length,
        alerts,
        tasks,
        duration: Date.now() - start,
        details: {
          atRisk: atRisk.length,
          readyForExpansion: readyForExpansion.length,
          readyForReferral: readyForReferral.length,
          noNextStep: noNextStep.length,
          sequencesGenerated: tasks,
        },
      };
    } catch (err: any) {
      this.log.error(`[${agentName}] Error: ${err.message}`);
      return {
        agent: agentName,
        actionsGenerated,
        clientsProcessed: 0,
        alerts,
        tasks,
        duration: Date.now() - start,
        details: { error: err.message },
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // AGENT 2: Experience Agent
  // Manages automated communications: welcome, satisfaction,
  // performance reviews, birthdays, anniversaries.
  // ═══════════════════════════════════════════════════════════

  private async runExperienceAgent(): Promise<AgentCycleResult> {
    const start = Date.now();
    const agentName = 'Experience Agent';
    this.agentLastRun[agentName] = new Date().toISOString();

    let actionsGenerated = 0;
    let alerts = 0;
    let tasks = 0;

    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart.getTime() + 86400000);

      // Find overdue pending steps that should be executed
      const overdueSteps = await this.prisma.postSaleStep.findMany({
        where: {
          status: 'pending',
          scheduledAt: { lt: now },
        },
        include: {
          client: { select: { id: true, companyName: true, contactName: true, advisorId: true } },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 50,
      });

      // Auto-execute overdue steps (mark as ready for advisor action)
      for (const step of overdueSteps) {
        // Create a SalesTask for the advisor to execute the communication
        if (step.client.advisorId) {
          await this.prisma.salesTask.create({
            data: {
              advisorId: step.client.advisorId,
              title: `[Post-Venta] ${step.subject ?? step.stepType} — ${step.client.companyName}`,
              description: `${step.messageBody}\n\nCanal: ${step.channel}\nCliente: ${step.client.contactName} (${step.client.companyName})`,
              type: 'client_followup',
              priority: step.stepType === 'satisfaction_check' ? 'high' : 'medium',
              status: 'pending',
              dueDate: now,
            },
          });
          tasks++;
        }

        actionsGenerated++;
      }

      // Check for installation anniversaries (clients whose installationDate is today's month/day)
      const clients = await this.prisma.clientProfile.findMany({
        where: {
          installationDate: { not: null },
          lifecycleStage: { notIn: ['INACTIVE_CLIENT'] },
        },
        select: {
          id: true,
          companyName: true,
          contactName: true,
          advisorId: true,
          installationDate: true,
          becameClientAt: true,
        },
      });

      for (const client of clients) {
        const installDate = client.installationDate ?? client.becameClientAt;
        if (
          installDate.getMonth() === now.getMonth() &&
          installDate.getDate() === now.getDate() &&
          installDate.getFullYear() < now.getFullYear()
        ) {
          const years = now.getFullYear() - installDate.getFullYear();

          // Create anniversary task
          if (client.advisorId) {
            await this.prisma.salesTask.create({
              data: {
                advisorId: client.advisorId,
                title: `🎉 Aniversario ${years} año(s) — ${client.companyName}`,
                description: `Hoy se cumplen ${years} año(s) desde la instalacion de ${client.contactName} en ${client.companyName}. Enviar mensaje de felicitacion y explorar oportunidades de expansion o referidos.`,
                type: 'client_followup',
                priority: 'medium',
                status: 'pending',
                dueDate: now,
              },
            });
            tasks++;
            actionsGenerated++;
          }
        }
      }

      return {
        agent: agentName,
        actionsGenerated,
        clientsProcessed: clients.length + overdueSteps.length,
        alerts,
        tasks,
        duration: Date.now() - start,
        details: {
          overdueStepsProcessed: overdueSteps.length,
          anniversariesDetected: actionsGenerated - overdueSteps.length,
          tasksCreated: tasks,
        },
      };
    } catch (err: any) {
      this.log.error(`[${agentName}] Error: ${err.message}`);
      return {
        agent: agentName,
        actionsGenerated,
        clientsProcessed: 0,
        alerts,
        tasks,
        duration: Date.now() - start,
        details: { error: err.message },
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // AGENT 3: Retention Agent
  // Detects churn risk, triggers interventions, manages
  // reactivation of inactive clients.
  // ═══════════════════════════════════════════════════════════

  private async runRetentionAgent(): Promise<AgentCycleResult> {
    const start = Date.now();
    const agentName = 'Retention Agent';
    this.agentLastRun[agentName] = new Date().toISOString();

    let actionsGenerated = 0;
    let alerts = 0;
    let tasks = 0;

    try {
      const now = new Date();
      const clients = await this.prisma.clientProfile.findMany({
        include: { postSaleSteps: true },
      });

      const interventions: Array<{ clientId: string; type: string; reason: string }> = [];

      for (const client of clients) {
        const daysSinceContact = client.lastContactedAt
          ? Math.floor((now.getTime() - new Date(client.lastContactedAt).getTime()) / 86400000)
          : 999;

        // Detect clients going inactive (45+ days without contact)
        if (
          daysSinceContact >= INACTIVE_DAYS &&
          daysSinceContact < CRITICAL_INACTIVE_DAYS &&
          client.lifecycleStage !== 'INACTIVE_CLIENT'
        ) {
          interventions.push({
            clientId: client.id,
            type: 'early_intervention',
            reason: `${daysSinceContact} dias sin contacto — intervenir antes de perder relacion`,
          });

          // Create urgent task for advisor
          if (client.advisorId) {
            await this.prisma.salesTask.create({
              data: {
                advisorId: client.advisorId,
                title: `⚠️ Retencion: ${client.companyName} sin contacto ${daysSinceContact}d`,
                description: `El cliente ${client.contactName} de ${client.companyName} no ha sido contactado en ${daysSinceContact} dias. Zona: ${client.zone ?? 'N/A'}. LTV: $${Math.round(client.lifetimeValue).toLocaleString()}. Contactar inmediatamente para mantener la relacion.`,
                type: 'client_followup',
                priority: 'high',
                status: 'pending',
                dueDate: now,
              },
            });
            tasks++;
          }
          actionsGenerated++;
        }

        // Detect critical inactivity (90+ days) — transition to inactive
        if (
          daysSinceContact >= CRITICAL_INACTIVE_DAYS &&
          client.lifecycleStage !== 'INACTIVE_CLIENT'
        ) {
          await this.lifecycle.transitionLifecycleStage(
            client.id,
            'INACTIVE_CLIENT',
            `Automatico: ${daysSinceContact} dias sin contacto`,
          );
          interventions.push({
            clientId: client.id,
            type: 'transition_inactive',
            reason: `Transicionado a inactivo automaticamente (${daysSinceContact}d sin contacto)`,
          });
          actionsGenerated++;
        }

        // Low satisfaction intervention
        if (
          client.satisfactionScore &&
          client.satisfactionScore <= SATISFACTION_LOW &&
          client.lifecycleStage !== 'INACTIVE_CLIENT'
        ) {
          if (client.advisorId) {
            // Check if there's already a pending satisfaction task
            const existingTask = await this.prisma.salesTask.findFirst({
              where: {
                advisorId: client.advisorId,
                type: 'client_followup',
                status: 'pending',
                AND: [
                  { title: { contains: client.companyName } },
                  { title: { contains: 'Satisfaccion' } },
                ],
              },
            });
            if (!existingTask) {
              await this.prisma.salesTask.create({
                data: {
                  advisorId: client.advisorId,
                  title: `🚨 Satisfaccion baja: ${client.companyName} (${client.satisfactionScore}/10)`,
                  description: `El cliente ${client.contactName} reporto satisfaccion de ${client.satisfactionScore}/10. ${client.satisfactionNotes ?? 'Sin notas adicionales'}. Agendar visita presencial y ofrecer solucion concreta.`,
                  type: 'client_followup',
                  priority: 'urgent',
                  status: 'pending',
                  dueDate: now,
                },
              });
              tasks++;
              actionsGenerated++;
            }
          }
        }

        // High churn risk — escalate to director
        if (client.churnRisk >= 80 && client.lifetimeValue >= 200000) {
          interventions.push({
            clientId: client.id,
            type: 'director_escalation',
            reason: `Churn ${client.churnRisk}% en cliente LTV $${Math.round(client.lifetimeValue).toLocaleString()}`,
          });
          alerts++;
        }
      }

      // Recalculate churn scores
      await this.recalculateChurnScores();

      return {
        agent: agentName,
        actionsGenerated,
        clientsProcessed: clients.length,
        alerts,
        tasks,
        duration: Date.now() - start,
        details: {
          interventions: interventions.length,
          earlyInterventions: interventions.filter((i) => i.type === 'early_intervention').length,
          transitionsToInactive: interventions.filter((i) => i.type === 'transition_inactive').length,
          directorEscalations: interventions.filter((i) => i.type === 'director_escalation').length,
          lowSatisfactionAlerts: interventions.filter((i) => i.type === 'satisfaction_low').length,
        },
      };
    } catch (err: any) {
      this.log.error(`[${agentName}] Error: ${err.message}`);
      return {
        agent: agentName,
        actionsGenerated,
        clientsProcessed: 0,
        alerts,
        tasks,
        duration: Date.now() - start,
        details: { error: err.message },
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // AGENT 4: Upsell & Expansion Agent
  // Detects expansion opportunities, triggers referral
  // requests, manages cross-sell pipeline.
  // ═══════════════════════════════════════════════════════════

  private async runUpsellAgent(): Promise<AgentCycleResult> {
    const start = Date.now();
    const agentName = 'Upsell & Expansion Agent';
    this.agentLastRun[agentName] = new Date().toISOString();

    let actionsGenerated = 0;
    let alerts = 0;
    let tasks = 0;

    try {
      const now = new Date();

      // Recalculate expansion scores first
      await this.lifecycle.recalculateExpansionScores();

      // Get expansion opportunities
      const expansionClients = await this.prisma.clientProfile.findMany({
        where: {
          expansionScore: { gte: EXPANSION_THRESHOLD },
          lifecycleStage: { notIn: ['INACTIVE_CLIENT'] },
        },
        orderBy: { expansionScore: 'desc' },
        take: 30,
      });

      for (const client of expansionClients) {
        // Check if there's already an expansion task pending
        const existingTask = await this.prisma.salesTask.findFirst({
          where: {
            advisorId: client.advisorId ?? undefined,
            type: { in: ['client_followup', 'upsell'] },
            status: 'pending',
            title: { contains: client.companyName },
          },
        });

        if (!existingTask && client.advisorId) {
          const expansionLabel =
            client.expansionType === 'expansion'
              ? 'ampliacion de sistema'
              : client.expansionType === 'upgrade'
                ? 'upgrade de equipo'
                : 'venta cruzada';

          await this.prisma.salesTask.create({
            data: {
              advisorId: client.advisorId,
              title: `📈 Expansion: ${client.companyName} (score ${client.expansionScore})`,
              description: `Oportunidad de ${expansionLabel} para ${client.contactName} en ${client.companyName}. Score: ${client.expansionScore}/100. ${client.hasMultipleLocations ? 'Tiene multiples ubicaciones.' : ''} Valor estimado: $${Math.round((client.avgProjectValue || 0) * 0.5).toLocaleString()}.`,
              type: 'upsell',
              priority: client.expansionScore >= 80 ? 'high' : 'medium',
              status: 'pending',
              dueDate: new Date(now.getTime() + 7 * 86400000), // due in 7 days
            },
          });
          tasks++;
          actionsGenerated++;
        }
      }

      // Referral detection — satisfied clients without referral requests
      const referralCandidates = await this.prisma.clientProfile.findMany({
        where: {
          satisfactionScore: { gte: SATISFACTION_HIGH },
          referralCount: 0,
          lifecycleStage: { notIn: ['INACTIVE_CLIENT'] },
        },
        include: {
          postSaleSteps: {
            where: { stepType: 'referral_request', status: 'sent' },
          },
        },
        orderBy: { satisfactionScore: 'desc' },
        take: 20,
      });

      for (const client of referralCandidates) {
        // Skip if referral request already sent
        if (client.postSaleSteps.length > 0) continue;

        const daysSinceClient = Math.floor(
          (now.getTime() - new Date(client.becameClientAt).getTime()) / 86400000,
        );

        // Only ask for referrals after 60+ days as client
        if (daysSinceClient < 60) continue;

        if (client.advisorId) {
          const existingTask = await this.prisma.salesTask.findFirst({
            where: {
              advisorId: client.advisorId,
              type: 'client_followup',
              status: 'pending',
              AND: [
                { title: { contains: 'Referido' } },
                { title: { contains: client.companyName } },
              ],
            },
          });

          if (!existingTask) {
            await this.prisma.salesTask.create({
              data: {
                advisorId: client.advisorId,
                title: `🤝 Pedir referido: ${client.companyName} (sat. ${client.satisfactionScore}/10)`,
                description: `${client.contactName} tiene satisfaccion ${client.satisfactionScore}/10. Cliente hace ${daysSinceClient} dias. Pedir referidos: "Conoce a alguien que pueda beneficiarse de energia solar?" Ofrecer incentivo.`,
                type: 'client_followup',
                priority: 'medium',
                status: 'pending',
                dueDate: new Date(now.getTime() + 5 * 86400000),
              },
            });
            tasks++;
            actionsGenerated++;
          }
        }
      }

      return {
        agent: agentName,
        actionsGenerated,
        clientsProcessed: expansionClients.length + referralCandidates.length,
        alerts,
        tasks,
        duration: Date.now() - start,
        details: {
          expansionOpportunities: expansionClients.length,
          expansionTasksCreated: expansionClients.length,
          referralCandidates: referralCandidates.length,
          referralTasksCreated: tasks - expansionClients.length,
        },
      };
    } catch (err: any) {
      this.log.error(`[${agentName}] Error: ${err.message}`);
      return {
        agent: agentName,
        actionsGenerated,
        clientsProcessed: 0,
        alerts,
        tasks,
        duration: Date.now() - start,
        details: { error: err.message },
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // KPIs — Client Experience Metrics
  // ═══════════════════════════════════════════════════════════

  async getExperienceKPIs(): Promise<ExperienceKPIs> {
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 86400000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalClients,
      activeClients,
      atRiskClients,
      allClients,
      clientsNoContact30d,
      pendingSteps,
      overdueSteps,
      completedThisMonth,
      referralStats,
    ] = await Promise.all([
      this.prisma.clientProfile.count(),
      this.prisma.clientProfile.count({
        where: { lifecycleStage: { notIn: ['INACTIVE_CLIENT'] } },
      }),
      this.prisma.clientProfile.count({
        where: { churnRisk: { gte: CHURN_THRESHOLD } },
      }),
      this.prisma.clientProfile.findMany({
        select: {
          lifetimeValue: true,
          satisfactionScore: true,
          npsScore: true,
          referralCount: true,
          referralRevenue: true,
          expansionScore: true,
          lastContactedAt: true,
          lifecycleStage: true,
        },
      }),
      this.prisma.clientProfile.count({
        where: {
          OR: [
            { lastContactedAt: { lt: d30 } },
            { lastContactedAt: null },
          ],
          lifecycleStage: { notIn: ['INACTIVE_CLIENT'] },
        },
      }),
      this.prisma.postSaleStep.count({ where: { status: 'pending' } }),
      this.prisma.postSaleStep.count({
        where: { status: 'pending', scheduledAt: { lt: now } },
      }),
      this.prisma.postSaleStep.count({
        where: { status: 'sent', sentAt: { gte: monthStart } },
      }),
      this.prisma.referral.groupBy({
        by: ['status'],
        _count: true,
        _sum: { revenue: true },
      }),
    ]);

    const totalLTV = allClients.reduce((s, c) => s + c.lifetimeValue, 0);
    const scored = allClients.filter((c) => c.satisfactionScore);
    const avgSatisfaction =
      scored.length > 0
        ? +(scored.reduce((s, c) => s + (c.satisfactionScore ?? 0), 0) / scored.length).toFixed(1)
        : null;

    const npsScored = allClients.filter((c) => c.npsScore != null);
    const npsAvg =
      npsScored.length > 0
        ? Math.round(npsScored.reduce((s, c) => s + (c.npsScore ?? 0), 0) / npsScored.length)
        : null;

    const retentionRate =
      totalClients > 0
        ? +((activeClients / totalClients) * 100).toFixed(1)
        : 100;

    const withContact = allClients.filter((c) => c.lastContactedAt);
    const contactFrequencyDays =
      withContact.length > 0
        ? Math.round(
            withContact.reduce((s, c) => {
              const days = Math.floor(
                (now.getTime() - new Date(c.lastContactedAt!).getTime()) / 86400000,
              );
              return s + days;
            }, 0) / withContact.length,
          )
        : 0;

    const totalReferrals = allClients.reduce((s, c) => s + c.referralCount, 0);
    const referralRate =
      totalClients > 0 ? +((allClients.filter((c) => c.referralCount > 0).length / totalClients) * 100).toFixed(1) : 0;

    const expansionCandidates = allClients.filter((c) => c.expansionScore >= EXPANSION_THRESHOLD);
    const expansionRate =
      totalClients > 0 ? +((expansionCandidates.length / totalClients) * 100).toFixed(1) : 0;

    const referralRevenue = allClients.reduce((s, c) => s + c.referralRevenue, 0);

    return {
      totalClients,
      activeClients,
      atRiskClients,
      avgSatisfaction,
      retentionRate,
      contactFrequencyDays,
      referralRate,
      expansionRate,
      totalLTV: Math.round(totalLTV),
      avgLTV: totalClients > 0 ? Math.round(totalLTV / totalClients) : 0,
      expansionRevenue: Math.round(
        expansionCandidates.reduce((s, c) => s + c.lifetimeValue * 0.3, 0),
      ),
      referralRevenue: Math.round(referralRevenue),
      npsAvg,
      clientsWithoutContact30d: clientsNoContact30d,
      pendingSteps,
      overdueSteps,
      completedStepsThisMonth: completedThisMonth,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // DIRECTOR VIEW — Strategic client health overview
  // ═══════════════════════════════════════════════════════════

  async getDirectorView(): Promise<DirectorClientView> {
    const clients = await this.prisma.clientProfile.findMany({
      orderBy: { lifetimeValue: 'desc' },
    });
    const now = new Date();

    // Health score: weighted average of retention, satisfaction, engagement
    const active = clients.filter((c) => c.lifecycleStage !== 'INACTIVE_CLIENT');
    const retentionPct = clients.length > 0 ? (active.length / clients.length) * 100 : 100;
    const scored = clients.filter((c) => c.satisfactionScore);
    const avgSat = scored.length > 0
      ? scored.reduce((s, c) => s + (c.satisfactionScore ?? 0), 0) / scored.length
      : 7;
    const avgChurn = clients.length > 0
      ? clients.reduce((s, c) => s + c.churnRisk, 0) / clients.length
      : 0;

    const healthScore = Math.round(
      retentionPct * 0.4 + (avgSat * 10) * 0.3 + (100 - avgChurn) * 0.3,
    );

    // Top risks
    const topRisks = clients
      .filter((c) => c.churnRisk >= 50)
      .sort((a, b) => b.churnRisk - a.churnRisk)
      .slice(0, 10)
      .map((c) => ({
        client: c.companyName,
        risk: c.churnRisk,
        reason: c.churnReason ?? 'Inactividad prolongada',
        value: Math.round(c.lifetimeValue),
      }));

    // Top expansions
    const topExpansions = clients
      .filter((c) => c.expansionScore >= 60)
      .sort((a, b) => b.expansionScore - a.expansionScore)
      .slice(0, 10)
      .map((c) => ({
        client: c.companyName,
        score: c.expansionScore,
        type: c.expansionType ?? 'expansion',
        value: Math.round(c.avgProjectValue * 0.5),
      }));

    // Referral pipeline
    const referralSources = clients
      .filter((c) => c.referralCount > 0)
      .sort((a, b) => b.referralRevenue - a.referralRevenue)
      .slice(0, 10)
      .map((c) => ({
        client: c.companyName,
        referrals: c.referralCount,
        revenue: Math.round(c.referralRevenue),
      }));

    // Pending + overdue actions
    const pendingActions = await this.prisma.postSaleStep.count({
      where: { status: 'pending' },
    });
    const overdueActions = await this.prisma.postSaleStep.count({
      where: { status: 'pending', scheduledAt: { lt: now } },
    });

    // Strategic recommendations
    const recommendations: string[] = [];
    if (topRisks.length >= 3) {
      const totalAtRiskValue = topRisks.reduce((s, r) => s + r.value, 0);
      recommendations.push(
        `${topRisks.length} clientes en riesgo con LTV total de $${totalAtRiskValue.toLocaleString()}. Priorizar retencion.`,
      );
    }
    if (topExpansions.length >= 5) {
      const totalExpValue = topExpansions.reduce((s, e) => s + e.value, 0);
      recommendations.push(
        `${topExpansions.length} oportunidades de expansion por $${totalExpValue.toLocaleString()}. Asignar seguimiento.`,
      );
    }
    if (overdueActions > 5) {
      recommendations.push(
        `${overdueActions} acciones post-venta vencidas. Revisar carga de trabajo del equipo.`,
      );
    }
    const noContactClients = clients.filter((c) => {
      const days = c.lastContactedAt
        ? Math.floor((now.getTime() - new Date(c.lastContactedAt).getTime()) / 86400000)
        : 999;
      return days >= 30 && c.lifecycleStage !== 'INACTIVE_CLIENT';
    });
    if (noContactClients.length > 0) {
      recommendations.push(
        `${noContactClients.length} clientes activos sin contacto en 30+ dias. Activar campana de retencion.`,
      );
    }
    if (referralSources.length === 0) {
      recommendations.push(
        'Sin referidos activos. Lanzar programa de referidos con clientes satisfechos.',
      );
    }
    if (recommendations.length === 0) {
      recommendations.push('Operacion post-venta saludable. Mantener ritmo de seguimiento.');
    }

    return {
      healthScore,
      topRisks,
      topExpansions,
      referralPipeline: referralSources,
      pendingActions,
      overdueActions,
      recommendations,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // SUPERVISOR VIEW — Team performance on client success
  // ═══════════════════════════════════════════════════════════

  async getSupervisorView(): Promise<SupervisorView> {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);

    // Get team members
    const teamUsers = await this.prisma.user.findMany({
      where: { email: { in: TEAM_EMAILS } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    const advisorPerformance = [];

    for (const user of teamUsers) {
      const [clientCount, completedSteps, pendingSteps, overdueSteps] = await Promise.all([
        this.prisma.clientProfile.count({ where: { advisorId: user.id } }),
        this.prisma.postSaleStep.count({
          where: {
            client: { advisorId: user.id },
            status: 'sent',
            sentAt: { gte: weekStart },
          },
        }),
        this.prisma.postSaleStep.count({
          where: {
            client: { advisorId: user.id },
            status: 'pending',
          },
        }),
        this.prisma.postSaleStep.count({
          where: {
            client: { advisorId: user.id },
            status: 'pending',
            scheduledAt: { lt: now },
          },
        }),
      ]);

      // Avg satisfaction of their clients
      const clientsSat = await this.prisma.clientProfile.findMany({
        where: { advisorId: user.id, satisfactionScore: { not: null } },
        select: { satisfactionScore: true },
      });
      const avgSat =
        clientsSat.length > 0
          ? +(clientsSat.reduce((s, c) => s + (c.satisfactionScore ?? 0), 0) / clientsSat.length).toFixed(1)
          : null;

      // Missed interactions: clients without contact 30+ days
      const missedInteractions = await this.prisma.clientProfile.count({
        where: {
          advisorId: user.id,
          lifecycleStage: { notIn: ['INACTIVE_CLIENT'] },
          OR: [
            { lastContactedAt: { lt: new Date(now.getTime() - 30 * 86400000) } },
            { lastContactedAt: null },
          ],
        },
      });

      advisorPerformance.push({
        advisorId: user.id,
        advisorName: `${user.firstName} ${user.lastName}`,
        clientCount,
        completedSteps,
        pendingSteps,
        overdueSteps,
        avgSatisfaction: avgSat,
        missedInteractions,
      });
    }

    // Team KPIs
    const totalCompleted = advisorPerformance.reduce((s, a) => s + a.completedSteps, 0);
    const totalOverdue = advisorPerformance.reduce((s, a) => s + a.overdueSteps, 0);
    const totalClients = advisorPerformance.reduce((s, a) => s + a.clientCount, 0);
    const totalNeglected = advisorPerformance.reduce((s, a) => s + a.missedInteractions, 0);

    return {
      advisorPerformance,
      teamKPIs: {
        totalCompletedThisWeek: totalCompleted,
        totalOverdue,
        avgResponseTime: 0, // Placeholder — would need step execution timestamps
        clientsCovered: totalClients - totalNeglected,
        clientsNeglected: totalNeglected,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // DEPARTMENT STATUS — Full system health
  // ═══════════════════════════════════════════════════════════

  async getDepartmentStatus(): Promise<DepartmentStatus> {
    const agents = this.getAgentStatuses();
    const kpis = await this.getExperienceKPIs();
    const directorView = await this.getDirectorView();
    const supervisorView = await this.getSupervisorView();

    const hasErrors = agents.some((a) => a.status === 'error');
    const allIdle = agents.every((a) => a.status === 'idle');

    return {
      status: hasErrors ? 'degraded' : allIdle ? 'idle' : 'operational',
      agents,
      lastCycleResult: this.lastCycleResult,
      kpis,
      directorView,
      supervisorView,
    };
  }

  getAgentStatuses(): AgentStatus[] {
    const agentDefs = [
      {
        name: 'Customer Success Agent',
        role: 'Monitorea salud de clientes, detecta riesgo, asegura siguiente paso',
        description: 'Analiza todos los clientes, identifica at-risk/expansion/referral, genera secuencias post-venta',
      },
      {
        name: 'Experience Agent',
        role: 'Automatiza comunicaciones y experiencia del cliente',
        description: 'Ejecuta pasos pendientes, detecta aniversarios, genera tareas de comunicacion',
      },
      {
        name: 'Retention Agent',
        role: 'Detecta churn, interviene proactivamente, gestiona reactivaciones',
        description: 'Intervenciones tempranas (45d), transicion a inactivo (90d), escalacion a director',
      },
      {
        name: 'Upsell & Expansion Agent',
        role: 'Detecta oportunidades de expansion, solicita referidos',
        description: 'Recalcula scores de expansion, genera tareas de upsell y referidos',
      },
    ];

    return agentDefs.map((def) => ({
      ...def,
      lastRun: this.agentLastRun[def.name] ?? null,
      nextRun: this.getNextCronRun(),
      status: this.agentLastRun[def.name] ? 'active' : 'idle',
      actionsLastCycle: this.lastCycleResult?.agents.find((a) => a.agent === def.name)?.actionsGenerated ?? 0,
    }));
  }

  getLastCycleResult(): CustomerSuccessCycleResult | null {
    return this.lastCycleResult;
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════

  private async recalculateChurnScores() {
    const clients = await this.prisma.clientProfile.findMany();
    const now = new Date();
    let updated = 0;

    for (const client of clients) {
      let risk = 0;

      const daysSinceContact = client.lastContactedAt
        ? Math.floor((now.getTime() - new Date(client.lastContactedAt).getTime()) / 86400000)
        : 999;

      // No contact penalty
      if (daysSinceContact >= 90) risk += 40;
      else if (daysSinceContact >= 60) risk += 25;
      else if (daysSinceContact >= 30) risk += 10;

      // Low satisfaction
      if (client.satisfactionScore && client.satisfactionScore <= 3) risk += 30;
      else if (client.satisfactionScore && client.satisfactionScore <= 5) risk += 15;

      // No recent activity
      if (client.lifecycleStage === 'INACTIVE_CLIENT') risk += 20;

      // Positive signals reduce risk
      if (client.referralCount > 0) risk -= 10;
      if (client.satisfactionScore && client.satisfactionScore >= 8) risk -= 15;
      if (client.expansionScore >= 70) risk -= 10;

      risk = Math.max(0, Math.min(100, risk));

      if (risk !== client.churnRisk) {
        const reason =
          risk >= 60
            ? `Riesgo alto: ${daysSinceContact}d sin contacto, sat. ${client.satisfactionScore ?? 'N/A'}/10`
            : null;
        await this.prisma.clientProfile.update({
          where: { id: client.id },
          data: { churnRisk: risk, churnReason: reason ?? client.churnReason },
        });
        updated++;
      }
    }

    this.log.debug(`Churn scores recalculated: ${updated}/${clients.length} updated`);
  }

  private getNextCronRun(): string {
    const now = new Date();
    const next = new Date(now);
    next.setMinutes(15, 0, 0);
    if (next <= now) {
      next.setHours(next.getHours() + 1);
    }
    // Ensure within working hours (7-19) and weekday (1-6)
    while (next.getHours() < 7 || next.getHours() > 19 || next.getDay() === 0) {
      if (next.getHours() > 19) {
        next.setDate(next.getDate() + 1);
        next.setHours(7, 15, 0, 0);
      } else if (next.getHours() < 7) {
        next.setHours(7, 15, 0, 0);
      } else {
        next.setDate(next.getDate() + 1);
      }
    }
    return next.toISOString();
  }
}
