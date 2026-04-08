import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const TERMINAL = ['CERRADO_GANADO', 'CERRADO_PERDIDO', 'LEAD_BASURA', 'CONTACTAR_FUTURO'];

const LIFECYCLE_LABELS: Record<string, string> = {
  NEW_CLIENT: 'Cliente Nuevo',
  ACTIVE_CLIENT: 'Cliente Activo',
  INACTIVE_CLIENT: 'Cliente Inactivo',
  REACTIVATED_CLIENT: 'Cliente Reactivado',
  EXPANSION_CLIENT: 'Cliente en Expansion',
};

const SYSTEM_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendiente',
  INSTALLED: 'Instalado',
  ACTIVE: 'Activo',
  MAINTENANCE: 'Mantenimiento',
  DECOMMISSIONED: 'Dado de Baja',
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  no_followup: 'Sin Seguimiento Post-Venta',
  inactive_client: 'Cliente Inactivo',
  upsell_opportunity: 'Oportunidad de Upsell',
  referral_opportunity: 'Oportunidad de Referido',
  churn_risk: 'Riesgo de Churn',
  expansion_detected: 'Expansion Detectada',
  satisfaction_low: 'Satisfaccion Baja',
};

/** Post-sale sequence template: steps generated after project completion */
const POST_SALE_SEQUENCE = [
  {
    dayOffset: 3,
    stepType: 'onboarding',
    channel: 'whatsapp',
    subject: 'Bienvenida Post-Instalacion',
    messageBody: 'Hola {contactName}, gracias por confiar en IEA para su proyecto en {companyName}. Queremos asegurarnos de que todo funcione perfectamente. Cualquier duda sobre su sistema {systemSize}, estamos para servirle. Saludos, {advisorName}.',
  },
  {
    dayOffset: 15,
    stepType: 'satisfaction_check',
    channel: 'whatsapp',
    subject: 'Revision de Satisfaccion - Dia 15',
    messageBody: 'Hola {contactName}, han pasado 2 semanas desde la instalacion de su sistema en {companyName}. Nos gustaria saber: del 1 al 10, como calificaria su experiencia? Sus comentarios nos ayudan a mejorar. Gracias!',
  },
  {
    dayOffset: 30,
    stepType: 'performance_review',
    channel: 'call',
    subject: 'Revision de Rendimiento - Dia 30',
    messageBody: 'Llamar a {contactName} de {companyName} para revision de rendimiento del sistema a 30 dias. Verificar: produccion energetica, ahorros reales vs proyectados, cualquier incidencia. Documentar resultados.',
  },
  {
    dayOffset: 90,
    stepType: 'upsell_check',
    channel: 'whatsapp',
    subject: 'Revision Trimestral + Expansion',
    messageBody: 'Hola {contactName}, ya han pasado 3 meses desde la instalacion en {companyName}. Nos gustaria revisar los ahorros acumulados y explorar si hay oportunidad de ampliar su sistema o agregar almacenamiento. Le llamo esta semana?',
  },
  {
    dayOffset: 180,
    stepType: 'referral_request',
    channel: 'whatsapp',
    subject: 'Solicitud de Referido',
    messageBody: 'Hola {contactName}! 6 meses con su sistema solar y esperamos que los resultados sean excelentes. En IEA valoramos mucho a nuestros clientes. Si conoce a alguien que pueda beneficiarse de energia solar, nos encantaria atenderlo. Como agradecimiento, ofrecemos {referralIncentive} por cada referido que concrete. Gracias!',
  },
];

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

