import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

type Channel = 'whatsapp' | 'sms' | 'email' | 'phone';
type MessageStatus = 'draft' | 'approved' | 'queued' | 'sent' | 'delivered' | 'failed';

export interface RenderedMessage {
  channel: string;
  subject?: string;
  body: string;
  recipient: { name: string; phone?: string; email?: string };
  templateKey: string;
  templateName: string;
  variables: Record<string, string>;
}

export interface OutreachPackage {
  lead: {
    id: string;
    companyName: string;
    contactName: string;
    contactPhone?: string;
    contactEmail?: string;
    status: string;
    zone: string;
    estimatedValue?: number;
    lastContactedAt?: Date;
  };
  advisor: { id: string; name: string; email: string } | null;
  channel: string;
  message: RenderedMessage;
  recommendedTiming: string;
  preparedAt: string;
}

@Injectable()
export class MultiChannelService {
  private readonly logger = new Logger(MultiChannelService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Templates ────────────────────────────────────────────

  async getTemplatesByChannel(channel?: string) {
    const where: any = { isActive: true };
    if (channel) where.channel = channel;

    return this.prisma.messageTemplate.findMany({
      where,
      orderBy: [{ performanceScore: 'desc' }, { timesSent: 'desc' }],
    });
  }

  async getAllTemplatesGrouped() {
    const templates = await this.prisma.messageTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ performanceScore: 'desc' }],
    });

    const grouped: Record<string, typeof templates> = {};
    for (const t of templates) {
      if (!grouped[t.channel]) grouped[t.channel] = [];
      grouped[t.channel].push(t);
    }
    return grouped;
  }

  // ─── Render ───────────────────────────────────────────────

  async renderTemplate(templateKey: string, leadId: string): Promise<RenderedMessage> {
    const template = await this.prisma.messageTemplate.findUnique({
      where: { key: templateKey },
    });
    if (!template) throw new NotFoundException(`Template "${templateKey}" not found`);

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!lead) throw new NotFoundException(`Lead "${leadId}" not found`);

    const now = new Date();
    const daysSinceContact = lead.lastContactedAt
      ? Math.floor((now.getTime() - new Date(lead.lastContactedAt).getTime()) / 86400000)
      : null;

    const vars: Record<string, string> = {
      contactName: lead.contactName || '',
      companyName: lead.companyName || '',
      advisorName: lead.assignedTo
        ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`
        : 'Tu asesor',
      estimatedValue: lead.estimatedValue
        ? `$${Number(lead.estimatedValue).toLocaleString('es-MX')}`
        : '',
      zone: lead.zone || '',
      city: lead.city || '',
      daysSinceContact: daysSinceContact !== null ? String(daysSinceContact) : 'N/A',
      stage: lead.status || '',
    };

    // Replace {{variable}} placeholders
    let body = template.body;
    let subject = template.subject || undefined;
    for (const [key, value] of Object.entries(vars)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      body = body.replace(regex, value);
      if (subject) subject = subject.replace(regex, value);
    }

    return {
      channel: template.channel,
      subject,
      body,
      recipient: {
        name: lead.contactName,
        phone: lead.contactPhone || undefined,
        email: lead.contactEmail || undefined,
      },
      templateKey: template.key,
      templateName: template.name,
      variables: vars,
    };
  }

  // ─── Prepare outreach ────────────────────────────────────

  async prepareOutreach(
    leadId: string,
    channel: Channel,
    templateKey?: string,
  ): Promise<OutreachPackage> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!lead) throw new NotFoundException(`Lead "${leadId}" not found`);

    // Auto-select template if none provided
    let resolvedKey = templateKey;
    if (!resolvedKey) {
      const best = await this.findBestTemplate(lead.status, channel);
      if (best) resolvedKey = best.key;
    }
    if (!resolvedKey) {
      throw new NotFoundException(
        `No template found for channel "${channel}" and status "${lead.status}"`,
      );
    }

    const message = await this.renderTemplate(resolvedKey, leadId);

    const hour = new Date().getHours();
    let timing = 'Ahora es buen momento';
    if (hour < 9) timing = 'Esperar hasta las 9:00 AM';
    else if (hour > 18) timing = 'Mejor enviar manana por la manana';
    else if (hour >= 13 && hour <= 14) timing = 'Hora de comida, considerar esperar';

    return {
      lead: {
        id: lead.id,
        companyName: lead.companyName,
        contactName: lead.contactName,
        contactPhone: lead.contactPhone || undefined,
        contactEmail: lead.contactEmail || undefined,
        status: lead.status,
        zone: lead.zone,
        estimatedValue: lead.estimatedValue ? Number(lead.estimatedValue) : undefined,
        lastContactedAt: lead.lastContactedAt || undefined,
      },
      advisor: lead.assignedTo
        ? {
            id: lead.assignedTo.id,
            name: `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`,
            email: lead.assignedTo.email,
          }
        : null,
      channel,
      message,
      recommendedTiming: timing,
      preparedAt: new Date().toISOString(),
    };
  }

  async prepareBulkOutreach(
    leadIds: string[],
    channel: Channel,
    templateKey?: string,
  ) {
    const results: { leadId: string; success: boolean; package?: OutreachPackage; error?: string }[] = [];

    for (const leadId of leadIds) {
      try {
        const pkg = await this.prepareOutreach(leadId, channel, templateKey);
        results.push({ leadId, success: true, package: pkg });
      } catch (err: any) {
        results.push({ leadId, success: false, error: err.message });
      }
    }

    return {
      total: leadIds.length,
      success: results.filter((r: any) => r.success).length,
      failed: results.filter((r: any) => !r.success).length,
      results,
    };
  }

  // ─── Log communication ───────────────────────────────────

  async logCommunication(data: {
    leadId: string;
    channel: string;
    messageBody: string;
    templateKey?: string;
    advisorId: string;
  }) {
    // Find or create a sequence for this lead
    let sequence = await this.prisma.followUpSequence.findFirst({
      where: { leadId: data.leadId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });

    if (!sequence) {
      const lead = await this.prisma.lead.findUnique({ where: { id: data.leadId } });
      sequence = await this.prisma.followUpSequence.create({
        data: {
          leadId: data.leadId,
          advisorId: data.advisorId,
          trigger: 'manual',
          status: 'active',
          leadName: lead?.contactName,
          companyName: lead?.companyName,
          zone: lead?.zone,
          estimatedValue: lead?.estimatedValue ? Number(lead.estimatedValue) : undefined,
          leadStatus: lead?.status,
        },
      });
    }

    // Count existing steps to determine next step number
    const stepCount = await this.prisma.followUpStep.count({
      where: { sequenceId: sequence.id },
    });

    // Create the follow-up step
    const step = await this.prisma.followUpStep.create({
      data: {
        sequenceId: sequence.id,
        stepNumber: stepCount + 1,
        channel: data.channel,
        messageBody: data.messageBody,
        templateKey: data.templateKey,
        status: 'sent',
        sentAt: new Date(),
      },
    });

    // Update lead.lastContactedAt
    await this.prisma.lead.update({
      where: { id: data.leadId },
      data: { lastContactedAt: new Date() },
    });

    // Update template stats
    if (data.templateKey) {
      await this.prisma.messageTemplate.updateMany({
        where: { key: data.templateKey },
        data: { timesSent: { increment: 1 } },
      });
    }

    this.logger.log(
      `Communication logged: lead=${data.leadId}, channel=${data.channel}, step=${step.id}`,
    );

    return { stepId: step.id, sequenceId: sequence.id, status: 'sent', sentAt: step.sentAt };
  }

  // ─── History ─────────────────────────────────────────────

  async getCommunicationHistory(leadId: string) {
    const sequences = await this.prisma.followUpSequence.findMany({
      where: { leadId },
      include: {
        steps: { orderBy: { stepNumber: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const allSteps = sequences.flatMap((seq) =>
      seq.steps.map((step: any) => ({
        ...step,
        sequenceId: seq.id,
        trigger: seq.trigger,
      })),
    );

    return {
      leadId,
      totalSequences: sequences.length,
      totalMessages: allSteps.length,
      sequences,
      timeline: allSteps.sort(
        (a, b) => new Date(b.sentAt || b.scheduledAt || 0).getTime() -
                  new Date(a.sentAt || a.scheduledAt || 0).getTime(),
      ),
    };
  }

  // ─── Stats ───────────────────────────────────────────────

  async getChannelStats() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);

    // Templates per channel
    const templates = await this.prisma.messageTemplate.findMany({
      where: { isActive: true },
    });

    const channelTemplates: Record<string, { count: number; avgPerformance: number; topTemplate?: string }> = {};
    for (const t of templates) {
      if (!channelTemplates[t.channel]) {
        channelTemplates[t.channel] = { count: 0, avgPerformance: 0 };
      }
      channelTemplates[t.channel].count++;
      channelTemplates[t.channel].avgPerformance += t.performanceScore;
    }
    for (const ch of Object.keys(channelTemplates)) {
      const entry = channelTemplates[ch];
      entry.avgPerformance = Math.round(entry.avgPerformance / entry.count);
      const best = templates
        .filter((t: any) => t.channel === ch)
        .sort((a: any, b: any) => b.performanceScore - a.performanceScore)[0];
      if (best) entry.topTemplate = best.name;
    }

    // Messages sent today and this week
    const sentToday = await this.prisma.followUpStep.count({
      where: { status: 'sent', sentAt: { gte: todayStart } },
    });
    const sentThisWeek = await this.prisma.followUpStep.count({
      where: { status: 'sent', sentAt: { gte: weekStart } },
    });

    // Per-channel sent counts
    const channelSteps = await this.prisma.followUpStep.groupBy({
      by: ['channel'],
      where: { status: { in: ['sent', 'delivered', 'opened', 'replied'] } },
      _count: true,
    });

    // Contacts available per channel
    const leadsWithPhone = await this.prisma.lead.count({
      where: { deletedAt: null, isHistorical: false, contactPhone: { not: null }, status: { notIn: ['CERRADO_PERDIDO', 'LEAD_BASURA'] } },
    });
    const leadsWithEmail = await this.prisma.lead.count({
      where: { deletedAt: null, isHistorical: false, contactEmail: { not: null }, status: { notIn: ['CERRADO_PERDIDO', 'LEAD_BASURA'] } },
    });
    const totalActiveLeads = await this.prisma.lead.count({
      where: { deletedAt: null, isHistorical: false, status: { notIn: ['CERRADO_PERDIDO', 'LEAD_BASURA'] } },
    });

    // Template performance
    const topTemplates = templates
      .filter((t: any) => t.timesSent > 0)
      .sort((a: any, b: any) => b.performanceScore - a.performanceScore)
      .slice(0, 10)
      .map((t: any) => ({
        key: t.key,
        name: t.name,
        channel: t.channel,
        timesSent: t.timesSent,
        openRate: t.openRate,
        replyRate: t.replyRate,
        performanceScore: t.performanceScore,
      }));

    return {
      sentToday,
      sentThisWeek,
      channelBreakdown: channelSteps.map((c: any) => ({ channel: c.channel, count: c._count })),
      channelTemplates,
      contactsAvailable: {
        whatsapp: leadsWithPhone,
        sms: leadsWithPhone,
        email: leadsWithEmail,
        phone: leadsWithPhone,
        total: totalActiveLeads,
      },
      topTemplates,
    };
  }

  // ─── Recommend channel ────────────────────────────────────

  async getRecommendedChannel(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!lead) throw new NotFoundException(`Lead "${leadId}" not found`);

    // Get communication history
    const history = await this.prisma.followUpStep.findMany({
      where: {
        sequence: { leadId },
        status: { in: ['sent', 'delivered', 'opened', 'replied'] },
      },
      orderBy: { sentAt: 'desc' },
      take: 10,
    });

    // Analyze what channels have been used
    const channelUsage: Record<string, number> = {};
    const channelReplied: Record<string, number> = {};
    for (const step of history) {
      channelUsage[step.channel] = (channelUsage[step.channel] || 0) + 1;
      if (step.status === 'replied') {
        channelReplied[step.channel] = (channelReplied[step.channel] || 0) + 1;
      }
    }

    // Score each channel
    const channels: Channel[] = ['whatsapp', 'sms', 'email', 'phone'];
    const scored = channels.map((ch: any) => {
      let score = 50;
      let reasons: string[] = [];

      // Has contact info?
      if ((ch === 'whatsapp' || ch === 'sms' || ch === 'phone') && !lead.contactPhone) {
        return { channel: ch, score: 0, reason: 'Sin telefono de contacto', available: false };
      }
      if (ch === 'email' && !lead.contactEmail) {
        return { channel: ch, score: 0, reason: 'Sin email de contacto', available: false };
      }

      // Previous reply on this channel = big boost
      if (channelReplied[ch]) {
        score += 30;
        reasons.push('Ha respondido por este canal antes');
      }

      // Not overused
      if ((channelUsage[ch] || 0) > 3 && !channelReplied[ch]) {
        score -= 20;
        reasons.push('Canal ya utilizado sin respuesta');
      }

      // Channel fit by status
      const earlyStages = ['PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR'];
      const midStages = ['EN_PROSPECCION', 'AGENDAR_CITA', 'ESPERANDO_COTIZACION'];
      const lateStages = ['COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO'];

      if (earlyStages.includes(lead.status)) {
        if (ch === 'whatsapp') { score += 15; reasons.push('WhatsApp ideal para primer contacto'); }
        if (ch === 'phone') { score += 10; reasons.push('Llamada efectiva para primer acercamiento'); }
      }
      if (midStages.includes(lead.status)) {
        if (ch === 'email') { score += 15; reasons.push('Email ideal para enviar informacion'); }
        if (ch === 'whatsapp') { score += 10; reasons.push('WhatsApp para seguimiento rapido'); }
      }
      if (lateStages.includes(lead.status)) {
        if (ch === 'phone') { score += 20; reasons.push('Llamada clave para cierre'); }
        if (ch === 'email') { score += 10; reasons.push('Email para documentos de cierre'); }
      }

      return {
        channel: ch,
        score,
        reason: reasons.join('. ') || 'Canal disponible',
        available: true,
      };
    });

    scored.sort((a: any, b: any) => b.score - a.score);
    const recommended = scored[0];

    // Find best template for recommended channel
    const bestTemplate = await this.findBestTemplate(lead.status, recommended.channel as Channel);

    return {
      leadId,
      leadName: lead.contactName,
      companyName: lead.companyName,
      status: lead.status,
      recommended: {
        channel: recommended.channel,
        score: recommended.score,
        reason: recommended.reason,
      },
      allChannels: scored,
      bestTemplate: bestTemplate
        ? { key: bestTemplate.key, name: bestTemplate.name, performanceScore: bestTemplate.performanceScore }
        : null,
      communicationHistory: {
        totalMessages: history.length,
        channelUsage,
        channelReplied,
      },
    };
  }

  // ─── Private helpers ──────────────────────────────────────

  private async findBestTemplate(leadStatus: string, channel: Channel) {
    // Map lead status to trigger
    const triggerMap: Record<string, string> = {
      PENDIENTE_CONTACTAR: 'new_lead',
      INTENTANDO_CONTACTAR: 'no_response',
      EN_PROSPECCION: 'new_lead',
      AGENDAR_CITA: 'no_response',
      ESPERANDO_COTIZACION: 'stalled_deal',
      COTIZACION_ENTREGADA: 'stalled_deal',
      ESPERANDO_CONTRATO: 'stalled_deal',
      PENDIENTE_PAGO: 'stalled_deal',
      CONTACTAR_FUTURO: 'reactivation',
      CERRADO_GANADO: 'post_sale',
    };

    const trigger = triggerMap[leadStatus] || 'new_lead';

    // Try exact match first
    let template = await this.prisma.messageTemplate.findFirst({
      where: { channel, trigger, isActive: true },
      orderBy: { performanceScore: 'desc' },
    });

    // Fallback: any template for this channel
    if (!template) {
      template = await this.prisma.messageTemplate.findFirst({
        where: { channel, isActive: true },
        orderBy: { performanceScore: 'desc' },
      });
    }

    return template;
  }
}
