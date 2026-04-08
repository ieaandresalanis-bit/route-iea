import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PriorityEngineService } from '../priority-engine/priority-engine.service';
import type { ScoredLead } from '../priority-engine/priority-engine.service';

const TERMINAL_STATUSES = ['CERRADO_GANADO', 'CERRADO_PERDIDO', 'LEAD_BASURA', 'CONTACTAR_FUTURO'];

const LATE_STAGES = ['COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO'];

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

@Injectable()
export class AutomationEngineService {
  private readonly logger = new Logger(AutomationEngineService.name);

  constructor(
    private prisma: PrismaService,
    private priorityEngine: PriorityEngineService,
  ) {}

  // ─────────────────────────────────────────────────────
  // 1. Run all automations (called on demand or via cron)
  // ─────────────────────────────────────────────────────

  async runAllAutomations() {
    const results = await Promise.all([
      this.runInactiveLeadAutomation(),
      this.runDealPushAutomation(),
      this.runReactivationSystem(),
      this.runDailyAutoTasks(),
      this.runAlertSystem(),
    ]);

    return {
      inactiveAlerts: results[0],
      dealAlerts: results[1],
      reactivations: results[2],
      tasksGenerated: results[3],
      systemAlerts: results[4],
      runAt: new Date().toISOString(),
    };
  }

  // ─────────────────────────────────────────────────────
  // 2. Inactive Leads Automation
  // ─────────────────────────────────────────────────────

  async runInactiveLeadAutomation() {
    const leads = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        isHistorical: false,
        status: { notIn: TERMINAL_STATUSES as any },
      },
      select: {
        id: true,
        companyName: true,
        contactName: true,
        contactPhone: true,
        zone: true,
        status: true,
        source: true,
        estimatedValue: true,
        lastContactedAt: true,
        createdAt: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const alerts: any[] = [];
    const now = Date.now();

    for (const lead of leads) {
      const daysSince = lead.lastContactedAt
        ? Math.floor((now - new Date(lead.lastContactedAt).getTime()) / (24 * 60 * 60 * 1000))
        : Math.floor((now - new Date(lead.createdAt).getTime()) / (24 * 60 * 60 * 1000));

      const hoursSince = lead.lastContactedAt
        ? Math.floor((now - new Date(lead.lastContactedAt).getTime()) / (60 * 60 * 1000))
        : Math.floor((now - new Date(lead.createdAt).getTime()) / (60 * 60 * 1000));

      let alertType: string | null = null;
      let severity: string = 'medium';
      let title = '';
      let message = '';
      let suggestion = '';

      if (daysSince >= 7) {
        alertType = 'inactive_7d';
        severity = 'critical';
        title = `${lead.companyName} — 7+ dias sin contacto`;
        message = `El lead ${lead.companyName} (${lead.contactName}) lleva ${daysSince} dias sin contacto. Etapa: ${STATUS_LABELS[lead.status as string] || lead.status}. Requiere reactivacion inmediata.`;
        suggestion = this.generateReactivationMessage(lead);
      } else if (hoursSince >= 72) {
        alertType = 'inactive_72h';
        severity = 'high';
        title = `${lead.companyName} — 72h+ sin contacto`;
        message = `Alerta urgente: ${lead.companyName} lleva ${daysSince} dias sin contacto. ${lead.estimatedValue ? `Valor: $${lead.estimatedValue.toLocaleString('es-MX')} MXN.` : ''} Contactar hoy.`;
        suggestion = this.generateFollowUpMessage(lead, 'urgente');
      } else if (hoursSince >= 48) {
        alertType = 'inactive_48h';
        severity = 'medium';
        title = `${lead.companyName} — 48h sin contacto`;
        message = `Recordatorio: ${lead.companyName} no ha sido contactado en 2 dias. ${STATUS_LABELS[lead.status as string] || lead.status}.`;
        suggestion = this.generateFollowUpMessage(lead, 'recordatorio');
      }

      if (alertType) {
        // Check if we already have an open alert of this type for this lead
        const existing = await this.prisma.salesAlert.findFirst({
          where: {
            leadId: lead.id,
            type: alertType,
            status: 'open',
          },
        });

        if (!existing) {
          const alert = await this.prisma.salesAlert.create({
            data: {
              type: alertType,
              severity,
              leadId: lead.id,
              advisorId: lead.assignedTo?.id || null,
              title,
              message,
              suggestion,
              metadata: {
                daysSinceContact: daysSince,
                estimatedValue: lead.estimatedValue,
                zone: lead.zone,
                status: lead.status,
                contactName: lead.contactName,
              },
            },
          });
          alerts.push(alert);
        }
      }
    }

    return { created: alerts.length, alerts };
  }

