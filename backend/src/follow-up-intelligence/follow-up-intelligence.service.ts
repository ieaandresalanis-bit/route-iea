import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const TERMINAL_STATUSES = [
  'CERRADO_GANADO',
  'CERRADO_PERDIDO',
  'LEAD_BASURA',
  'CONTACTAR_FUTURO',
];

const STATUS_LABELS: Record<string, string> = {
  PENDIENTE_CONTACTAR: 'Pendiente de Contactar',
  INTENTANDO_CONTACTAR: 'Intentando Contactar',
  EN_PROSPECCION: 'En Prospeccion',
  AGENDAR_CITA: 'Agendar Cita',
  ESPERANDO_COTIZACION: 'Esperando Cotizacion',
  COTIZACION_ENTREGADA: 'Cotizacion Entregada',
  ESPERANDO_CONTRATO: 'Esperando Contrato',
  PENDIENTE_PAGO: 'Pendiente de Pago',
  CERRADO_GANADO: 'Cerrado Ganado',
  CERRADO_PERDIDO: 'Cerrado Perdido',
  LEAD_BASURA: 'Lead Basura',
  CONTACTAR_FUTURO: 'Contactar a Futuro',
};

const STAGE_ORDER: Record<string, number> = {
  PENDIENTE_CONTACTAR: 1,
  INTENTANDO_CONTACTAR: 2,
  EN_PROSPECCION: 3,
  AGENDAR_CITA: 4,
  ESPERANDO_COTIZACION: 5,
  COTIZACION_ENTREGADA: 6,
  ESPERANDO_CONTRATO: 7,
  PENDIENTE_PAGO: 8,
  CERRADO_GANADO: 9,
  CERRADO_PERDIDO: 10,
};

const NEXT_STAGE: Record<string, string> = {
  PENDIENTE_CONTACTAR: 'INTENTANDO_CONTACTAR',
  INTENTANDO_CONTACTAR: 'EN_PROSPECCION',
  EN_PROSPECCION: 'AGENDAR_CITA',
  AGENDAR_CITA: 'ESPERANDO_COTIZACION',
  ESPERANDO_COTIZACION: 'COTIZACION_ENTREGADA',
  COTIZACION_ENTREGADA: 'ESPERANDO_CONTRATO',
  ESPERANDO_CONTRATO: 'PENDIENTE_PAGO',
  PENDIENTE_PAGO: 'CERRADO_GANADO',
};

const ACTION_LABELS: Record<string, string> = {
  call: 'Llamada',
  whatsapp: 'WhatsApp',
  email: 'Correo',
  visit: 'Visita',
  send_quote: 'Enviar Cotizacion',
  close_deal: 'Cerrar Trato',
  escalate: 'Escalar',
  follow_up: 'Seguimiento',
};

const ACTION_ICONS: Record<string, string> = {
  call: 'phone',
  whatsapp: 'message-circle',
  email: 'mail',
  visit: 'map-pin',
  send_quote: 'file-text',
  close_deal: 'check-circle',
  escalate: 'alert-triangle',
  follow_up: 'refresh-cw',
};

const URGENCY_LABELS: Record<string, string> = {
  critical: 'Critico',
  high: 'Alto',
  medium: 'Medio',
  low: 'Bajo',
};

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface LeadIntelligence {
  leadId: string;
  companyName: string;
  contactName: string;
  contactPhone: string | null;
  currentStage: string;
  stageLabel: string;
  zone: string;
  estimatedValue: number;
  assignedTo: { id: string; name: string; email: string } | null;

  interactions: {
    totalVisits: number;
    totalTasks: number;
    completedTasks: number;
    lastContactDate: string | null;
    daysSinceContact: number | null;
    lastVisitDate: string | null;
    lastTaskOutcome: string | null;
    activeSequences: number;
    openAlerts: number;
  };

  nextBestAction: {
    type: string;
    typeLabel: string;
    typeIcon: string;
    channel: string;
    reason: string;
    script: string;
    urgency: 'critical' | 'high' | 'medium' | 'low';
    urgencyLabel: string;
    deadline: string;
  };

  risk: {
    level: 'critical' | 'high' | 'medium' | 'low' | 'none';
    factors: string[];
    daysAtRisk: number;
    estimatedLossIfIgnored: number;
  };

  stageProgression: {
    currentStage: string;
    nextStage: string;
    nextStageLabel: string;
    blockingFactor: string | null;
    probabilityOfAdvance: number;
    estimatedDaysToClose: number;
  };
}

