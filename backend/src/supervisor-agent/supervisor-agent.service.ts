import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';

// ═══════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════

const DIRECTOR_ID = '9b9d9e50-0097-4848-a197-5d7f4bd0ef50';
const DIRECTOR_EMAIL = 'admin@iea.com';

const STUCK_THRESHOLDS: Record<string, number> = {
  COTIZACION_ENTREGADA: 3,
  ESPERANDO_COTIZACION: 5,
  ESPERANDO_CONTRATO: 7,
};

const STUCK_STAGES = Object.keys(STUCK_THRESHOLDS);

const INACTIVE_HOURS_THRESHOLD = 4;
const OVERDUE_TASK_THRESHOLD = 5;
const HIGH_VALUE_THRESHOLD = 50000;
const INACTIVE_LEAD_VALUE_THRESHOLD = 100000;
const INACTIVE_LEAD_DAYS = 7;

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface AdvisorStatus {
  advisorId: string;
  advisorName: string;
  email: string;
  tasksToday: number;
  completed: number;
  pending: number;
  overdue: number;
  lastActivity: string | null;
  activeLeads: number;
  pipelineValue: number;
  completionRate: number;
  isInactive: boolean;
}

export interface StuckDeal {
  leadId: string;
  companyName: string;
  contactName: string;
  stage: string;
  daysStuck: number;
  currentAdvisor: string;
  advisorId: string;
  estimatedValue: number;
  riskLevel: string;
  recommendedAction: string;
}

export interface InactivityReport {
  advisorId: string;
  advisorName: string;
  email: string;
  hoursSinceLastActivity: number;
  overdueCount: number;
  recommendation: string;
}

export interface UrgentAction {
  type: string;
  priority: string;
  description: string;
  entityId: string;
  entityType: string;
  advisorName?: string;
  estimatedValue?: number;
  metadata?: Record<string, any>;
}

export interface PreparedMessage {
  channel: string;
  recipient: string;
  subject?: string;
  body: string;
  templateKey?: string;
  variables: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

@Injectable()
export class SupervisorAgentService {
  private readonly logger = new Logger('SupervisorAgent');

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────
  // 1. PANEL DE CONTROL EN TIEMPO REAL
  // ─────────────────────────────────────────────────────────