  // ─────────────────────────────────────────────────────
  // 3. Deal Push Automation
  // ─────────────────────────────────────────────────────

  async runDealPushAutomation() {
    const deals = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        isHistorical: false,
        status: { in: LATE_STAGES as any },
      },
      select: {
        id: true,
        companyName: true,
        contactName: true,
        contactPhone: true,
        zone: true,
        status: true,
        source: true,
        estimatedValue: true,
        lastContactedAt: true,
        createdAt: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const alerts: any[] = [];

    for (const deal of deals) {
      const daysSince = this.priorityEngine.daysSince(deal.lastContactedAt);

      // Late-stage deal with no recent contact
      if (daysSince === null || daysSince >= 3) {
        const existing = await this.prisma.salesAlert.findFirst({
          where: { leadId: deal.id, type: 'deal_stuck', status: 'open' },
        });

        if (!existing) {
          const stageLabel = STATUS_LABELS[deal.status as string] || deal.status;
          const alert = await this.prisma.salesAlert.create({
            data: {
              type: 'deal_stuck',
              severity: 'critical',
              leadId: deal.id,
              advisorId: deal.assignedTo?.id || null,
              title: `Deal estancado: ${deal.companyName}`,
              message: `${deal.companyName} esta en "${stageLabel}" desde hace ${daysSince ?? '?'} dias sin contacto. Valor: $${(deal.estimatedValue || 0).toLocaleString('es-MX')} MXN. Requiere accion de cierre inmediata.`,
              suggestion: this.generateClosingMessage(deal),
              metadata: {
                daysSinceContact: daysSince,
                estimatedValue: deal.estimatedValue,
                stage: deal.status,
                zone: deal.zone,
              },
            },
          });
          alerts.push(alert);
        }
      }
    }

    return { created: alerts.length, alerts };
  }

  // ─────────────────────────────────────────────────────
  // 4. Reactivation System
  // ─────────────────────────────────────────────────────

  async runReactivationSystem() {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const leads = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        isHistorical: false,
        status: { notIn: TERMINAL_STATUSES as any },
        OR: [
          { lastContactedAt: null },
          { lastContactedAt: { lt: fourteenDaysAgo } },
        ],
      },
      select: {
        id: true,
        companyName: true,
        contactName: true,
        contactPhone: true,
        zone: true,
        status: true,
        source: true,
        estimatedValue: true,
        lastContactedAt: true,
        createdAt: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const alerts: any[] = [];

    for (const lead of leads) {
      const existing = await this.prisma.salesAlert.findFirst({
        where: { leadId: lead.id, type: 'reactivation', status: 'open' },
      });

      if (!existing) {
        const daysSince = this.priorityEngine.daysSince(lead.lastContactedAt);
        const alert = await this.prisma.salesAlert.create({
          data: {
            type: 'reactivation',
            severity: (lead.estimatedValue || 0) > 300000 ? 'high' : 'medium',
            leadId: lead.id,
            advisorId: lead.assignedTo?.id || null,
            title: `Reactivacion: ${lead.companyName}`,
            message: `${lead.companyName} lleva ${daysSince !== null ? `${daysSince} dias` : 'sin contactar'} sin actividad. ${lead.estimatedValue ? `Valor: $${lead.estimatedValue.toLocaleString('es-MX')} MXN.` : ''} Generar contacto de reactivacion.`,
            suggestion: this.generateReactivationMessage(lead),
            metadata: {
              daysSinceContact: daysSince,
              estimatedValue: lead.estimatedValue,
              zone: lead.zone,
              status: lead.status,
              tag: 'reactivation',
            },
          },
        });
        alerts.push(alert);
      }
    }

    return { created: alerts.length, alerts };
  }

  // ─────────────────────────────────────────────────────
  // 5. Daily Auto Tasks
  // ─────────────────────────────────────────────────────