@Injectable()
export class ClientLifecycleService {
  private readonly log = new Logger(ClientLifecycleService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Client Sync ─────────────────────────────────────────

  /**
   * Auto-create ClientProfile for every CERRADO_GANADO lead that
   * doesn't yet have one. This is the bridge from sales → post-sale.
   */
  async syncClientsFromWonLeads() {
    const wonLeads = await this.prisma.lead.findMany({
      where: {
        status: 'CERRADO_GANADO',
        deletedAt: null,
      },
      include: { assignedTo: true },
    });

    const existing = await this.prisma.clientProfile.findMany({
      select: { leadId: true },
    });
    const existingSet = new Set(existing.map((e) => e.leadId));

    let created = 0;
    for (const lead of wonLeads) {
      if (existingSet.has(lead.id)) continue;

      await this.prisma.clientProfile.create({
        data: {
          leadId: lead.id,
          companyName: lead.companyName,
          contactName: lead.contactName,
          contactEmail: lead.contactEmail,
          contactPhone: lead.contactPhone,
          advisorId: lead.assignedToId,
          zone: lead.zone,
          city: lead.city,
          industry: lead.industry,
          totalRevenue: lead.estimatedValue ?? 0,
          avgProjectValue: lead.estimatedValue ?? 0,
          lifetimeValue: lead.estimatedValue ?? 0,
          becameClientAt: lead.convertedAt ?? new Date(),
        },
      });
      created++;
    }

    this.log.log(`Synced ${created} new client profiles from ${wonLeads.length} won leads`);
    return { synced: created, total: wonLeads.length, alreadyExisting: existingSet.size };
  }

  // ─── Client CRUD ─────────────────────────────────────────

  async getClients(opts: {
    stage?: string; zone?: string; advisorId?: string; systemStatus?: string;
    search?: string; sortBy?: string; order?: 'asc' | 'desc';
    page?: number; limit?: number;
  }) {
    const where: any = {};
    if (opts.stage) where.lifecycleStage = opts.stage;
    if (opts.zone) where.zone = opts.zone;
    if (opts.advisorId) where.advisorId = opts.advisorId;
    if (opts.systemStatus) where.systemStatus = opts.systemStatus;
    if (opts.search) {
      where.OR = [
        { companyName: { contains: opts.search, mode: 'insensitive' } },
        { contactName: { contains: opts.search, mode: 'insensitive' } },
        { contactEmail: { contains: opts.search, mode: 'insensitive' } },
      ];
    }

    const page = opts.page ?? 1;
    const limit = opts.limit ?? 50;

    const orderBy: any = {};
    const sortField = opts.sortBy || 'becameClientAt';
    orderBy[sortField] = opts.order || 'desc';

    const [items, total] = await Promise.all([
      this.prisma.clientProfile.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.clientProfile.count({ where }),
    ]);

    return {
      items: items.map((c) => ({
        ...c,
        lifecycleLabel: LIFECYCLE_LABELS[c.lifecycleStage] ?? c.lifecycleStage,
        systemStatusLabel: SYSTEM_STATUS_LABELS[c.systemStatus] ?? c.systemStatus,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getClient(id: string) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id },
      include: {
        postSaleSteps: { orderBy: { dayOffset: 'asc' } },
        referrals: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!client) throw new NotFoundException('Client not found');

    // Get the lead data
    const lead = await this.prisma.lead.findUnique({
      where: { id: client.leadId },
      include: { assignedTo: true },
    });

    // Get client alerts
    const alerts = await this.prisma.clientAlert.findMany({
      where: { clientId: id, status: 'open' },
      orderBy: { priorityScore: 'desc' },
    });

    return {
      ...client,
      lifecycleLabel: LIFECYCLE_LABELS[client.lifecycleStage] ?? client.lifecycleStage,
      systemStatusLabel: SYSTEM_STATUS_LABELS[client.systemStatus] ?? client.systemStatus,
      lead,
      alerts,
      sequenceProgress: this._calculateSequenceProgress(client.postSaleSteps),
    };
  }

  async updateClient(id: string, data: any) {
    const client = await this.prisma.clientProfile.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });
    return client;
  }

  // ─── Post-Sale Sequences ─────────────────────────────────

  /**
   * Generate the post-sale follow-up sequence for a client.
   * Creates steps at day 3, 15, 30, 90, 180 post-project-completion.
   */
  async generatePostSaleSequence(clientId: string) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id: clientId },
    });
    if (!client) throw new NotFoundException('Client not found');

    // Check if sequence already exists
    const existingSteps = await this.prisma.postSaleStep.count({
      where: { clientId },
    });
    if (existingSteps > 0) {
      return { message: 'Sequence already exists', steps: existingSteps };
    }

    const baseDate = client.projectCompletedAt ?? client.becameClientAt;

    // Get advisor name for message templates
    let advisorName = 'tu asesor en IEA';
    if (client.advisorId) {
      const advisor = await this.prisma.user.findUnique({
        where: { id: client.advisorId },
        select: { firstName: true, lastName: true },
      });
      if (advisor) advisorName = `${advisor.firstName} ${advisor.lastName}`;
    }

    const steps = POST_SALE_SEQUENCE.map((tpl) => {
      const scheduledAt = new Date(baseDate);
      scheduledAt.setDate(scheduledAt.getDate() + tpl.dayOffset);

      // Template variable replacement
      const body = tpl.messageBody
        .replace('{contactName}', client.contactName)
        .replace('{companyName}', client.companyName)
        .replace('{systemSize}', client.systemSize ?? 'instalado')
        .replace('{advisorName}', advisorName)
        .replace('{referralIncentive}', 'un beneficio especial');

      return {
        clientId,
        stepType: tpl.stepType,
        channel: tpl.channel,
        dayOffset: tpl.dayOffset,
        subject: tpl.subject,
        messageBody: body,
        scheduledAt,
        status: 'pending',
      };
    });

    const created = await this.prisma.postSaleStep.createMany({ data: steps });

    // Update next follow-up on client
    const nextStep = steps[0];
    await this.prisma.clientProfile.update({
      where: { id: clientId },
      data: { nextFollowUpAt: nextStep.scheduledAt },
    });

    this.log.log(`Generated ${created.count} post-sale steps for client ${client.companyName}`);
    return { created: created.count, clientId, steps };
  }

  async getClientSteps(clientId: string) {
    const steps = await this.prisma.postSaleStep.findMany({
      where: { clientId },
      orderBy: { dayOffset: 'asc' },
    });
    return steps.map((s) => ({
      ...s,
      isOverdue: s.status === 'pending' && s.scheduledAt && new Date(s.scheduledAt) < new Date(),
      isPending: s.status === 'pending',
    }));
  }

  async updateStep(stepId: string, data: any) {
    return this.prisma.postSaleStep.update({
      where: { id: stepId },
      data,
    });
  }

  async executeStep(stepId: string) {
    const step = await this.prisma.postSaleStep.update({
      where: { id: stepId },
      data: {
        status: 'sent',
        sentAt: new Date(),
      },
    });

    // Update client's last contacted date
    await this.prisma.clientProfile.update({
      where: { id: step.clientId },
      data: { lastContactedAt: new Date() },
    });

    // Find next pending step and update nextFollowUpAt
    const nextStep = await this.prisma.postSaleStep.findFirst({
      where: { clientId: step.clientId, status: 'pending' },
      orderBy: { dayOffset: 'asc' },
    });
    if (nextStep) {
      await this.prisma.clientProfile.update({
        where: { id: step.clientId },
        data: { nextFollowUpAt: nextStep.scheduledAt },
      });
    }

    return step;
  }

  // ─── Referrals ───────────────────────────────────────────

  async createReferral(clientId: string, data: {
    referredName: string; referredCompany?: string;
    referredPhone?: string; referredEmail?: string;
    referredIndustry?: string; notes?: string;
  }) {
    const client = await this.prisma.clientProfile.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Client not found');

    const referral = await this.prisma.referral.create({
      data: {
        referrerId: clientId,
        referredName: data.referredName,
        referredCompany: data.referredCompany,
        referredPhone: data.referredPhone,
        referredEmail: data.referredEmail,
        referredIndustry: data.referredIndustry,
        status: 'RECEIVED',
        receivedAt: new Date(),
        notes: data.notes,
      },
    });

    // Update referral count
    await this.prisma.clientProfile.update({
      where: { id: clientId },
      data: {
        referralCount: { increment: 1 },
        isReferralSource: true,
      },
    });

    return referral;
  }

  async getReferrals(status?: string) {
    const where: any = {};
    if (status) where.status = status;

    const referrals = await this.prisma.referral.findMany({
      where,
      include: { referrer: { select: { id: true, companyName: true, contactName: true, advisorId: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return referrals;
  }

  async updateReferral(id: string, data: any) {
    return this.prisma.referral.update({ where: { id }, data });
  }

  /**
   * Convert a referral into a new Lead in the pipeline.
   */
  async convertReferralToLead(referralId: string) {
    const referral = await this.prisma.referral.findUnique({
      where: { id: referralId },
      include: { referrer: true },
    });
    if (!referral) throw new NotFoundException('Referral not found');

    // Create a new lead from the referral
    const lead = await this.prisma.lead.create({
      data: {
        companyName: referral.referredCompany ?? referral.referredName,
        contactName: referral.referredName,
        contactPhone: referral.referredPhone,
        contactEmail: referral.referredEmail,
        industry: referral.referredIndustry,
        zone: (referral.referrer.zone as any) ?? 'OTROS',
        status: 'PENDIENTE_CONTACTAR',
        source: 'REFERRAL',
        address: 'Por confirmar',
        latitude: 20.6597,
        longitude: -103.3496,
        assignedToId: referral.referrer.advisorId,
        notes: `Referido por ${referral.referrer.companyName} (${referral.referrer.contactName})`,
      },
    });

    // Update referral
    await this.prisma.referral.update({
      where: { id: referralId },
      data: {
        status: 'CONVERTED',
        referredLeadId: lead.id,
        convertedAt: new Date(),
      },
    });

    this.log.log(`Referral converted to lead: ${lead.companyName} (from ${referral.referrer.companyName})`);
    return { referral: { ...referral, status: 'CONVERTED' }, lead };
  }

  // ─── Client Alerts ───────────────────────────────────────

  /**
   * Scan all clients and generate alerts for:
   * - No follow-up in 30+ days
   * - Inactive clients (90+ days no contact)
   * - Upsell opportunity (high expansion score)
   * - Referral opportunity (satisfied, no recent referral ask)
   * - Churn risk (high churn score)
   * - Satisfaction low (score <= 5)
   */
  async generateClientAlerts() {
    const clients = await this.prisma.clientProfile.findMany({
      include: { postSaleSteps: true, referrals: true },
    });
    const now = new Date();
    const alerts: Array<{
      clientId: string; advisorId: string | null;
      type: string; severity: string; title: string; message: string;
      recommendation: string | null; priorityScore: number; estimatedValue: number | null;
    }> = [];

    for (const client of clients) {
      const daysSinceContact = client.lastContactedAt
        ? Math.floor((now.getTime() - new Date(client.lastContactedAt).getTime()) / 86400000)
        : 999;

      // No follow-up in 30+ days
      if (daysSinceContact >= 30 && client.lifecycleStage !== 'INACTIVE_CLIENT') {
        alerts.push({
          clientId: client.id,
          advisorId: client.advisorId,
          type: 'no_followup',
          severity: daysSinceContact >= 60 ? 'critical' : 'high',
          title: `${client.companyName} sin contacto hace ${daysSinceContact} dias`,
          message: `El cliente ${client.companyName} no ha sido contactado en ${daysSinceContact} dias. Hay riesgo de perder la relacion y oportunidades de expansion.`,
          recommendation: `Contactar a ${client.contactName} para revision de satisfaccion y explorar necesidades adicionales.`,
          priorityScore: Math.min(100, 50 + daysSinceContact),
          estimatedValue: client.lifetimeValue,
        });
      }

      // Inactive client (90+ days)
      if (daysSinceContact >= 90) {
        alerts.push({
          clientId: client.id,
          advisorId: client.advisorId,
          type: 'inactive_client',
          severity: 'high',
          title: `${client.companyName} inactivo ${daysSinceContact}d`,
          message: `Cliente sin interaccion por ${daysSinceContact} dias. Transicionar a inactivo y evaluar reactivacion.`,
          recommendation: 'Llamar para revision de sistema, ofrecer mantenimiento preventivo o mejoras.',
          priorityScore: Math.min(100, 40 + Math.floor(daysSinceContact / 2)),
          estimatedValue: client.lifetimeValue * 0.3,
        });
      }

      // Upsell opportunity
      if (client.expansionScore >= 70 && client.lifecycleStage !== 'EXPANSION_CLIENT') {
        alerts.push({
          clientId: client.id,
          advisorId: client.advisorId,
          type: 'upsell_opportunity',
          severity: 'medium',
          title: `Oportunidad de expansion en ${client.companyName}`,
          message: `Score de expansion: ${client.expansionScore}/100. ${client.expansionType ? `Tipo: ${client.expansionType}` : 'Evaluar tipo de expansion.'} ${client.hasMultipleLocations ? 'Tiene multiples ubicaciones.' : ''}`,
          recommendation: `Proponer ${client.expansionType ?? 'ampliacion de sistema'} a ${client.contactName}.`,
          priorityScore: client.expansionScore,
          estimatedValue: client.avgProjectValue * 0.5,
        });
      }

      // Referral opportunity
      const hasRecentReferralAsk = client.postSaleSteps.some(
        (s) => s.stepType === 'referral_request' && s.status === 'sent',
      );
      if (
        client.satisfactionScore && client.satisfactionScore >= 8 &&
        client.referralCount === 0 && !hasRecentReferralAsk &&
        daysSinceContact < 60
      ) {
        alerts.push({
          clientId: client.id,
          advisorId: client.advisorId,
          type: 'referral_opportunity',
          severity: 'low',
          title: `${client.companyName} es candidato a referidos`,
          message: `Satisfaccion: ${client.satisfactionScore}/10, NPS: ${client.npsScore ?? 'N/A'}. Cliente satisfecho sin referidos registrados.`,
          recommendation: 'Pedir referidos ofreciendo incentivo. Clientes satisfechos generan leads de alta conversion.',
          priorityScore: 60,
          estimatedValue: client.avgProjectValue * 0.8,
        });
      }

      // Churn risk
      if (client.churnRisk >= 60) {
        alerts.push({
          clientId: client.id,
          advisorId: client.advisorId,
          type: 'churn_risk',
          severity: client.churnRisk >= 80 ? 'critical' : 'high',
          title: `Riesgo de churn: ${client.companyName} (${client.churnRisk}%)`,
          message: `${client.churnReason ?? 'Multiples factores indican riesgo de perdida del cliente.'}`,
          recommendation: 'Intervenir inmediatamente. Llamar para entender problemas, ofrecer solucion y descuento de retencion si aplica.',
          priorityScore: client.churnRisk,
          estimatedValue: client.lifetimeValue,
        });
      }

      // Low satisfaction
      if (client.satisfactionScore && client.satisfactionScore <= 5) {
        alerts.push({
          clientId: client.id,
          advisorId: client.advisorId,
          type: 'satisfaction_low',
          severity: 'high',
          title: `Satisfaccion baja: ${client.companyName} (${client.satisfactionScore}/10)`,
          message: `${client.satisfactionNotes ?? 'Cliente reporto baja satisfaccion. Requiere atencion inmediata.'}`,
          recommendation: 'Agendar visita presencial, escuchar quejas, ofrecer solucion concreta con timeline.',
          priorityScore: 80,
          estimatedValue: client.lifetimeValue,
        });
      }
    }

    // Clear old open alerts and insert fresh ones
    await this.prisma.clientAlert.updateMany({
      where: { status: 'open' },
      data: { status: 'dismissed' },
    });

    if (alerts.length > 0) {
      await this.prisma.clientAlert.createMany({ data: alerts });
    }

    this.log.log(`Generated ${alerts.length} client alerts from ${clients.length} clients`);
    return {
      generated: alerts.length,
      byType: this._countBy(alerts, 'type'),
      bySeverity: this._countBy(alerts, 'severity'),
    };
  }

  async getClientAlerts(opts: { type?: string; severity?: string; status?: string }) {
    const where: any = {};
    if (opts.type) where.type = opts.type;
    if (opts.severity) where.severity = opts.severity;
    where.status = opts.status || 'open';

    const alerts = await this.prisma.clientAlert.findMany({
      where,
      orderBy: { priorityScore: 'desc' },
    });

    // Enrich with client info
    const clientIds = [...new Set(alerts.map((a) => a.clientId))];
    const clientsMap = new Map<string, any>();
    if (clientIds.length > 0) {
      const clients = await this.prisma.clientProfile.findMany({
        where: { id: { in: clientIds } },
        select: { id: true, companyName: true, contactName: true, zone: true, advisorId: true },
      });
      clients.forEach((c) => clientsMap.set(c.id, c));
    }

    return alerts.map((a) => ({
      ...a,
      typeLabel: ALERT_TYPE_LABELS[a.type] ?? a.type,
      client: clientsMap.get(a.clientId) ?? null,
    }));
  }

  async resolveClientAlert(id: string, actionTaken: string) {
    return this.prisma.clientAlert.update({
      where: { id },
      data: { status: 'resolved', resolvedAt: new Date(), actionTaken },
    });
  }

  async dismissClientAlert(id: string) {
    return this.prisma.clientAlert.update({
      where: { id },
      data: { status: 'dismissed' },
    });
  }

  // ─── Lifecycle Transitions ───────────────────────────────

  async transitionLifecycleStage(clientId: string, newStage: string, reason?: string) {
    const client = await this.prisma.clientProfile.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Client not found');

    const updateData: any = { lifecycleStage: newStage };

    if (newStage === 'REACTIVATED_CLIENT') {
      updateData.reactivatedAt = new Date();
    }
    if (newStage === 'INACTIVE_CLIENT') {
      updateData.churnRisk = Math.max(client.churnRisk, 50);
      updateData.churnReason = reason ?? 'Transicionado a inactivo manualmente';
    }
    if (newStage === 'EXPANSION_CLIENT') {
      updateData.expansionScore = Math.max(client.expansionScore, 80);
    }

    const updated = await this.prisma.clientProfile.update({
      where: { id: clientId },
      data: updateData,
    });

    this.log.log(`Client ${client.companyName}: ${client.lifecycleStage} → ${newStage}`);
    return {
      ...updated,
      previousStage: client.lifecycleStage,
      newStage,
      lifecycleLabel: LIFECYCLE_LABELS[newStage] ?? newStage,
    };
  }

  // ─── Expansion & Upsell ──────────────────────────────────

  /**
   * Recalculate expansion scores based on:
   * - Satisfaction score (high = higher expansion potential)
   * - Project age (6-18 months optimal for upsell)
   * - Multiple locations
   * - Revenue history
   * - Referral activity (engaged clients expand more)
   */
  async recalculateExpansionScores() {
    const clients = await this.prisma.clientProfile.findMany();
    const now = new Date();
    let updated = 0;

    for (const client of clients) {
      let score = 50; // base

      // Satisfaction bonus (+0-25)
      if (client.satisfactionScore) {
        score += Math.round((client.satisfactionScore / 10) * 25);
      }

      // Project age sweet spot (6-18 months = +15, <6 = +5, >18 = +10)
      const monthsSince = client.projectCompletedAt
        ? (now.getTime() - new Date(client.projectCompletedAt).getTime()) / (30 * 86400000)
        : (now.getTime() - new Date(client.becameClientAt).getTime()) / (30 * 86400000);
      if (monthsSince >= 6 && monthsSince <= 18) score += 15;
      else if (monthsSince < 6) score += 5;
      else score += 10;

      // Multiple locations (+15)
      if (client.hasMultipleLocations) score += 15;

      // High revenue history (+10)
      if (client.totalRevenue > 500000) score += 10;
      else if (client.totalRevenue > 200000) score += 5;

      // Active referrer (+10)
      if (client.referralCount > 0) score += 10;

      // Churn risk penalty (-20 if high)
      if (client.churnRisk >= 60) score -= 20;

      // Inactive penalty (-15)
      if (client.lifecycleStage === 'INACTIVE_CLIENT') score -= 15;

      score = Math.max(0, Math.min(100, score));

      // Determine expansion type
      let expansionType: string | null = null;
      if (client.hasMultipleLocations) expansionType = 'expansion';
      else if (monthsSince >= 12) expansionType = 'upgrade';
      else expansionType = 'cross_sell';

      if (score !== client.expansionScore || expansionType !== client.expansionType) {
        await this.prisma.clientProfile.update({
          where: { id: client.id },
          data: { expansionScore: score, expansionType },
        });
        updated++;
      }
    }

    this.log.log(`Recalculated expansion scores for ${updated}/${clients.length} clients`);
    return { updated, total: clients.length };
  }

  async getExpansionOpportunities() {
    const clients = await this.prisma.clientProfile.findMany({
      where: { expansionScore: { gte: 60 } },
      orderBy: { expansionScore: 'desc' },
      take: 50,
    });

    return clients.map((c) => ({
      id: c.id,
      companyName: c.companyName,
      contactName: c.contactName,
      zone: c.zone,
      expansionScore: c.expansionScore,
      expansionType: c.expansionType,
      hasMultipleLocations: c.hasMultipleLocations,
      lifetimeValue: c.lifetimeValue,
      avgProjectValue: c.avgProjectValue,
      satisfactionScore: c.satisfactionScore,
      lifecycleStage: c.lifecycleStage,
      estimatedExpansionValue: Math.round((c.avgProjectValue || 0) * 0.5),
    }));
  }

  // ─── Reactivation ────────────────────────────────────────

  /**
   * Find candidates for reactivation:
   * 1. INACTIVE_CLIENT profiles with 90+ days no contact
   * 2. CERRADO_PERDIDO leads that are 90-365 days old (not garbage)
   */
  async getReactivationCandidates() {
    const now = new Date();
    const d90 = new Date(now.getTime() - 90 * 86400000);
    const d365 = new Date(now.getTime() - 365 * 86400000);

    // Inactive clients
    const inactiveClients = await this.prisma.clientProfile.findMany({
      where: {
        OR: [
          { lifecycleStage: 'INACTIVE_CLIENT' },
          { lastContactedAt: { lt: d90 } },
        ],
      },
      orderBy: { lifetimeValue: 'desc' },
      take: 30,
    });

    // Lost deals eligible for reactivation
    const lostDeals = await this.prisma.lead.findMany({
      where: {
        status: 'CERRADO_PERDIDO',
        deletedAt: null,
        updatedAt: { gte: d365, lte: d90 },
      },
      include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { estimatedValue: 'desc' },
      take: 20,
    });

    // Future contacts
    const futureContacts = await this.prisma.lead.findMany({
      where: {
        status: 'CONTACTAR_FUTURO',
        deletedAt: null,
        updatedAt: { lte: d90 },
      },
      include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { estimatedValue: 'desc' },
      take: 20,
    });

    return {
      inactiveClients: inactiveClients.map((c) => ({
        type: 'inactive_client' as const,
        id: c.id,
        companyName: c.companyName,
        contactName: c.contactName,
        contactPhone: c.contactPhone,
        zone: c.zone,
        lifetimeValue: c.lifetimeValue,
        daysSinceContact: c.lastContactedAt
          ? Math.floor((now.getTime() - new Date(c.lastContactedAt).getTime()) / 86400000)
          : null,
        reason: 'Cliente inactivo con historial de compra',
      })),
      lostDeals: lostDeals.map((l) => ({
        type: 'lost_deal' as const,
        id: l.id,
        companyName: l.companyName,
        contactName: l.contactName,
        contactPhone: l.contactPhone,
        zone: l.zone,
        estimatedValue: l.estimatedValue,
        daysSinceLost: Math.floor((now.getTime() - new Date(l.updatedAt).getTime()) / 86400000),
        advisor: l.assignedTo ? `${l.assignedTo.firstName} ${l.assignedTo.lastName}` : null,
        reason: 'Deal perdido en ventana de reactivacion (90-365 dias)',
      })),
      futureContacts: futureContacts.map((l) => ({
        type: 'future_contact' as const,
        id: l.id,
        companyName: l.companyName,
        contactName: l.contactName,
        contactPhone: l.contactPhone,
        zone: l.zone,
        estimatedValue: l.estimatedValue,
        daysSinceMarked: Math.floor((now.getTime() - new Date(l.updatedAt).getTime()) / 86400000),
        advisor: l.assignedTo ? `${l.assignedTo.firstName} ${l.assignedTo.lastName}` : null,
        reason: 'Marcado como contactar en futuro, ya paso tiempo suficiente',
      })),
      totalCandidates: inactiveClients.length + lostDeals.length + futureContacts.length,
    };
  }

  async reactivateClient(clientId: string) {
    const client = await this.prisma.clientProfile.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Client not found');

    const updated = await this.prisma.clientProfile.update({
      where: { id: clientId },
      data: {
        lifecycleStage: 'REACTIVATED_CLIENT',
        reactivatedAt: new Date(),
        churnRisk: Math.max(0, client.churnRisk - 30),
      },
    });

    // Generate a reactivation step
    await this.prisma.postSaleStep.create({
      data: {
        clientId,
        stepType: 'reactivation',
        channel: 'call',
        dayOffset: 0,
        subject: 'Reactivacion de Cliente',
        messageBody: `Llamar a ${client.contactName} de ${client.companyName} para reactivacion. Ofrecer revision gratuita de sistema, explorar necesidades actuales, y proponer mantenimiento o ampliacion.`,
        scheduledAt: new Date(),
        status: 'pending',
      },
    });

    this.log.log(`Client reactivated: ${client.companyName}`);
    return { ...updated, lifecycleLabel: 'Cliente Reactivado' };
  }

  // ─── Dashboard & Analytics ───────────────────────────────

  async getLifecycleDashboard() {
    const [
      totalClients,
      byStage,
      byZone,
      bySystemStatus,
      recentClients,
      alerts,
      referralStats,
    ] = await Promise.all([
      this.prisma.clientProfile.count(),
      this.prisma.clientProfile.groupBy({
        by: ['lifecycleStage'],
        _count: true,
        _sum: { lifetimeValue: true },
      }),
      this.prisma.clientProfile.groupBy({
        by: ['zone'],
        _count: true,
        _sum: { lifetimeValue: true, totalRevenue: true },
      }),
      this.prisma.clientProfile.groupBy({
        by: ['systemStatus'],
        _count: true,
      }),
      this.prisma.clientProfile.findMany({
        orderBy: { becameClientAt: 'desc' },
        take: 10,
        select: {
          id: true, companyName: true, contactName: true, zone: true,
          lifecycleStage: true, lifetimeValue: true, becameClientAt: true,
          expansionScore: true, churnRisk: true, satisfactionScore: true,
        },
      }),
      this.prisma.clientAlert.groupBy({
        by: ['type', 'severity'],
        where: { status: 'open' },
        _count: true,
      }),
      this.prisma.referral.groupBy({
        by: ['status'],
        _count: true,
        _sum: { revenue: true },
      }),
    ]);

    // Aggregate KPIs
    const allClients = await this.prisma.clientProfile.findMany({
      select: {
        lifetimeValue: true, totalRevenue: true, satisfactionScore: true,
        expansionScore: true, churnRisk: true, referralCount: true,
        referralRevenue: true,
      },
    });

    const totalLTV = allClients.reduce((s, c) => s + c.lifetimeValue, 0);
    const totalRevenue = allClients.reduce((s, c) => s + c.totalRevenue, 0);
    const avgSatisfaction = allClients.filter((c) => c.satisfactionScore).length > 0
      ? allClients.filter((c) => c.satisfactionScore).reduce((s, c) => s + (c.satisfactionScore ?? 0), 0) /
        allClients.filter((c) => c.satisfactionScore).length
      : null;
    const avgExpansion = totalClients > 0
      ? Math.round(allClients.reduce((s, c) => s + c.expansionScore, 0) / totalClients)
      : 0;
    const highChurnCount = allClients.filter((c) => c.churnRisk >= 60).length;
    const totalReferrals = allClients.reduce((s, c) => s + c.referralCount, 0);
    const totalReferralRevenue = allClients.reduce((s, c) => s + c.referralRevenue, 0);

    return {
      kpis: {
        totalClients,
        totalLTV: Math.round(totalLTV),
        totalRevenue: Math.round(totalRevenue),
        avgLTV: totalClients > 0 ? Math.round(totalLTV / totalClients) : 0,
        avgSatisfaction: avgSatisfaction ? +avgSatisfaction.toFixed(1) : null,
        avgExpansionScore: avgExpansion,
        highChurnRisk: highChurnCount,
        totalReferrals,
        totalReferralRevenue: Math.round(totalReferralRevenue),
        openAlerts: alerts.reduce((s, a) => s + a._count, 0),
      },
      byStage: byStage.map((s) => ({
        stage: s.lifecycleStage,
        label: LIFECYCLE_LABELS[s.lifecycleStage] ?? s.lifecycleStage,
        count: s._count,
        ltv: Math.round(s._sum.lifetimeValue ?? 0),
      })),
      byZone: byZone.map((z) => ({
        zone: z.zone ?? 'Sin zona',
        count: z._count,
        ltv: Math.round(z._sum.lifetimeValue ?? 0),
        revenue: Math.round(z._sum.totalRevenue ?? 0),
      })),
      bySystemStatus: bySystemStatus.map((s) => ({
        status: s.systemStatus,
        label: SYSTEM_STATUS_LABELS[s.systemStatus] ?? s.systemStatus,
        count: s._count,
      })),
      recentClients,
      alertSummary: alerts.map((a) => ({
        type: a.type,
        severity: a.severity,
        count: a._count,
        typeLabel: ALERT_TYPE_LABELS[a.type] ?? a.type,
      })),
      referralSummary: referralStats.map((r) => ({
        status: r.status,
        count: r._count,
        revenue: Math.round(r._sum.revenue ?? 0),
      })),
    };
  }

  // ─── Revenue Expansion Metrics ───────────────────────────

  async getRevenueExpansionMetrics() {
    const clients = await this.prisma.clientProfile.findMany({
      select: {
        lifetimeValue: true, totalRevenue: true, projectCount: true,
        avgProjectValue: true, expansionScore: true, expansionType: true,
        referralCount: true, referralRevenue: true, lifecycleStage: true,
        zone: true, industry: true, becameClientAt: true,
      },
    });

    const total = clients.length;
    if (total === 0) {
      return { totalClients: 0, message: 'No clients yet' };
    }

    // Revenue metrics
    const totalRevenue = clients.reduce((s, c) => s + c.totalRevenue, 0);
    const totalLTV = clients.reduce((s, c) => s + c.lifetimeValue, 0);
    const avgLTV = totalLTV / total;
    const repeatClients = clients.filter((c) => c.projectCount > 1);
    const repeatRate = total > 0 ? (repeatClients.length / total * 100) : 0;
    const repeatRevenue = repeatClients.reduce((s, c) => s + c.totalRevenue, 0);

    // Expansion pipeline
    const expansionCandidates = clients.filter((c) => c.expansionScore >= 60);
    const expansionPipeline = expansionCandidates.reduce((s, c) => s + c.avgProjectValue * 0.5, 0);

    // Referral revenue
    const referralRevenue = clients.reduce((s, c) => s + c.referralRevenue, 0);
    const referralSources = clients.filter((c) => c.referralCount > 0).length;

    // By expansion type
    const byExpansionType = this._groupAndSum(
      clients.filter((c) => c.expansionType),
      'expansionType',
    );

    // By zone
    const byZone = this._groupAndSum(clients, 'zone');

    // By industry
    const byIndustry = this._groupAndSum(
      clients.filter((c) => c.industry),
      'industry',
    );

    // Revenue growth (clients by quarter)
    const quarters = this._clientsByQuarter(clients);

    return {
      totalClients: total,
      revenue: {
        total: Math.round(totalRevenue),
        ltv: Math.round(totalLTV),
        avgLTV: Math.round(avgLTV),
        avgProjectValue: Math.round(clients.reduce((s, c) => s + c.avgProjectValue, 0) / total),
      },
      expansion: {
        candidates: expansionCandidates.length,
        pipeline: Math.round(expansionPipeline),
        avgScore: Math.round(clients.reduce((s, c) => s + c.expansionScore, 0) / total),
        byType: byExpansionType,
      },
      retention: {
        repeatClients: repeatClients.length,
        repeatRate: +repeatRate.toFixed(1),
        repeatRevenue: Math.round(repeatRevenue),
      },
      referrals: {
        totalSources: referralSources,
        totalReferrals: clients.reduce((s, c) => s + c.referralCount, 0),
        revenue: Math.round(referralRevenue),
        avgRevenuePerReferral: referralSources > 0
          ? Math.round(referralRevenue / clients.reduce((s, c) => s + c.referralCount, 0) || 0)
          : 0,
      },
      byZone,
      byIndustry,
      quarters,
    };
  }

  // ─── Strategic Insights ──────────────────────────────────

  async getStrategicInsights() {
    const [dashboard, expansion, reactivation, churn] = await Promise.all([
      this.getLifecycleDashboard(),
      this.getExpansionOpportunities(),
      this.getReactivationCandidates(),
      this.getChurnAnalysis(),
    ]);

    const insights: Array<{
      category: string; priority: 'critical' | 'high' | 'medium' | 'low';
      title: string; description: string; impact: string;
      actions: string[];
    }> = [];

    // Churn risk insights
    if (churn.highRiskCount > 0) {
      insights.push({
        category: 'retention',
        priority: churn.highRiskCount >= 3 ? 'critical' : 'high',
        title: `${churn.highRiskCount} clientes en alto riesgo de churn`,
        description: `${churn.highRiskCount} clientes con riesgo >= 60% representan $${Math.round(churn.atRiskLTV).toLocaleString()} en LTV.`,
        impact: `Perdida potencial de $${Math.round(churn.atRiskLTV).toLocaleString()} en valor de vida del cliente.`,
        actions: [
          'Intervenir inmediatamente con los clientes de mayor LTV',
          'Agendar visitas presenciales para los top 3',
          'Ofrecer revision gratuita de sistema como pretexto de contacto',
        ],
      });
    }

    // Expansion insights
    if (expansion.length > 0) {
      const totalExpansionValue = expansion.reduce((s, e) => s + e.estimatedExpansionValue, 0);
      insights.push({
        category: 'expansion',
        priority: 'high',
        title: `${expansion.length} oportunidades de expansion detectadas`,
        description: `Pipeline de expansion estimado: $${Math.round(totalExpansionValue).toLocaleString()}.`,
        impact: `Revenue incremental potencial de $${Math.round(totalExpansionValue).toLocaleString()}.`,
        actions: [
          `Priorizar ${Math.min(5, expansion.length)} clientes con score > 80`,
          'Preparar propuestas de ampliacion/upgrade',
          'Usar satisfaccion como palanca en la conversacion',
        ],
      });
    }

    // Reactivation insights
    if (reactivation.totalCandidates > 0) {
      insights.push({
        category: 'reactivation',
        priority: 'medium',
        title: `${reactivation.totalCandidates} candidatos de reactivacion`,
        description: `${reactivation.inactiveClients.length} clientes inactivos, ${reactivation.lostDeals.length} deals perdidos, ${reactivation.futureContacts.length} contactos futuros.`,
        impact: 'Recuperar relaciones existentes es 5x mas barato que adquirir nuevos clientes.',
        actions: [
          'Lanzar campana de reactivacion con clientes inactivos de mayor LTV',
          'Revisar deals perdidos > 90 dias — condiciones pudieron cambiar',
          'Contactar leads marcados como futuro que ya cumplieron plazo',
        ],
      });
    }

    // Referral insights
    const referralSourceRate = dashboard.kpis.totalClients > 0
      ? (dashboard.kpis.totalReferrals / dashboard.kpis.totalClients * 100)
      : 0;
    if (referralSourceRate < 20 && dashboard.kpis.totalClients >= 5) {
      insights.push({
        category: 'referrals',
        priority: 'medium',
        title: 'Programa de referidos subutilizado',
        description: `Solo ${referralSourceRate.toFixed(0)}% de clientes han generado referidos. Meta: 30%+.`,
        impact: 'Referidos convierten 3x mejor y tienen ticket promedio 20% mayor.',
        actions: [
          'Implementar programa formal de referidos con incentivos',
          'Pedir referidos a clientes con satisfaccion >= 8',
          'Automatizar solicitud de referidos en step de dia 180',
        ],
      });
    }

    // Satisfaction insights
    if (dashboard.kpis.avgSatisfaction && dashboard.kpis.avgSatisfaction < 7) {
      insights.push({
        category: 'satisfaction',
        priority: 'critical',
        title: `Satisfaccion promedio baja: ${dashboard.kpis.avgSatisfaction}/10`,
        description: 'La satisfaccion promedio esta por debajo del objetivo de 8/10.',
        impact: 'Baja satisfaccion impacta expansion, referidos, y genera churn.',
        actions: [
          'Encuesta NPS a todos los clientes esta semana',
          'Identificar y resolver quejas mas comunes',
          'Implementar proceso de seguimiento post-instalacion mas riguroso',
        ],
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      totalInsights: insights.length,
      insights: insights.sort((a, b) => {
        const p = { critical: 0, high: 1, medium: 2, low: 3 };
        return (p[a.priority] ?? 3) - (p[b.priority] ?? 3);
      }),
      summary: {
        totalClients: dashboard.kpis.totalClients,
        totalLTV: dashboard.kpis.totalLTV,
        avgSatisfaction: dashboard.kpis.avgSatisfaction,
        expansionOpportunities: expansion.length,
        reactivationCandidates: reactivation.totalCandidates,
        highChurnRisk: dashboard.kpis.highChurnRisk,
        referralRate: +referralSourceRate.toFixed(1),
      },
    };
  }

  // ─── Churn Analysis ──────────────────────────────────────

  async getChurnAnalysis() {
    const clients = await this.prisma.clientProfile.findMany({
      select: {
        id: true, companyName: true, contactName: true, zone: true,
        churnRisk: true, churnReason: true, lifetimeValue: true,
        lastContactedAt: true, satisfactionScore: true, lifecycleStage: true,
        advisorId: true,
      },
      orderBy: { churnRisk: 'desc' },
    });

    const highRisk = clients.filter((c) => c.churnRisk >= 60);
    const mediumRisk = clients.filter((c) => c.churnRisk >= 30 && c.churnRisk < 60);

    return {
      totalClients: clients.length,
      highRiskCount: highRisk.length,
      mediumRiskCount: mediumRisk.length,
      atRiskLTV: highRisk.reduce((s, c) => s + c.lifetimeValue, 0),
      avgChurnRisk: clients.length > 0
        ? Math.round(clients.reduce((s, c) => s + c.churnRisk, 0) / clients.length)
        : 0,
      highRiskClients: highRisk.slice(0, 20).map((c) => ({
        ...c,
        daysSinceContact: c.lastContactedAt
          ? Math.floor((Date.now() - new Date(c.lastContactedAt).getTime()) / 86400000)
          : null,
      })),
      riskDistribution: [
        { range: '0-20', label: 'Bajo', count: clients.filter((c) => c.churnRisk < 20).length },
        { range: '20-40', label: 'Moderado', count: clients.filter((c) => c.churnRisk >= 20 && c.churnRisk < 40).length },
        { range: '40-60', label: 'Medio', count: clients.filter((c) => c.churnRisk >= 40 && c.churnRisk < 60).length },
        { range: '60-80', label: 'Alto', count: clients.filter((c) => c.churnRisk >= 60 && c.churnRisk < 80).length },
        { range: '80-100', label: 'Critico', count: clients.filter((c) => c.churnRisk >= 80).length },
      ],
    };
  }

  // ─── Referral ROI ────────────────────────────────────────

  async getReferralROI() {
    const referrals = await this.prisma.referral.findMany({
      include: { referrer: { select: { companyName: true, contactName: true, zone: true } } },
    });

    const total = referrals.length;
    const converted = referrals.filter((r) => r.status === 'CONVERTED');
    const totalRevenue = converted.reduce((s, r) => s + (r.revenue ?? 0), 0);

    return {
      totalReferrals: total,
      converted: converted.length,
      conversionRate: total > 0 ? +((converted.length / total) * 100).toFixed(1) : 0,
      totalRevenue: Math.round(totalRevenue),
      avgRevenuePerReferral: converted.length > 0 ? Math.round(totalRevenue / converted.length) : 0,
      byStatus: [
        { status: 'REQUESTED', count: referrals.filter((r) => r.status === 'REQUESTED').length },
        { status: 'RECEIVED', count: referrals.filter((r) => r.status === 'RECEIVED').length },
        { status: 'CONVERTED', count: converted.length },
        { status: 'EXPIRED', count: referrals.filter((r) => r.status === 'EXPIRED').length },
        { status: 'DECLINED', count: referrals.filter((r) => r.status === 'DECLINED').length },
      ],
      topReferrers: this._topReferrers(referrals),
    };
  }

  // ─── Private Helpers ─────────────────────────────────────

  private _calculateSequenceProgress(steps: any[]) {
    if (steps.length === 0) return { total: 0, completed: 0, pending: 0, pct: 0 };
    const completed = steps.filter((s) => ['sent', 'delivered', 'opened', 'replied'].includes(s.status)).length;
    const pending = steps.filter((s) => s.status === 'pending').length;
    return {
      total: steps.length,
      completed,
      pending,
      pct: Math.round((completed / steps.length) * 100),
    };
  }

  private _countBy(arr: any[], key: string) {
    const counts: Record<string, number> = {};
    arr.forEach((item) => {
      const k = item[key];
      counts[k] = (counts[k] || 0) + 1;
    });
    return Object.entries(counts).map(([k, v]) => ({ [key]: k, count: v }));
  }

  private _groupAndSum(clients: any[], key: string) {
    const groups: Record<string, { count: number; ltv: number; revenue: number }> = {};
    clients.forEach((c) => {
      const k = c[key] ?? 'N/A';
      if (!groups[k]) groups[k] = { count: 0, ltv: 0, revenue: 0 };
      groups[k].count++;
      groups[k].ltv += c.lifetimeValue ?? 0;
      groups[k].revenue += c.totalRevenue ?? 0;
    });
    return Object.entries(groups)
      .map(([k, v]) => ({ [key]: k, ...v, ltv: Math.round(v.ltv), revenue: Math.round(v.revenue) }))
      .sort((a, b) => b.ltv - a.ltv);
  }

  private _clientsByQuarter(clients: any[]) {
    const quarters: Record<string, { count: number; revenue: number }> = {};
    clients.forEach((c) => {
      const d = new Date(c.becameClientAt);
      const q = `${d.getFullYear()}-Q${Math.ceil((d.getMonth() + 1) / 3)}`;
      if (!quarters[q]) quarters[q] = { count: 0, revenue: 0 };
      quarters[q].count++;
      quarters[q].revenue += c.totalRevenue ?? 0;
    });
    return Object.entries(quarters)
      .map(([q, v]) => ({ quarter: q, ...v, revenue: Math.round(v.revenue) }))
      .sort((a, b) => a.quarter.localeCompare(b.quarter));
  }

  private _topReferrers(referrals: any[]) {
    const map: Record<string, { name: string; company: string; count: number; revenue: number; converted: number }> = {};
    referrals.forEach((r) => {
      const id = r.referrerId;
      if (!map[id]) {
        map[id] = {
          name: r.referrer?.contactName ?? 'N/A',
          company: r.referrer?.companyName ?? 'N/A',
          count: 0, revenue: 0, converted: 0,
        };
      }
      map[id].count++;
      if (r.status === 'CONVERTED') {
        map[id].converted++;
        map[id].revenue += r.revenue ?? 0;
      }
    });
    return Object.entries(map)
      .map(([id, v]) => ({ referrerId: id, ...v, revenue: Math.round(v.revenue) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }
}