  async getNetoControlPanel() {
    this.logger.log('Generando panel de control de Neto');

    try {
      const [
        teamStatus,
        alerts,
        stuckDeals,
        inactiveLeads,
        channelQueue,
      ] = await Promise.all([
        this.getTeamStatus(),
        this.getActiveAlerts(),
        this.detectStuckDeals(),
        this.getInactiveHighValueLeads(),
        this.getChannelQueue(),
      ]);

      const urgentActions = await this.buildUrgentActions(
        teamStatus,
        alerts,
        stuckDeals,
        inactiveLeads,
      );

      return {
        teamStatus,
        alerts,
        stuckDeals,
        inactiveLeads,
        urgentActions,
        channelQueue,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Error generando panel de control', error);
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────
  // 2. MOTOR DE DETECCION
  // ─────────────────────────────────────────────────────────

  async detectInactivity(): Promise<InactivityReport[]> {
    this.logger.log('Detectando inactividad de asesores');

    try {
      const now = new Date();
      const hour = now.getHours();
      const day = now.getDay(); // 0=Sun, 6=Sat

      // Solo durante horario laboral (Lun-Sab 8-18)
      if (day === 0 || hour < 8 || hour > 18) {
        this.logger.log('Fuera de horario laboral, omitiendo deteccion');
        return [];
      }

      const advisors = await this.prisma.user.findMany({
        where: { isActive: true, role: { in: ['OPERATOR', 'OPERATIONS'] as any } },
        select: { id: true, firstName: true, lastName: true, email: true },
      });

      const results: InactivityReport[] = [];
      const thresholdTime = new Date(now.getTime() - INACTIVE_HOURS_THRESHOLD * 60 * 60 * 1000);
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      for (const advisor of advisors) {
        // Buscar ultima actividad completada
        const lastCompleted = await this.prisma.salesTask.findFirst({
          where: { advisorId: advisor.id, status: 'completed', isHistorical: false },
          orderBy: { completedAt: 'desc' },
          select: { completedAt: true },
        });

        // Contar tareas vencidas
        const overdueCount = await this.prisma.salesTask.count({
          where: {
            advisorId: advisor.id,
            status: { in: ['pending', 'in_progress'] },
            dueDate: { lt: now },
            isHistorical: false,
          },
        });

        // Contar completadas hoy
        const completedToday = await this.prisma.salesTask.count({
          where: {
            advisorId: advisor.id,
            status: 'completed',
            completedAt: { gte: todayStart },
            isHistorical: false,
          },
        });

        const lastActivityTime = lastCompleted?.completedAt;
        const isInactive = completedToday === 0 && (!lastActivityTime || lastActivityTime < thresholdTime);
        const hasExcessiveOverdue = overdueCount > OVERDUE_TASK_THRESHOLD;

        if (isInactive || hasExcessiveOverdue) {
          const hoursSince = lastActivityTime
            ? Math.round((now.getTime() - lastActivityTime.getTime()) / (1000 * 60 * 60) * 10) / 10
            : 999;

          let recommendation = '';
          if (hoursSince > 8) {
            recommendation = 'Contactar inmediatamente. Sin actividad en todo el dia.';
          } else if (hoursSince > INACTIVE_HOURS_THRESHOLD) {
            recommendation = `Sin actividad por ${hoursSince}h. Verificar disponibilidad.`;
          }
          if (hasExcessiveOverdue) {
            recommendation += ` ${overdueCount} tareas vencidas - considerar reasignacion.`;
          }

          results.push({
            advisorId: advisor.id,
            advisorName: `${advisor.firstName} ${advisor.lastName}`,
            email: advisor.email,
            hoursSinceLastActivity: hoursSince,
            overdueCount,
            recommendation: recommendation.trim(),
          });
        }
      }

      this.logger.log(`Inactividad detectada: ${results.length} asesores`);
      return results;
    } catch (error) {
      this.logger.error('Error detectando inactividad', error);
      throw error;
    }
  }

  async detectStuckDeals(): Promise<StuckDeal[]> {
    this.logger.log('Detectando tratos estancados');

    try {
      const now = new Date();
      const results: StuckDeal[] = [];

      for (const stage of STUCK_STAGES) {
        const thresholdDays = STUCK_THRESHOLDS[stage];
        const thresholdDate = new Date(now.getTime() - thresholdDays * 24 * 60 * 60 * 1000);

        const stuckLeads = await this.prisma.lead.findMany({
          where: {
            status: stage as any,
            updatedAt: { lt: thresholdDate },
            estimatedValue: { gte: HIGH_VALUE_THRESHOLD },
            deletedAt: null,
            isHistorical: false,
          },
          include: {
            assignedTo: { select: { id: true, firstName: true, lastName: true } },
          },
        });

        for (const lead of stuckLeads) {
          const daysStuck = Math.floor(
            (now.getTime() - lead.updatedAt.getTime()) / (1000 * 60 * 60 * 24),
          );

          const riskLevel =
            daysStuck > thresholdDays * 2
              ? 'critico'
              : daysStuck > thresholdDays * 1.5
                ? 'alto'
                : 'medio';

          let recommendedAction = 'llamada_urgente';
          if (riskLevel === 'critico') {
            recommendedAction = 'escalar_director';
          } else if ((lead.estimatedValue || 0) > 300000) {
            recommendedAction = 'visita_presencial';
          }

          results.push({
            leadId: lead.id,
            companyName: lead.companyName,
            contactName: lead.contactName,
            stage,
            daysStuck,
            currentAdvisor: lead.assignedTo
              ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`
              : 'Sin asignar',
            advisorId: lead.assignedToId || '',
            estimatedValue: lead.estimatedValue || 0,
            riskLevel,
            recommendedAction,
          });
        }
      }

      // Ordenar por valor estimado descendente
      results.sort((a: any, b: any) => b.estimatedValue - a.estimatedValue);

      this.logger.log(`Tratos estancados detectados: ${results.length}`);
      return results;
    } catch (error) {
      this.logger.error('Error detectando tratos estancados', error);
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────
  // 3. ACCIONES
  // ─────────────────────────────────────────────────────────

  async reassignLead(
    leadId: string,
    fromAdvisorId: string,
    toAdvisorId: string,
    reason: string,
  ) {
    this.logger.log(`Reasignando lead ${leadId} de ${fromAdvisorId} a ${toAdvisorId}`);

    try {
      // Actualizar lead
      const lead = await this.prisma.lead.update({
        where: { id: leadId },
        data: { assignedToId: toAdvisorId },
        include: {
          assignedTo: { select: { firstName: true, lastName: true } },
        },
      });

      // Reasignar tareas pendientes de este lead
      const updatedTasks = await this.prisma.salesTask.updateMany({
        where: {
          leadId,
          advisorId: fromAdvisorId,
          status: { in: ['pending', 'in_progress'] },
        },
        data: {
          advisorId: toAdvisorId,
          originalAdvisorId: fromAdvisorId,
          reassignedBy: 'supervisor_neto',
          reassignReason: reason,
          status: 'reassigned',
        },
      });

      // Crear alerta de auditoria
      await this.prisma.salesAlert.create({
        data: {
          type: 'reassignment' as any,
          severity: 'medium',
          leadId,
          advisorId: toAdvisorId,
          title: `Reasignacion: ${lead.companyName}`,
          message: `Lead reasignado de asesor anterior a ${lead.assignedTo?.firstName} ${lead.assignedTo?.lastName}. Razon: ${reason}`,
          status: 'resolved',
          resolvedBy: 'supervisor_neto',
          actionTaken: 'reassigned',
          resolutionNotes: reason,
          estimatedValue: lead.estimatedValue,
          zone: lead.zone,
        },
      });

      const summary = {
        leadId,
        companyName: lead.companyName,
        newAdvisor: `${lead.assignedTo?.firstName} ${lead.assignedTo?.lastName}`,
        tasksReassigned: updatedTasks.count,
        reason,
      };

      this.logger.log(`Reasignacion completada: ${JSON.stringify(summary)}`);
      return summary;
    } catch (error) {
      this.logger.error(`Error reasignando lead ${leadId}`, error);
      throw error;
    }
  }

  async bulkReassign(advisorId: string, targetAdvisorId: string, reason: string) {
    this.logger.log(`Reasignacion masiva de ${advisorId} a ${targetAdvisorId}`);

    try {
      // Obtener todos los leads pendientes del asesor
      const leads = await this.prisma.lead.findMany({
        where: {
          assignedToId: advisorId,
          status: {
            notIn: [
              'CERRADO_GANADO' as any,
              'CERRADO_PERDIDO' as any,
              'LEAD_BASURA' as any,
            ],
          },
          deletedAt: null,
          isHistorical: false,
        },
        select: { id: true, companyName: true, estimatedValue: true },
      });

      const results = [];
      for (const lead of leads) {
        const result = await this.reassignLead(lead.id, advisorId, targetAdvisorId, reason);
        results.push(result);
      }

      const totalValue = leads.reduce((sum: any, l: any) => sum + (l.estimatedValue || 0), 0);

      const summary = {
        leadsReassigned: results.length,
        totalPipelineValue: totalValue,
        fromAdvisorId: advisorId,
        toAdvisorId: targetAdvisorId,
        reason,
        details: results,
      };

      this.logger.log(`Reasignacion masiva completada: ${results.length} leads`);
      return summary;
    } catch (error) {
      this.logger.error('Error en reasignacion masiva', error);
      throw error;
    }
  }

  async escalateToDirector(leadId: string, reason: string) {
    this.logger.log(`Escalando lead ${leadId} a director`);

    try {
      const lead = await this.prisma.lead.findUnique({
        where: { id: leadId },
        include: {
          assignedTo: { select: { firstName: true, lastName: true } },
        },
      });

      if (!lead) {
        throw new Error(`Lead ${leadId} no encontrado`);
      }

      // Crear tarea de alta prioridad para el director
      const task = await this.prisma.salesTask.create({
        data: {
          advisorId: DIRECTOR_ID,
          leadId,
          type: 'escalation',
          title: `ESCALACION: ${lead.companyName} - ${reason}`,
          description: `Lead escalado por supervisor Neto. Asesor actual: ${lead.assignedTo?.firstName} ${lead.assignedTo?.lastName}. Valor estimado: $${(lead.estimatedValue || 0).toLocaleString()}. Razon: ${reason}`,
          suggestion: `Revisar situacion con ${lead.contactName} de ${lead.companyName}. Contactar directamente si es necesario.`,
          channel: 'phone',
          priority: 'critical',
          priorityScore: 95,
          dueDate: new Date(),
          source: 'ai',
          estimatedValue: lead.estimatedValue,
          zone: lead.zone,
          leadStatus: lead.status,
        },
      });

      // Crear alerta de escalacion
      const alert = await this.prisma.salesAlert.create({
        data: {
          type: 'deal_stuck',
          severity: 'critical',
          leadId,
          advisorId: lead.assignedToId,
          title: `Escalacion a Director: ${lead.companyName}`,
          message: reason,
          status: 'escalated',
          escalatedTo: 'director',
          estimatedValue: lead.estimatedValue,
          zone: lead.zone,
          recommendedAction: 'escalate',
          priorityScore: 95,
        },
      });

      const summary = {
        taskId: task.id,
        alertId: alert.id,
        leadId,
        companyName: lead.companyName,
        escalatedTo: 'Director (Andres Alanis)',
        reason,
      };

      this.logger.log(`Escalacion completada: ${JSON.stringify(summary)}`);
      return summary;
    } catch (error) {
      this.logger.error(`Error escalando lead ${leadId}`, error);
      throw error;
    }
  }

  async forceAction(
    taskId: string,
    action: 'start' | 'reassign' | 'escalate',
    params?: { toAdvisorId?: string; reason?: string },
  ) {
    this.logger.log(`Forzando accion '${action}' en tarea ${taskId}`);

    try {
      switch (action) {
        case 'start':
          return this.prisma.salesTask.update({
            where: { id: taskId },
            data: { status: 'in_progress', startedAt: new Date() },
          });

        case 'reassign':
          if (!params?.toAdvisorId) {
            throw new Error('Se requiere toAdvisorId para reasignar');
          }
          const task = await this.prisma.salesTask.findUnique({ where: { id: taskId } });
          return this.prisma.salesTask.update({
            where: { id: taskId },
            data: {
              advisorId: params.toAdvisorId,
              originalAdvisorId: task?.advisorId,
              reassignedBy: 'supervisor_neto',
              reassignReason: params.reason || 'Forzado por supervisor',
              status: 'reassigned',
            },
          });

        case 'escalate':
          return this.prisma.salesTask.update({
            where: { id: taskId },
            data: {
              type: 'escalation',
              priority: 'critical',
              priorityScore: 95,
              advisorId: DIRECTOR_ID,
            },
          });

        default:
          throw new Error(`Accion no reconocida: ${action}`);
      }
    } catch (error) {
      this.logger.error(`Error forzando accion en tarea ${taskId}`, error);
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────
  // 4. PREPARACION DE COMUNICACIONES
  // ─────────────────────────────────────────────────────────

  async prepareMessage(
    leadId: string,
    channel: string,
    templateKey?: string,
  ): Promise<PreparedMessage> {
    this.logger.log(`Preparando mensaje para lead ${leadId}, canal: ${channel}`);

    try {
      const lead = await this.prisma.lead.findUnique({
        where: { id: leadId },
        include: {
          assignedTo: { select: { firstName: true, lastName: true, email: true } },
        },
      });

      if (!lead) {
        throw new Error(`Lead ${leadId} no encontrado`);
      }

      let body = '';
      let subject: string | undefined;
      let resolvedTemplateKey = templateKey;

      if (templateKey) {
        const template = await this.prisma.messageTemplate.findUnique({
          where: { key: templateKey },
        });

        if (template) {
          body = template.body;
          subject = template.subject || undefined;
          resolvedTemplateKey = template.key;
        }
      }

      // Variables de reemplazo
      const variables: Record<string, string> = {
        contactName: lead.contactName,
        companyName: lead.companyName,
        advisorName: lead.assignedTo
          ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`
          : 'Equipo IEA',
        estimatedValue: `$${(lead.estimatedValue || 0).toLocaleString()}`,
        phone: lead.contactPhone || '',
        email: lead.contactEmail || '',
        city: lead.city || '',
        zone: lead.zone || '',
      };

      // Reemplazar variables en el cuerpo del mensaje
      for (const [key, value] of Object.entries(variables)) {
        body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }
      if (subject) {
        for (const [key, value] of Object.entries(variables)) {
          subject = subject.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }
      }

      // Determinar destinatario segun canal
      let recipient = '';
      if (channel === 'email') {
        recipient = lead.contactEmail || '';
      } else {
        recipient = lead.contactPhone || '';
      }

      return {
        channel,
        recipient,
        subject,
        body,
        templateKey: resolvedTemplateKey,
        variables,
      };
    } catch (error) {
      this.logger.error(`Error preparando mensaje para lead ${leadId}`, error);
      throw error;
    }
  }

  async getChannelReadiness() {
    this.logger.log('Verificando disponibilidad de canales');

    try {
      const activeLeads = await this.prisma.lead.findMany({
        where: {
          deletedAt: null,
          isHistorical: false,
          status: {
            notIn: [
              'CERRADO_GANADO' as any,
              'CERRADO_PERDIDO' as any,
              'LEAD_BASURA' as any,
            ],
          },
        },
        select: { contactPhone: true, contactEmail: true },
      });

      const withPhone = activeLeads.filter((l: any) => l.contactPhone).length;
      const withEmail = activeLeads.filter((l: any) => l.contactEmail).length;

      const templatesByChannel = await this.prisma.messageTemplate.groupBy({
        by: ['channel'],
        _count: { id: true },
      });

      const templateMap: Record<string, number> = {};
      for (const t of templatesByChannel) {
        templateMap[t.channel] = t._count.id;
      }

      // Mensajes pendientes por canal
      const pendingByChannel = await this.prisma.followUpStep.groupBy({
        by: ['channel'],
        where: { status: 'pending' },
        _count: { id: true },
      });

      const pendingMap: Record<string, number> = {};
      for (const p of pendingByChannel) {
        pendingMap[p.channel] = p._count.id;
      }

      const channels = {
        whatsapp: {
          ready: withPhone > 0 && (templateMap['whatsapp'] || 0) > 0,
          contactsAvailable: withPhone,
          templatesAvailable: templateMap['whatsapp'] || 0,
          pendingMessages: pendingMap['whatsapp'] || 0,
        },
        sms: {
          ready: withPhone > 0,
          contactsAvailable: withPhone,
          templatesAvailable: templateMap['sms'] || 0,
          pendingMessages: pendingMap['sms'] || 0,
        },
        email: {
          ready: withEmail > 0 && (templateMap['email'] || 0) > 0,
          contactsAvailable: withEmail,
          templatesAvailable: templateMap['email'] || 0,
          pendingMessages: pendingMap['email'] || 0,
        },
        phone: {
          ready: withPhone > 0,
          contactsAvailable: withPhone,
          templatesAvailable: templateMap['crm_task'] || 0,
          pendingMessages: 0,
        },
      };

      return channels;
    } catch (error) {
      this.logger.error('Error verificando canales', error);
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────
  // 5. CRON JOBS
  // ─────────────────────────────────────────────────────────

  @Cron('0 */2 8-18 * * 1-6')
  async cronDeteccion() {
    this.logger.log('[CRON] Ejecutando deteccion periodica');

    try {
      const [inactividad, estancados] = await Promise.all([
        this.detectInactivity(),
        this.detectStuckDeals(),
      ]);

      // Crear alertas para inactividades criticas
      for (const advisor of inactividad) {
        if (advisor.hoursSinceLastActivity > 6) {
          await this.prisma.salesAlert.create({
            data: {
              type: 'low_activity',
              severity: advisor.hoursSinceLastActivity > 8 ? 'critical' : 'high',
              advisorId: advisor.advisorId,
              title: `Inactividad: ${advisor.advisorName}`,
              message: advisor.recommendation,
              status: 'open',
              daysSinceActivity: Math.ceil(advisor.hoursSinceLastActivity / 24),
              recommendedAction: 'reassign',
              priorityScore: Math.min(100, Math.round(advisor.hoursSinceLastActivity * 10)),
            },
          });
        }
      }

      // Crear alertas para deals estancados criticos
      for (const deal of estancados) {
        if (deal.riskLevel === 'critico') {
          const existing = await this.prisma.salesAlert.findFirst({
            where: {
              leadId: deal.leadId,
              type: 'deal_stuck',
              status: { in: ['open', 'escalated'] },
              createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
          });

          if (!existing) {
            await this.prisma.salesAlert.create({
              data: {
                type: 'deal_stuck',
                severity: 'critical',
                leadId: deal.leadId,
                advisorId: deal.advisorId || null,
                title: `Trato estancado: ${deal.companyName}`,
                message: `${deal.daysStuck} dias en ${deal.stage}. Valor: $${deal.estimatedValue.toLocaleString()}`,
                status: 'open',
                stageDuration: deal.daysStuck,
                riskOfLoss: deal.riskLevel === 'critico' ? 90 : 60,
                recommendedAction: deal.recommendedAction,
                estimatedValue: deal.estimatedValue,
                priorityScore: 90,
              },
            });
          }
        }
      }

      this.logger.log(
        `[CRON] Deteccion completada: ${inactividad.length} inactivos, ${estancados.length} estancados`,
      );
    } catch (error) {
      this.logger.error('[CRON] Error en deteccion periodica', error);
    }
  }

  @Cron('0 30 8 * * 1-6')
  async cronBriefingMatutino() {
    this.logger.log('[CRON] Generando briefing matutino');
    try {
      await this.generateMorningBriefing();
    } catch (error) {
      this.logger.error('[CRON] Error en briefing matutino', error);
    }
  }

  // ─────────────────────────────────────────────────────────
  // 6. BRIEFING MATUTINO
  // ─────────────────────────────────────────────────────────

  async generateMorningBriefing() {
    this.logger.log('Generando briefing matutino de Neto');

    try {
      const now = new Date();
      const yesterdayStart = new Date(now);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      yesterdayStart.setHours(0, 0, 0, 0);
      const yesterdayEnd = new Date(now);
      yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);
      yesterdayEnd.setHours(23, 59, 59, 999);
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      // Resultados de ayer
      const completedYesterday = await this.prisma.salesTask.count({
        where: {
          status: 'completed',
          completedAt: { gte: yesterdayStart, lte: yesterdayEnd },
          isHistorical: false,
        },
      });

      const dealsClosedYesterday = await this.prisma.salesTask.count({
        where: {
          status: 'completed',
          pipelineMoved: true,
          completedAt: { gte: yesterdayStart, lte: yesterdayEnd },
          isHistorical: false,
        },
      });

      const pipelineMovedYesterday = await this.prisma.salesTask.count({
        where: {
          pipelineMoved: true,
          completedAt: { gte: yesterdayStart, lte: yesterdayEnd },
          isHistorical: false,
        },
      });

      // Prioridades de hoy
      const overdueTasks = await this.prisma.salesTask.count({
        where: {
          status: { in: ['pending', 'in_progress'] },
          dueDate: { lt: todayStart },
          isHistorical: false,
        },
      });

      const highValueFollowUps = await this.prisma.salesTask.count({
        where: {
          status: 'pending',
          dueDate: { gte: todayStart, lt: new Date(todayStart.getTime() + 24 * 60 * 60 * 1000) },
          estimatedValue: { gte: HIGH_VALUE_THRESHOLD },
          isHistorical: false,
        },
      });

      const stuckDeals = await this.detectStuckDeals();
      const inactivity = await this.detectInactivity();
      const teamStatus = await this.getTeamStatus();

      // Construir briefing en espanol
      const topPerformers = [...teamStatus]
        .sort((a: any, b: any) => b.completionRate - a.completionRate)
        .slice(0, 3);

      const needsAttention = teamStatus.filter((a: any) => a.isInactive || a.overdue > 3);

      const briefing = {
        fecha: now.toLocaleDateString('es-MX', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        resumenAyer: {
          tareasCompletadas: completedYesterday,
          tratosCerrados: dealsClosedYesterday,
          pipelineMovido: pipelineMovedYesterday,
        },
        prioridadesHoy: {
          tareasVencidas: overdueTasks,
          seguimientosAltoValor: highValueFollowUps,
          tratosEstancados: stuckDeals.length,
          tratosEstancadosCriticos: stuckDeals.filter((d: any) => d.riskLevel === 'critico').length,
        },
        saludEquipo: {
          topPerformers: topPerformers.map((a: any) => ({
            nombre: a.advisorName,
            tasaCompletado: `${a.completionRate}%`,
            tareasHoy: a.tasksToday,
          })),
          necesitanAtencion: needsAttention.map((a: any) => ({
            nombre: a.advisorName,
            inactivo: a.isInactive,
            tareasVencidas: a.overdue,
          })),
          asesoresInactivos: inactivity.length,
        },
        accionesRecomendadas: [] as string[],
      };

      // Generar recomendaciones
      if (overdueTasks > 10) {
        briefing.accionesRecomendadas.push(
          `Hay ${overdueTasks} tareas vencidas. Revisar carga de trabajo del equipo.`,
        );
      }

      for (const advisor of inactivity) {
        briefing.accionesRecomendadas.push(
          `${advisor.advisorName}: ${advisor.recommendation}`,
        );
      }

      const criticalDeals = stuckDeals.filter(
        (d) => d.riskLevel === 'critico' && d.estimatedValue > 200000,
      );
      for (const deal of criticalDeals) {
        briefing.accionesRecomendadas.push(
          `Escalar ${deal.companyName} ($${deal.estimatedValue.toLocaleString()}) - ${deal.daysStuck} dias estancado en ${deal.stage}.`,
        );
      }

      if (briefing.accionesRecomendadas.length === 0) {
        briefing.accionesRecomendadas.push(
          'Sin acciones urgentes. Equipo operando con normalidad.',
        );
      }

      this.logger.log('Briefing matutino generado exitosamente');
      return briefing;
    } catch (error) {
      this.logger.error('Error generando briefing matutino', error);
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────
  // METODOS PRIVADOS
  // ─────────────────────────────────────────────────────────

  private async getTeamStatus(): Promise<AdvisorStatus[]> {
    const advisors = await this.prisma.user.findMany({
      where: { isActive: true, role: { in: ['OPERATOR', 'OPERATIONS'] } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const thresholdTime = new Date(now.getTime() - INACTIVE_HOURS_THRESHOLD * 60 * 60 * 1000);

    const results: AdvisorStatus[] = [];

    for (const advisor of advisors) {
      const [tasksToday, completed, pending, overdue, lastActivity, activeLeads, pipelineAgg] =
        await Promise.all([
          // Tareas de hoy
          this.prisma.salesTask.count({
            where: { advisorId: advisor.id, dueDate: { gte: todayStart }, isHistorical: false },
          }),
          // Completadas hoy
          this.prisma.salesTask.count({
            where: {
              advisorId: advisor.id,
              status: 'completed',
              completedAt: { gte: todayStart },
              isHistorical: false,
            },
          }),
          // Pendientes
          this.prisma.salesTask.count({
            where: {
              advisorId: advisor.id,
              status: { in: ['pending', 'in_progress'] },
              isHistorical: false,
            },
          }),
          // Vencidas
          this.prisma.salesTask.count({
            where: {
              advisorId: advisor.id,
              status: { in: ['pending', 'in_progress'] },
              dueDate: { lt: now },
              isHistorical: false,
            },
          }),
          // Ultima actividad
          this.prisma.salesTask.findFirst({
            where: { advisorId: advisor.id, status: 'completed', isHistorical: false },
            orderBy: { completedAt: 'desc' },
            select: { completedAt: true },
          }),
          // Leads activos
          this.prisma.lead.count({
            where: {
              assignedToId: advisor.id,
              deletedAt: null,
              isHistorical: false,
              status: {
                notIn: [
                  'CERRADO_GANADO' as any,
                  'CERRADO_PERDIDO' as any,
                  'LEAD_BASURA' as any,
                ],
              },
            },
          }),
          // Valor pipeline
          this.prisma.lead.aggregate({
            _sum: { estimatedValue: true },
            where: {
              assignedToId: advisor.id,
              deletedAt: null,
              isHistorical: false,
              status: {
                notIn: [
                  'CERRADO_GANADO' as any,
                  'CERRADO_PERDIDO' as any,
                  'LEAD_BASURA' as any,
                ],
              },
            },
          }),
        ]);

      const lastActivityTime = lastActivity?.completedAt?.toISOString() || null;
      const isInactive =
        completed === 0 &&
        (!lastActivity?.completedAt || lastActivity.completedAt < thresholdTime);

      const completionRate =
        tasksToday > 0 ? Math.round((completed / tasksToday) * 100) : 0;

      results.push({
        advisorId: advisor.id,
        advisorName: `${advisor.firstName} ${advisor.lastName}`,
        email: advisor.email,
        tasksToday,
        completed,
        pending,
        overdue,
        lastActivity: lastActivityTime,
        activeLeads,
        pipelineValue: pipelineAgg._sum.estimatedValue || 0,
        completionRate,
        isInactive,
      });
    }

    return results;
  }

  private async getActiveAlerts() {
    return this.prisma.salesAlert.findMany({
      where: { status: { in: ['open', 'escalated'] } },
      orderBy: [{ severity: 'asc' }, { priorityScore: 'desc' }],
      take: 50,
    });
  }

  private async getInactiveHighValueLeads() {
    const thresholdDate = new Date(
      Date.now() - INACTIVE_LEAD_DAYS * 24 * 60 * 60 * 1000,
    );

    return this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        isHistorical: false,
        estimatedValue: { gte: INACTIVE_LEAD_VALUE_THRESHOLD },
        lastContactedAt: { lt: thresholdDate },
        status: {
          notIn: [
            'CERRADO_GANADO' as any,
            'CERRADO_PERDIDO' as any,
            'LEAD_BASURA' as any,
            'CONTACTAR_FUTURO' as any,
          ],
        },
      },
      include: {
        assignedTo: { select: { firstName: true, lastName: true } },
      },
      orderBy: { estimatedValue: 'desc' },
      take: 50,
    });
  }

  private async getChannelQueue() {
    const pending = await this.prisma.salesTask.groupBy({
      by: ['channel'],
      where: { status: { in: ['pending', 'in_progress'] }, isHistorical: false },
      _count: { id: true },
    });

    const queue: Record<string, number> = {
      whatsapp: 0,
      email: 0,
      sms: 0,
      phone: 0,
      in_person: 0,
    };

    for (const item of pending) {
      if (item.channel && queue.hasOwnProperty(item.channel)) {
        queue[item.channel] = item._count.id;
      }
    }

    return queue;
  }

  private async buildUrgentActions(
    teamStatus: AdvisorStatus[],
    alerts: any[],
    stuckDeals: StuckDeal[],
    inactiveLeads: any[],
  ): Promise<UrgentAction[]> {
    const actions: UrgentAction[] = [];

    // Tareas vencidas de alta prioridad
    const overdueCritical = await this.prisma.salesTask.findMany({
      where: {
        status: { in: ['pending', 'in_progress'] },
        dueDate: { lt: new Date() },
        priority: { in: ['critical', 'high'] },
        isHistorical: false,
      },
      orderBy: { priorityScore: 'desc' },
      take: 20,
    });

    // Fetch lead names for tasks that have a leadId
    const leadIds = overdueCritical.map((t: any) => t.leadId).filter(Boolean) as string[];
    const leadMap = new Map<string, string>();
    if (leadIds.length > 0) {
      const leads = await this.prisma.lead.findMany({
        where: { id: { in: leadIds } },
        select: { id: true, companyName: true },
      });
      for (const l of leads) leadMap.set(l.id, l.companyName);
    }

    for (const task of overdueCritical) {
      const companyName = task.leadId ? leadMap.get(task.leadId) : undefined;
      actions.push({
        type: 'tarea_vencida',
        priority: task.priority,
        description: `Tarea vencida: ${task.title}${companyName ? ` (${companyName})` : ''}`,
        entityId: task.id,
        entityType: 'salesTask',
        estimatedValue: task.estimatedValue || undefined,
      });
    }

    // Deals estancados de alto valor
    for (const deal of stuckDeals.filter((d: any) => d.riskLevel === 'critico')) {
      actions.push({
        type: 'trato_estancado',
        priority: 'critical',
        description: `${deal.companyName}: ${deal.daysStuck} dias en ${deal.stage}`,
        entityId: deal.leadId,
        entityType: 'lead',
        advisorName: deal.currentAdvisor,
        estimatedValue: deal.estimatedValue,
      });
    }

    // Asesores inactivos
    for (const advisor of teamStatus.filter((a: any) => a.isInactive)) {
      actions.push({
        type: 'asesor_inactivo',
        priority: 'high',
        description: `${advisor.advisorName} inactivo. ${advisor.overdue} tareas vencidas, ${advisor.pending} pendientes.`,
        entityId: advisor.advisorId,
        entityType: 'user',
        advisorName: advisor.advisorName,
        metadata: { pipelineValue: advisor.pipelineValue },
      });
    }

    // Alertas sin atender
    for (const alert of alerts.filter((a: any) => a.severity === 'critical')) {
      actions.push({
        type: 'alerta_critica',
        priority: 'critical',
        description: alert.title,
        entityId: alert.id,
        entityType: 'salesAlert',
        estimatedValue: alert.estimatedValue || undefined,
      });
    }

    // Leads inactivos de alto valor
    for (const lead of inactiveLeads.slice(0, 10)) {
      actions.push({
        type: 'lead_sin_contacto',
        priority: 'high',
        description: `${lead.companyName}: sin contacto hace ${INACTIVE_LEAD_DAYS}+ dias. Valor: $${(lead.estimatedValue || 0).toLocaleString()}`,
        entityId: lead.id,
        entityType: 'lead',
        advisorName: lead.assignedTo
          ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`
          : undefined,
        estimatedValue: lead.estimatedValue,
      });
    }

    // Ordenar por prioridad
    actions.sort(
      (a, b) =>
        (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99),
    );

    return actions;
  }
}