export interface DirectorBriefing {
  date: string;
  teamHealth: {
    activeAdvisors: number;
    totalActivePipeline: number;
    avgCompletionRate: number;
    criticalAlerts: number;
    overdueItems: number;
  };
  directorTasks: LeadIntelligence[];
  teamBottlenecks: Array<{
    advisorName: string;
    issue: string;
    severity: string;
    recommendation: string;
  }>;
  closingOpportunities: LeadIntelligence[];
  atRiskDeals: LeadIntelligence[];
  weeklyForecast: {
    expectedCloses: number;
    expectedRevenue: number;
    dealsPushing: number;
    dealsAtRisk: number;
  };
}

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

@Injectable()
export class FollowUpIntelligenceService {
  private readonly logger = new Logger(FollowUpIntelligenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Public API ────────────────────────────────────────────

  async getLeadIntelligence(leadId: string): Promise<LeadIntelligence> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        visits: {
          orderBy: { visitDate: 'desc' },
          take: 10,
        },
      },
    });

    if (!lead) {
      throw new NotFoundException(`Lead ${leadId} no encontrado`);
    }

    // Normalize assignedTo to include computed name
    if (lead.assignedTo) {
      (lead.assignedTo as any).name = `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`;
    }

    const [tasks, sequences, alerts] = await Promise.all([
      this.prisma.salesTask.findMany({
        where: { leadId, isHistorical: false },
        orderBy: { dueDate: 'desc' },
        take: 20,
      }),
      this.prisma.followUpSequence.findMany({
        where: { leadId },
      }),
      this.prisma.salesAlert.findMany({
        where: { leadId, status: { not: 'resolved' } },
      }),
    ]);

    return this.buildLeadIntelligence(lead, tasks, sequences, alerts);
  }

  async getBulkIntelligence(filters?: {
    zone?: string;
    advisorId?: string;
    minValue?: number;
    urgency?: string;
  }): Promise<{
    leads: LeadIntelligence[];
    summary: {
      total: number;
      byUrgency: Record<string, number>;
      byAction: Record<string, number>;
      byRisk: Record<string, number>;
      totalValueAtRisk: number;
    };
  }> {
    const where: any = {
      status: { notIn: TERMINAL_STATUSES },
      isHistorical: false,
    };
    if (filters?.zone) where.zone = filters.zone;
    if (filters?.advisorId) where.assignedToId = filters.advisorId;
    if (filters?.minValue) where.estimatedValue = { gte: filters.minValue };

    const leads = await this.prisma.lead.findMany({
      where,
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        visits: { orderBy: { visitDate: 'desc' }, take: 5 },
      },
      orderBy: { estimatedValue: 'desc' },
    });

    const leadIds = leads.map((l: any) => l.id);

    const [allTasks, allSequences, allAlerts] = await Promise.all([
      this.prisma.salesTask.findMany({
        where: { leadId: { in: leadIds }, isHistorical: false },
        orderBy: { dueDate: 'desc' },
      }),
      this.prisma.followUpSequence.findMany({
        where: { leadId: { in: leadIds } },
      }),
      this.prisma.salesAlert.findMany({
        where: { leadId: { in: leadIds }, status: { not: 'resolved' } },
      }),
    ]);

    const tasksByLead = this.groupBy(allTasks, 'leadId');
    const seqByLead = this.groupBy(allSequences, 'leadId');
    const alertsByLead = this.groupBy(allAlerts, 'leadId');

    // Normalize assignedTo name
    for (const lead of leads) {
      if (lead.assignedTo) {
        (lead.assignedTo as any).name = `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`;
      }
    }

    let intelligenceList = leads.map((lead: any) =>
      this.buildLeadIntelligence(
        lead,
        tasksByLead[lead.id] || [],
        seqByLead[lead.id] || [],
        alertsByLead[lead.id] || [],
      ),
    );

    if (filters?.urgency) {
      intelligenceList = intelligenceList.filter(
        (li) => li.nextBestAction.urgency === filters.urgency,
      );
    }

    // Sort: critical first, then by estimated value desc
    intelligenceList.sort((a: any, b: any) => {
      const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      const diff =
        (urgencyOrder[a.nextBestAction.urgency] ?? 4) -
        (urgencyOrder[b.nextBestAction.urgency] ?? 4);
      if (diff !== 0) return diff;
      return b.estimatedValue - a.estimatedValue;
    });

    const byUrgency: Record<string, number> = {};
    const byAction: Record<string, number> = {};
    const byRisk: Record<string, number> = {};
    let totalValueAtRisk = 0;

    for (const li of intelligenceList) {
      byUrgency[li.nextBestAction.urgency] =
        (byUrgency[li.nextBestAction.urgency] || 0) + 1;
      byAction[li.nextBestAction.type] =
        (byAction[li.nextBestAction.type] || 0) + 1;
      byRisk[li.risk.level] = (byRisk[li.risk.level] || 0) + 1;
      if (li.risk.level !== 'none' && li.risk.level !== 'low') {
        totalValueAtRisk += li.risk.estimatedLossIfIgnored;
      }
    }

    return {
      leads: intelligenceList,
      summary: {
        total: intelligenceList.length,
        byUrgency,
        byAction,
        byRisk,
        totalValueAtRisk,
      },
    };
  }

  async getAdvisorIntelligence(advisorId: string): Promise<{
    advisor: { id: string; name: string };
    leads: LeadIntelligence[];
    summary: {
      totalLeads: number;
      criticalActions: number;
      highActions: number;
      todaysTasks: number;
      valueAtRisk: number;
      topPriorities: LeadIntelligence[];
    };
  }> {
    const advisorRaw = await this.prisma.user.findUnique({
      where: { id: advisorId },
      select: { id: true, firstName: true, lastName: true },
    });

    if (!advisorRaw) {
      throw new NotFoundException(`Asesor ${advisorId} no encontrado`);
    }

    const advisor = {
      id: advisorRaw.id,
      name: `${advisorRaw.firstName} ${advisorRaw.lastName}`,
    };

    const { leads } = await this.getBulkIntelligence({ advisorId });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todaysTasks = await this.prisma.salesTask.count({
      where: {
        advisorId,
        status: { in: ['pending', 'in_progress'] },
        dueDate: { gte: today, lt: tomorrow },
        isHistorical: false,
      },
    });

    const criticalActions = leads.filter(
      (l) => l.nextBestAction.urgency === 'critical',
    ).length;
    const highActions = leads.filter(
      (l) => l.nextBestAction.urgency === 'high',
    ).length;

    let valueAtRisk = 0;
    for (const l of leads) {
      if (l.risk.level !== 'none' && l.risk.level !== 'low') {
        valueAtRisk += l.risk.estimatedLossIfIgnored;
      }
    }

    const topPriorities = leads.slice(0, 5);

    return {
      advisor,
      leads,
      summary: {
        totalLeads: leads.length,
        criticalActions,
        highActions,
        todaysTasks,
        valueAtRisk,
        topPriorities,
      },
    };
  }

  async getDirectorBriefing(): Promise<DirectorBriefing> {
    const now = new Date();
    const { leads: allIntelligence } = await this.getBulkIntelligence();

    // Team health
    const activeAdvisors = await this.prisma.user.count({
      where: {
        isActive: true,
        deletedAt: null,
      },
    });

    const totalActivePipeline = allIntelligence.reduce(
      (sum, li) => sum + li.estimatedValue,
      0,
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [completedTasks, totalTasks, criticalAlertCount, overdueCount] =
      await Promise.all([
        this.prisma.salesTask.count({
          where: { status: 'completed', completedAt: { gte: weekAgo }, isHistorical: false },
        }),
        this.prisma.salesTask.count({
          where: { dueDate: { gte: weekAgo, lte: now }, isHistorical: false },
        }),
        this.prisma.salesAlert.count({
          where: { severity: 'critical', status: { not: 'resolved' } },
        }),
        this.prisma.salesTask.count({
          where: { status: { in: ['pending', 'overdue'] }, dueDate: { lt: today }, isHistorical: false },
        }),
      ]);

    const avgCompletionRate =
      totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // Director tasks: high-value or critical risk
    const directorTasks = allIntelligence.filter(
      (li) =>
        li.estimatedValue >= 500_000 ||
        li.risk.level === 'critical' ||
        (this.isClosingStage(li.currentStage) &&
          (li.interactions.daysSinceContact ?? 0) >= 5),
    );

    // Team bottlenecks: advisors with many critical/high risk leads
    const advisorMap = new Map<
      string,
      { name: string; critical: number; high: number; total: number; overdue: number }
    >();
    for (const li of allIntelligence) {
      if (!li.assignedTo) continue;
      const key = li.assignedTo.id;
      if (!advisorMap.has(key)) {
        advisorMap.set(key, {
          name: li.assignedTo.name,
          critical: 0,
          high: 0,
          total: 0,
          overdue: 0,
        });
      }
      const entry = advisorMap.get(key)!;
      entry.total++;
      if (li.nextBestAction.urgency === 'critical') entry.critical++;
      if (li.nextBestAction.urgency === 'high') entry.high++;
      if (
        li.interactions.daysSinceContact !== null &&
        li.interactions.daysSinceContact > 14
      ) {
        entry.overdue++;
      }
    }

    const teamBottlenecks: DirectorBriefing['teamBottlenecks'] = [];
    for (const [, data] of advisorMap) {
      if (data.critical >= 3) {
        teamBottlenecks.push({
          advisorName: data.name,
          issue: `${data.critical} leads en estado critico sin atencion`,
          severity: 'critical',
          recommendation: `Reunion urgente con ${data.name} para redistribuir carga o priorizar acciones inmediatas`,
        });
      } else if (data.overdue >= 5) {
        teamBottlenecks.push({
          advisorName: data.name,
          issue: `${data.overdue} leads con mas de 14 dias sin contacto`,
          severity: 'high',
          recommendation: `Revisar pipeline de ${data.name}, posible sobrecarga o falta de seguimiento`,
        });
      } else if (data.high >= 5) {
        teamBottlenecks.push({
          advisorName: data.name,
          issue: `${data.high} leads de alta urgencia acumulados`,
          severity: 'medium',
          recommendation: `Monitorear de cerca la ejecucion de ${data.name} esta semana`,
        });
      }
    }

    // Closing opportunities
    const closingStages = [
      'COTIZACION_ENTREGADA',
      'ESPERANDO_CONTRATO',
      'PENDIENTE_PAGO',
    ];
    const closingOpportunities = allIntelligence
      .filter((li: any) => closingStages.includes(li.currentStage))
      .sort((a: any, b: any) => b.estimatedValue - a.estimatedValue)
      .slice(0, 10);

    // At risk deals
    const atRiskDeals = allIntelligence
      .filter((li: any) => li.risk.level === 'critical' || li.risk.level === 'high')
      .sort((a: any, b: any) => b.risk.estimatedLossIfIgnored - a.risk.estimatedLossIfIgnored)
      .slice(0, 10);

    // Weekly forecast
    const closingDeals = allIntelligence.filter(
      (li) =>
        closingStages.includes(li.currentStage) &&
        li.stageProgression.probabilityOfAdvance >= 60,
    );
    const expectedCloses = closingDeals.length;
    const expectedRevenue = closingDeals.reduce(
      (sum, li) =>
        sum + li.estimatedValue * (li.stageProgression.probabilityOfAdvance / 100),
      0,
    );
    const dealsPushing = allIntelligence.filter(
      (li) =>
        closingStages.includes(li.currentStage) &&
        li.stageProgression.probabilityOfAdvance < 60 &&
        li.stageProgression.probabilityOfAdvance >= 30,
    ).length;
    const dealsAtRisk = allIntelligence.filter(
      (li) => li.risk.level === 'critical' || li.risk.level === 'high',
    ).length;

    return {
      date: now.toISOString().slice(0, 10),
      teamHealth: {
        activeAdvisors,
        totalActivePipeline,
        avgCompletionRate,
        criticalAlerts: criticalAlertCount,
        overdueItems: overdueCount,
      },
      directorTasks,
      teamBottlenecks,
      closingOpportunities,
      atRiskDeals,
      weeklyForecast: {
        expectedCloses,
        expectedRevenue: Math.round(expectedRevenue),
        dealsPushing,
        dealsAtRisk,
      },
    };
  }

  // ─── Intelligence Builder ──────────────────────────────────

  private buildLeadIntelligence(
    lead: any,
    tasks: any[],
    sequences: any[],
    alerts: any[],
  ): LeadIntelligence {
    const now = new Date();
    const status: string = lead.status;
    const value = lead.estimatedValue ?? 0;

    // Interaction analysis
    const completedTasks = tasks.filter((t: any) => t.status === 'completed');
    const lastVisit = lead.visits?.[0] ?? null;
    const lastCompletedTask = completedTasks[0] ?? null;
    const activeSequences = sequences.filter((s: any) => s.status === 'active').length;
    const openAlerts = alerts.length;

    const lastContactDate = lead.lastContactedAt
      ? new Date(lead.lastContactedAt)
      : null;
    const daysSinceContact = lastContactDate
      ? this.daysBetween(lastContactDate, now)
      : null;

    const lastVisitDate = lastVisit
      ? new Date(lastVisit.visitDate).toISOString()
      : null;

    const interactions = {
      totalVisits: lead.visits?.length ?? 0,
      totalTasks: tasks.length,
      completedTasks: completedTasks.length,
      lastContactDate: lastContactDate?.toISOString() ?? null,
      daysSinceContact,
      lastVisitDate,
      lastTaskOutcome: lastCompletedTask?.outcome ?? null,
      activeSequences,
      openAlerts,
    };

    // Next best action
    const nextBestAction = this.computeNextBestAction(
      status,
      daysSinceContact,
      value,
      interactions,
      lead,
    );

    // Risk assessment
    const risk = this.computeRisk(status, daysSinceContact, value, lead.createdAt);

    // Stage progression
    const stageProgression = this.computeStageProgression(
      status,
      daysSinceContact,
      value,
      interactions,
    );

    return {
      leadId: lead.id,
      companyName: lead.companyName,
      contactName: lead.contactName,
      contactPhone: lead.contactPhone ?? null,
      currentStage: status,
      stageLabel: STATUS_LABELS[status] ?? status,
      zone: lead.zone,
      estimatedValue: value,
      assignedTo: lead.assignedTo ?? null,
      interactions,
      nextBestAction,
      risk,
      stageProgression,
    };
  }

  // ─── Next Best Action Logic ────────────────────────────────

  private computeNextBestAction(
    status: string,
    daysSinceContact: number | null,
    value: number,
    interactions: LeadIntelligence['interactions'],
    lead: any,
  ): LeadIntelligence['nextBestAction'] {
    const contactName = lead.contactName || 'el contacto';
    const companyName = lead.companyName || 'la empresa';
    const days = daysSinceContact ?? 999;

    switch (status) {
      case 'PENDIENTE_CONTACTAR':
        return {
          type: 'call',
          typeLabel: ACTION_LABELS.call,
          typeIcon: ACTION_ICONS.call,
          channel: 'phone',
          reason: 'Primer contacto pendiente — lead nuevo sin atencion',
          script: `Hola ${contactName}, le llamo de IEA. Nos enteramos de que ${companyName} podria estar interesada en nuestros servicios de control de combustible y rastreo GPS. Me gustaria platicarle como hemos ayudado a empresas similares a reducir sus costos de flotilla. Tiene unos minutos?`,
          urgency: days >= 3 ? 'critical' : days >= 1 ? 'high' : 'medium',
          urgencyLabel: URGENCY_LABELS[days >= 3 ? 'critical' : days >= 1 ? 'high' : 'medium'],
          deadline: 'hoy',
        };

      case 'INTENTANDO_CONTACTAR': {
        const failedCalls = interactions.totalTasks - interactions.completedTasks;
        if (failedCalls >= 2) {
          return {
            type: 'whatsapp',
            typeLabel: ACTION_LABELS.whatsapp,
            typeIcon: ACTION_ICONS.whatsapp,
            channel: 'whatsapp',
            reason: `${failedCalls} intentos de llamada sin respuesta — cambiar a WhatsApp`,
            script: `Hola ${contactName}, soy de IEA. He intentado comunicarme por telefono sin exito. Le escribo por este medio para presentarle nuestras soluciones de gestion de flotillas. Le parece si agendamos una llamada breve a su conveniencia?`,
            urgency: days >= 7 ? 'high' : 'medium',
            urgencyLabel: URGENCY_LABELS[days >= 7 ? 'high' : 'medium'],
            deadline: 'hoy',
          };
        }
        return {
          type: 'call',
          typeLabel: ACTION_LABELS.call,
          typeIcon: ACTION_ICONS.call,
          channel: 'phone',
          reason: 'Continuar intentos de contacto telefonico',
          script: `Hola ${contactName}, le llamo de IEA. Estuvimos intentando comunicarnos con usted respecto a soluciones de control para ${companyName}. Tiene un momento para platicar?`,
          urgency: days >= 5 ? 'high' : 'medium',
          urgencyLabel: URGENCY_LABELS[days >= 5 ? 'high' : 'medium'],
          deadline: 'hoy',
        };
      }

      case 'EN_PROSPECCION': {
        if (value >= 300_000) {
          return {
            type: 'visit',
            typeLabel: ACTION_LABELS.visit,
            typeIcon: ACTION_ICONS.visit,
            channel: 'in_person',
            reason: `Lead de alto valor ($${this.formatMoney(value)}) en prospeccion — visita presencial recomendada`,
            script: `Hola ${contactName}, me gustaria agendar una visita a ${companyName} para mostrarle en persona como nuestra solucion se adapta a sus necesidades. Que dia le conviene esta semana?`,
            urgency: days >= 7 ? 'high' : 'medium',
            urgencyLabel: URGENCY_LABELS[days >= 7 ? 'high' : 'medium'],
            deadline: 'esta semana',
          };
        }
        return {
          type: 'follow_up',
          typeLabel: ACTION_LABELS.follow_up,
          typeIcon: ACTION_ICONS.follow_up,
          channel: 'whatsapp',
          reason: 'Seguimiento de prospeccion — mantener interes activo',
          script: `Hola ${contactName}, queria darle seguimiento a nuestra platica sobre las soluciones para ${companyName}. Ha tenido oportunidad de revisar la informacion que le envie? Quedo atento a cualquier duda.`,
          urgency: days >= 14 ? 'high' : days >= 7 ? 'medium' : 'low',
          urgencyLabel: URGENCY_LABELS[days >= 14 ? 'high' : days >= 7 ? 'medium' : 'low'],
          deadline: days >= 7 ? 'hoy' : 'esta semana',
        };
      }

      case 'AGENDAR_CITA':
        return {
          type: 'call',
          typeLabel: ACTION_LABELS.call,
          typeIcon: ACTION_ICONS.call,
          channel: 'phone',
          reason: 'Confirmar o agendar cita pendiente',
          script: `Hola ${contactName}, le llamo para confirmar nuestra cita. Sigue disponible en la fecha que acordamos? De no ser asi, con gusto buscamos otra fecha esta semana para visitarle en ${companyName}.`,
          urgency: days >= 5 ? 'high' : 'medium',
          urgencyLabel: URGENCY_LABELS[days >= 5 ? 'high' : 'medium'],
          deadline: 'manana',
        };

      case 'ESPERANDO_COTIZACION':
        return {
          type: 'send_quote',
          typeLabel: ACTION_LABELS.send_quote,
          typeIcon: ACTION_ICONS.send_quote,
          channel: 'email',
          reason: 'Cotizacion pendiente de envio',
          script: `Estimado ${contactName}, adjunto encontrara la cotizacion personalizada para ${companyName} con base en lo que platicamos. Incluye nuestras soluciones de rastreo GPS y control de combustible. Quedo a sus ordenes para cualquier duda o ajuste.`,
          urgency: days >= 3 ? 'high' : 'medium',
          urgencyLabel: URGENCY_LABELS[days >= 3 ? 'high' : 'medium'],
          deadline: 'hoy',
        };

      case 'COTIZACION_ENTREGADA': {
        if (days >= 3) {
          return {
            type: 'close_deal',
            typeLabel: ACTION_LABELS.close_deal,
            typeIcon: ACTION_ICONS.close_deal,
            channel: 'phone',
            reason: `Cotizacion entregada hace ${days} dias — momento de buscar cierre`,
            script: `Hola ${contactName}, queria darle seguimiento a la cotizacion que le enviamos para ${companyName}. Ha tenido oportunidad de revisarla con su equipo? Me gustaria resolver cualquier duda y, si todo esta en orden, proceder con los siguientes pasos.`,
            urgency: days >= 7 ? 'critical' : 'high',
            urgencyLabel: URGENCY_LABELS[days >= 7 ? 'critical' : 'high'],
            deadline: 'hoy',
          };
        }
        return {
          type: 'call',
          typeLabel: ACTION_LABELS.call,
          typeIcon: ACTION_ICONS.call,
          channel: 'phone',
          reason: 'Seguimiento de cotizacion entregada',
          script: `Hola ${contactName}, le llamo para saber si tuvo oportunidad de revisar la cotizacion que le enviamos. Estoy disponible para aclarar cualquier punto o hacer ajustes segun las necesidades de ${companyName}.`,
          urgency: 'medium',
          urgencyLabel: URGENCY_LABELS.medium,
          deadline: 'manana',
        };
      }

      case 'ESPERANDO_CONTRATO':
        return {
          type: 'call',
          typeLabel: ACTION_LABELS.call,
          typeIcon: ACTION_ICONS.call,
          channel: 'phone',
          reason: 'Seguimiento de contrato en proceso',
          script: `Hola ${contactName}, le llamo respecto al contrato de ${companyName}. Como va el proceso de revision? Hay algo que necesite de nuestra parte para agilizar la firma?`,
          urgency: days >= 5 ? 'high' : 'medium',
          urgencyLabel: URGENCY_LABELS[days >= 5 ? 'high' : 'medium'],
          deadline: days >= 3 ? 'hoy' : 'manana',
        };

      case 'PENDIENTE_PAGO': {
        if (days >= 7) {
          return {
            type: 'escalate',
            typeLabel: ACTION_LABELS.escalate,
            typeIcon: ACTION_ICONS.escalate,
            channel: 'phone',
            reason: `Pago pendiente por mas de ${days} dias — requiere escalacion`,
            script: `${contactName}, le contacto de nuevo respecto al pago pendiente de ${companyName}. Entendemos que pueden surgir retrasos, pero necesitamos confirmar la fecha de pago para proceder con la instalacion. Es necesario involucrar a alguien mas de su lado para agilizar?`,
            urgency: 'critical',
            urgencyLabel: URGENCY_LABELS.critical,
            deadline: 'hoy',
          };
        }
        return {
          type: 'call',
          typeLabel: ACTION_LABELS.call,
          typeIcon: ACTION_ICONS.call,
          channel: 'phone',
          reason: 'Seguimiento de pago pendiente',
          script: `Hola ${contactName}, le llamo para dar seguimiento al pago de ${companyName}. Tiene alguna fecha estimada para que podamos coordinar la instalacion?`,
          urgency: days >= 3 ? 'high' : 'medium',
          urgencyLabel: URGENCY_LABELS[days >= 3 ? 'high' : 'medium'],
          deadline: 'hoy',
        };
      }

      default:
        return {
          type: 'follow_up',
          typeLabel: ACTION_LABELS.follow_up,
          typeIcon: ACTION_ICONS.follow_up,
          channel: 'phone',
          reason: 'Lead en etapa terminal o desconocida',
          script: `Contactar a ${contactName} de ${companyName} para verificar estado actual.`,
          urgency: 'low',
          urgencyLabel: URGENCY_LABELS.low,
          deadline: 'esta semana',
        };
    }
  }

  // ─── Risk Assessment ───────────────────────────────────────

  private computeRisk(
    status: string,
    daysSinceContact: number | null,
    value: number,
    createdAt: Date,
  ): LeadIntelligence['risk'] {
    const days = daysSinceContact ?? 0;
    const factors: string[] = [];
    let level: LeadIntelligence['risk']['level'] = 'none';
    let daysAtRisk = 0;

    // High value + no recent contact
    if (value >= 300_000 && days >= 7) {
      factors.push(
        `Lead de alto valor ($${this.formatMoney(value)}) sin contacto en ${days} dias`,
      );
      level = this.escalateRisk(level, 'high');
      daysAtRisk = Math.max(daysAtRisk, days - 7);
    }

    // No contact 60+ days
    if (days >= 60 && value >= 100_000) {
      factors.push(`Sin contacto en ${days} dias con valor significativo`);
      level = this.escalateRisk(level, 'critical');
      daysAtRisk = Math.max(daysAtRisk, days - 60);
    } else if (days >= 30) {
      factors.push(`Sin contacto en ${days} dias`);
      level = this.escalateRisk(level, 'high');
      daysAtRisk = Math.max(daysAtRisk, days - 30);
    } else if (days >= 14) {
      factors.push(`${days} dias sin contacto`);
      level = this.escalateRisk(level, 'medium');
      daysAtRisk = Math.max(daysAtRisk, days - 14);
    }

    // Stalled stage
    const stageAge = this.daysBetween(new Date(createdAt), new Date());
    const expectedDaysPerStage = this.getExpectedDaysForStage(status);
    if (stageAge > expectedDaysPerStage * 2) {
      factors.push(
        `Etapa "${STATUS_LABELS[status] ?? status}" estancada por ${stageAge} dias (esperado: ${expectedDaysPerStage})`,
      );
      level = this.escalateRisk(level, stageAge > expectedDaysPerStage * 3 ? 'high' : 'medium');
      daysAtRisk = Math.max(daysAtRisk, stageAge - expectedDaysPerStage);
    }

    // Closing stage stuck
    if (this.isClosingStage(status) && days >= 5) {
      factors.push(
        `Etapa de cierre sin movimiento por ${days} dias`,
      );
      level = this.escalateRisk(level, days >= 10 ? 'critical' : 'high');
      daysAtRisk = Math.max(daysAtRisk, days - 5);
    }

    const estimatedLossIfIgnored =
      level === 'none' || level === 'low'
        ? 0
        : Math.round(value * this.riskMultiplier(level));

    return { level, factors, daysAtRisk, estimatedLossIfIgnored };
  }

  // ─── Stage Progression ─────────────────────────────────────

  private computeStageProgression(
    status: string,
    daysSinceContact: number | null,
    value: number,
    interactions: LeadIntelligence['interactions'],
  ): LeadIntelligence['stageProgression'] {
    const nextStage = NEXT_STAGE[status] ?? status;
    const days = daysSinceContact ?? 0;

    let blockingFactor: string | null = null;
    let probability = 50;

    // Adjust probability based on activity
    if (interactions.completedTasks > 0) probability += 10;
    if (interactions.totalVisits > 0) probability += 10;
    if (interactions.activeSequences > 0) probability += 5;

    // Penalize inactivity
    if (days >= 30) {
      probability -= 30;
      blockingFactor = `Sin contacto en ${days} dias`;
    } else if (days >= 14) {
      probability -= 20;
      blockingFactor = `${days} dias sin seguimiento`;
    } else if (days >= 7) {
      probability -= 10;
      blockingFactor = `${days} dias desde ultimo contacto`;
    }

    // Penalize open alerts
    if (interactions.openAlerts >= 3) {
      probability -= 15;
      blockingFactor = blockingFactor ?? `${interactions.openAlerts} alertas abiertas`;
    }

    // Stage-specific blocking factors
    switch (status) {
      case 'PENDIENTE_CONTACTAR':
        if (days >= 1) blockingFactor = 'Lead nuevo sin primer contacto';
        break;
      case 'ESPERANDO_COTIZACION':
        blockingFactor = blockingFactor ?? 'Cotizacion pendiente de envio';
        break;
      case 'COTIZACION_ENTREGADA':
        if (days >= 5) blockingFactor = 'Cotizacion sin respuesta del cliente';
        break;
      case 'ESPERANDO_CONTRATO':
        if (days >= 3) blockingFactor = 'Contrato en revision sin avance';
        break;
      case 'PENDIENTE_PAGO':
        if (days >= 3) blockingFactor = 'Pago pendiente sin confirmar';
        break;
    }

    probability = Math.max(5, Math.min(95, probability));

    // Estimate days to close based on current stage
    const stagesRemaining =
      (STAGE_ORDER['CERRADO_GANADO'] ?? 9) - (STAGE_ORDER[status] ?? 1);
    const avgDaysPerStage = 7;
    const estimatedDaysToClose = Math.max(
      1,
      stagesRemaining * avgDaysPerStage * (1 + (100 - probability) / 100),
    );

    return {
      currentStage: status,
      nextStage,
      nextStageLabel: STATUS_LABELS[nextStage] ?? nextStage,
      blockingFactor,
      probabilityOfAdvance: probability,
      estimatedDaysToClose: Math.round(estimatedDaysToClose),
    };
  }

  // ─── Helpers ───────────────────────────────────────────────

  private daysBetween(a: Date, b: Date): number {
    const ms = Math.abs(b.getTime() - a.getTime());
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  }

  private formatMoney(value: number): string {
    return value.toLocaleString('es-MX', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  private isClosingStage(status: string): boolean {
    return ['COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO'].includes(
      status,
    );
  }

  private getExpectedDaysForStage(status: string): number {
    const defaults: Record<string, number> = {
      PENDIENTE_CONTACTAR: 2,
      INTENTANDO_CONTACTAR: 5,
      EN_PROSPECCION: 14,
      AGENDAR_CITA: 7,
      ESPERANDO_COTIZACION: 5,
      COTIZACION_ENTREGADA: 7,
      ESPERANDO_CONTRATO: 10,
      PENDIENTE_PAGO: 7,
    };
    return defaults[status] ?? 7;
  }

  private escalateRisk(
    current: LeadIntelligence['risk']['level'],
    candidate: LeadIntelligence['risk']['level'],
  ): LeadIntelligence['risk']['level'] {
    const order = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
    return order[candidate] > order[current] ? candidate : current;
  }

  private riskMultiplier(level: string): number {
    switch (level) {
      case 'critical':
        return 0.9;
      case 'high':
        return 0.6;
      case 'medium':
        return 0.3;
      default:
        return 0;
    }
  }

  private groupBy<T extends Record<string, any>>(
    items: T[],
    key: string,
  ): Record<string, T[]> {
    const map: Record<string, T[]> = {};
    for (const item of items) {
      const k = item[key];
      if (k == null) continue;
      if (!map[k]) map[k] = [];
      map[k].push(item);
    }
    return map;
  }
}