  async runDailyAutoTasks() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get all active leads with their scores
    const leads = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        isHistorical: false,
        status: { notIn: TERMINAL_STATUSES as any },
      },
      select: {
        id: true,
        companyName: true,
        contactName: true,
        contactPhone: true,
        zone: true,
        status: true,
        source: true,
        estimatedValue: true,
        lastContactedAt: true,
        createdAt: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Get pending follow-ups
    const followUps = await this.prisma.visit.findMany({
      where: {
        followUpDate: { lte: tomorrow },
        lead: { deletedAt: null, isHistorical: false, status: { notIn: TERMINAL_STATUSES as any } },
      },
      select: {
        id: true,
        followUpDate: true,
        followUpNotes: true,
        lead: { select: { id: true, companyName: true, contactName: true } },
        visitedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const scored = this.priorityEngine.scoreLeads(leads);
    const tasks: any[] = [];

    // Don't duplicate — check for existing tasks today
    const existingToday = await this.prisma.salesTask.count({
      where: {
        isHistorical: false,
        dueDate: { gte: today, lt: tomorrow },
        source: 'automation',
      },
    });

    if (existingToday > 0) {
      return { created: 0, skipped: true, message: 'Tasks already generated today' };
    }

    // Generate call tasks for uncontacted leads (by advisor)
    const needsCall = scored.filter(
      (l) => ['PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR'].includes(l.status),
    );

    for (const lead of needsCall) {
      const advisorId = lead.assignedTo?.id;
      if (!advisorId) continue;

      const task = await this.prisma.salesTask.create({
        data: {
          advisorId,
          leadId: lead.id,
          type: 'call',
          title: `Llamar a ${lead.companyName}`,
          description: `Contactar a ${lead.contactName}${lead.contactPhone ? ` (${lead.contactPhone})` : ''}. ${lead.estimatedValue ? `Valor estimado: $${lead.estimatedValue.toLocaleString('es-MX')}` : ''}`,
          suggestion: this.generateCallScript(lead),
          dueDate: today,
          priority: lead.urgency,
          source: 'automation',
        },
      });
      tasks.push(task);
    }

    // Generate follow-up tasks
    for (const fu of followUps) {
      const advisorId = fu.visitedBy?.id;
      if (!advisorId) continue;

      const task = await this.prisma.salesTask.create({
        data: {
          advisorId,
          leadId: fu.lead.id,
          type: 'follow_up',
          title: `Follow-up: ${fu.lead.companyName}`,
          description: `Seguimiento pendiente con ${fu.lead.contactName}. ${fu.followUpNotes || ''}`,
          dueDate: today,
          priority: fu.followUpDate && new Date(fu.followUpDate) < today ? 'high' : 'medium',
          source: 'automation',
        },
      });
      tasks.push(task);
    }

    // Generate reactivation tasks for 14d+ inactive
    const needsReactivation = scored.filter(
      (l) => l.daysSinceContact !== null && l.daysSinceContact >= 14 && l.assignedTo,
    );

    for (const lead of needsReactivation) {
      const task = await this.prisma.salesTask.create({
        data: {
          advisorId: lead.assignedTo!.id,
          leadId: lead.id,
          type: 'reactivation',
          title: `Reactivar: ${lead.companyName}`,
          description: `${lead.daysSinceContact} dias sin contacto. ${lead.estimatedValue ? `Valor: $${lead.estimatedValue.toLocaleString('es-MX')}` : ''}`,
          suggestion: this.generateReactivationMessage(lead),
          dueDate: today,
          priority: (lead.estimatedValue || 0) > 300000 ? 'high' : 'medium',
          source: 'automation',
        },
      });
      tasks.push(task);
    }

    // Generate close-deal tasks for late-stage
    const closeable = scored.filter((l) => LATE_STAGES.includes(l.status) && l.assignedTo);

    for (const lead of closeable) {
      const task = await this.prisma.salesTask.create({
        data: {
          advisorId: lead.assignedTo!.id,
          leadId: lead.id,
          type: 'close_deal',
          title: `Cerrar deal: ${lead.companyName}`,
          description: `En etapa "${STATUS_LABELS[lead.status] || lead.status}". ${lead.estimatedValue ? `Valor: $${lead.estimatedValue.toLocaleString('es-MX')}` : ''}`,
          suggestion: this.generateClosingMessage(lead),
          dueDate: today,
          priority: 'critical',
          source: 'automation',
        },
      });
      tasks.push(task);
    }

    return { created: tasks.length, tasks };
  }

  // ─────────────────────────────────────────────────────
  // 6. Alerts System
  // ─────────────────────────────────────────────────────

  async runAlertSystem() {
    const alerts: any[] = [];

    // a) Low activity advisors — fewer than 2 visits in 7 days
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const advisors = await this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        _count: { select: { assignedLeads: { where: { deletedAt: null, isHistorical: false } } } },
      },
    });

    for (const advisor of advisors) {
      if (advisor._count.assignedLeads === 0) continue;

      const visitCount = await this.prisma.visit.count({
        where: { visitedById: advisor.id, visitDate: { gte: weekAgo } },
      });

      if (visitCount < 2) {
        const existing = await this.prisma.salesAlert.findFirst({
          where: { advisorId: advisor.id, type: 'low_activity', status: 'open' },
        });

        if (!existing) {
          const alert = await this.prisma.salesAlert.create({
            data: {
              type: 'low_activity',
              severity: visitCount === 0 ? 'high' : 'medium',
              advisorId: advisor.id,
              title: `Baja actividad: ${advisor.firstName} ${advisor.lastName}`,
              message: `${advisor.firstName} ${advisor.lastName} ha realizado ${visitCount} visita${visitCount !== 1 ? 's' : ''} en los ultimos 7 dias con ${advisor._count.assignedLeads} leads asignados.`,
              metadata: {
                visitsLast7Days: visitCount,
                assignedLeads: advisor._count.assignedLeads,
              },
            },
          });
          alerts.push(alert);
        }
      }
    }

    // b) High value leads unattended (>$300K, never contacted or 7d+)
    const highValueLeads = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        isHistorical: false,
        status: { notIn: TERMINAL_STATUSES as any },
        estimatedValue: { gte: 300000 },
        OR: [
          { lastContactedAt: null },
          { lastContactedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        ],
      },
      select: {
        id: true,
        companyName: true,
        contactName: true,
        estimatedValue: true,
        zone: true,
        status: true,
        lastContactedAt: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    for (const lead of highValueLeads) {
      const existing = await this.prisma.salesAlert.findFirst({
        where: { leadId: lead.id, type: 'high_value_unattended', status: 'open' },
      });

      if (!existing) {
        const days = this.priorityEngine.daysSince(lead.lastContactedAt);
        const alert = await this.prisma.salesAlert.create({
          data: {
            type: 'high_value_unattended',
            severity: 'critical',
            leadId: lead.id,
            advisorId: lead.assignedTo?.id || null,
            title: `Lead de alto valor sin atencion: ${lead.companyName}`,
            message: `${lead.companyName} ($${(lead.estimatedValue || 0).toLocaleString('es-MX')}) lleva ${days !== null ? `${days} dias` : 'sin ser contactado'}. Requiere atencion inmediata.`,
            metadata: {
              estimatedValue: lead.estimatedValue,
              daysSinceContact: days,
              zone: lead.zone,
            },
          },
        });
        alerts.push(alert);
      }
    }

    return { created: alerts.length, alerts };
  }

  // ─────────────────────────────────────────────────────
  // Query methods for the frontend
  // ─────────────────────────────────────────────────────

  async getAlerts(filters: {
    status?: string;
    type?: string;
    severity?: string;
    advisorId?: string;
    limit?: number;
  }) {
    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.type) where.type = filters.type;
    if (filters.severity) where.severity = filters.severity;
    if (filters.advisorId) where.advisorId = filters.advisorId;

    return this.prisma.salesAlert.findMany({
      where,
      orderBy: [
        { severity: 'asc' }, // critical first (alphabetical: c < h < l < m)
        { createdAt: 'desc' },
      ],
      take: filters.limit || 50,
    });
  }

  async getAlertStats() {
    const [total, open, critical, byType] = await Promise.all([
      this.prisma.salesAlert.count(),
      this.prisma.salesAlert.count({ where: { status: 'open' } }),
      this.prisma.salesAlert.count({ where: { status: 'open', severity: 'critical' } }),
      this.prisma.salesAlert.groupBy({
        by: ['type'],
        where: { status: 'open' },
        _count: true,
      }),
    ]);

    return {
      total,
      open,
      critical,
      byType: byType.map((g) => ({ type: g.type, count: g._count })),
    };
  }

  async getTasks(filters: {
    advisorId?: string;
    status?: string;
    type?: string;
    date?: string; // YYYY-MM-DD
    limit?: number;
  }) {
    const where: any = { isHistorical: false };
    if (filters.advisorId) where.advisorId = filters.advisorId;
    if (filters.status) where.status = filters.status;
    if (filters.type) where.type = filters.type;
    if (filters.date) {
      const d = new Date(filters.date);
      d.setHours(0, 0, 0, 0);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      where.dueDate = { gte: d, lt: next };
    }

    return this.prisma.salesTask.findMany({
      where,
      orderBy: [{ priority: 'asc' }, { dueDate: 'asc' }],
      take: filters.limit || 100,
    });
  }

  async getTaskStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [pending, completedToday, byType] = await Promise.all([
      this.prisma.salesTask.count({ where: { isHistorical: false, status: 'pending' } }),
      this.prisma.salesTask.count({
        where: { isHistorical: false, status: 'completed', completedAt: { gte: today, lt: tomorrow } },
      }),
      this.prisma.salesTask.groupBy({
        by: ['type'],
        where: { isHistorical: false, status: 'pending' },
        _count: true,
      }),
    ]);

    return {
      pending,
      completedToday,
      byType: byType.map((g) => ({ type: g.type, count: g._count })),
    };
  }

  async updateAlertStatus(id: string, status: string, resolvedBy?: string) {
    return this.prisma.salesAlert.update({
      where: { id },
      data: {
        status,
        resolvedAt: ['resolved', 'dismissed'].includes(status) ? new Date() : null,
        resolvedBy: resolvedBy || null,
      },
    });
  }

  async updateTaskStatus(id: string, status: string) {
    return this.prisma.salesTask.update({
      where: { id },
      data: {
        status,
        completedAt: status === 'completed' ? new Date() : null,
      },
    });
  }

  // ─────────────────────────────────────────────────────
  // Message generation (templates — AI layer placeholder)
  // ─────────────────────────────────────────────────────

  private generateFollowUpMessage(lead: any, tone: 'recordatorio' | 'urgente'): string {
    const name = lead.contactName?.split(' ')[0] || 'estimado cliente';
    if (tone === 'urgente') {
      return `Hola ${name}, seguimos pendientes de tu proyecto${lead.estimatedValue ? ' de energia solar' : ''}. Me gustaria agendar una llamada rapida esta semana para avanzar. ¿Tienes disponibilidad manana? Quedo al pendiente.`;
    }
    return `Hola ${name}, espero que estes bien. Te escribo para dar seguimiento a nuestra conversacion sobre ${lead.companyName || 'tu proyecto'}. ¿Hay algo en lo que pueda ayudarte? Quedo atento.`;
  }

  private generateReactivationMessage(lead: any): string {
    const name = lead.contactName?.split(' ')[0] || 'estimado cliente';
    return `Hola ${name}, ha pasado un tiempo desde nuestro ultimo contacto. En Ingenieria Electrica Alanis seguimos comprometidos con tu proyecto${lead.estimatedValue ? ' de energia solar' : ''}. Tenemos nuevas opciones que podrian interesarte. ¿Te gustaria agendar una llamada esta semana?`;
  }

  private generateClosingMessage(lead: any): string {
    const name = lead.contactName?.split(' ')[0] || 'estimado cliente';
    const stage = lead.status as string;

    if (stage === 'PENDIENTE_PAGO') {
      return `Hola ${name}, ¿pudiste revisar los detalles del pago para tu proyecto con ${lead.companyName || 'nosotros'}? Estamos listos para arrancar en cuanto se concrete. Si tienes alguna duda sobre las opciones de pago, con gusto te ayudo.`;
    }
    if (stage === 'ESPERANDO_CONTRATO') {
      return `Hola ${name}, ¿tuviste oportunidad de revisar el contrato? Si hay algun punto que quieras aclarar, puedo agendar una llamada rapida. Nos gustaria arrancar tu proyecto lo antes posible.`;
    }
    return `Hola ${name}, ¿como vas con la decision sobre la cotizacion que te enviamos? Puedo resolver cualquier duda que tengas. Tambien tenemos disponibilidad esta semana para una visita tecnica si lo necesitas.`;
  }

  private generateCallScript(lead: any): string {
    const name = lead.contactName || 'el contacto';
    return `Llamar a ${name} de ${lead.companyName}. ${lead.contactPhone ? `Tel: ${lead.contactPhone}` : 'Sin telefono registrado'}. Objetivo: ${lead.status === 'PENDIENTE_CONTACTAR' ? 'Primer contacto — presentar IEA y explorar necesidades de energia solar.' : 'Dar seguimiento al intento de contacto anterior.'}`;
  }
}
