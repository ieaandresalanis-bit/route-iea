import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ZohoApiService } from '../zoho-api/zoho-api.service';
import { SmsMasivosService } from '../sms-masivos/sms-masivos.service';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

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

const CLOSING_STAGES = [
  'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO',
  'PENDIENTE_PAGO',
];

const NON_CLOSING_STAGES = [
  'PENDIENTE_CONTACTAR',
  'INTENTANDO_CONTACTAR',
  'EN_PROSPECCION',
  'AGENDAR_CITA',
  'ESPERANDO_COTIZACION',
];

const STAGE_LABELS: Record<string, string> = {
  PENDIENTE_CONTACTAR: 'Pendiente Contactar',
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
  INACTIVO: 'Inactivo',
};

/** Local stage name → Zoho CRM stage name */
const STAGE_TO_ZOHO: Record<string, string> = {
  PENDIENTE_CONTACTAR: 'Pendiente de Contactar',
  INTENTANDO_CONTACTAR: 'Intentando Contactar',
  EN_PROSPECCION: 'En Prospeccion',
  AGENDAR_CITA: 'Agendar Cita',
  ESPERANDO_COTIZACION: 'Esperando Cotizacion',
  COTIZACION_ENTREGADA: 'Cotizacion Entregada',
  ESPERANDO_CONTRATO: 'Esperando Contrato y Factura',
  PENDIENTE_PAGO: 'Pendiente de Pago',
  CERRADO_GANADO: 'Cerrado Ganado',
  CERRADO_PERDIDO: 'Cerrado Perdido',
};

const HIGH_VALUE_THRESHOLD = 500_000;

// ═══════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════

export interface InboxFilters {
  advisorId?: string;
  type?: 'lead' | 'deal' | 'all';
  filter?:
    | 'all'
    | 'no_contact_3d'
    | 'no_contact_7d'
    | 'no_contact_14d'
    | 'closing'
    | 'quotation_delivered'
    | 'pending_contact'
    | 'high_priority'
    | 'reminder_overdue';
  zone?: string;
  stage?: string;
  search?: string;
  minAmount?: number;
  maxAmount?: number;
  page?: number;
  limit?: number;
}

interface JwtUser {
  id: string;
  email: string;
  role: string;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function daysBetween(from: Date, to: Date): number {
  return Math.floor(
    (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24),
  );
}

function contactStatus(days: number): 'green' | 'yellow' | 'orange' | 'red' {
  if (days <= 2) return 'green';
  if (days <= 6) return 'yellow';
  if (days <= 13) return 'orange';
  return 'red';
}

function computePriorityScore(
  estimatedValue: number | null,
  status: string,
  daysSinceContact: number,
): number {
  let score = 0;

  // Value component (0-40)
  const val = Number(estimatedValue) || 0;
  if (val >= 1_000_000) score += 40;
  else if (val >= 500_000) score += 30;
  else if (val >= 200_000) score += 20;
  else if (val >= 50_000) score += 10;

  // Stage component (0-30)
  if (status === 'PENDIENTE_PAGO') score += 30;
  else if (status === 'ESPERANDO_CONTRATO') score += 28;
  else if (status === 'COTIZACION_ENTREGADA') score += 25;
  else if (status === 'ESPERANDO_COTIZACION') score += 15;
  else if (status === 'AGENDAR_CITA') score += 12;
  else if (status === 'EN_PROSPECCION') score += 8;
  else if (status === 'INTENTANDO_CONTACTAR') score += 5;
  else if (status === 'PENDIENTE_CONTACTAR') score += 3;

  // Days without contact component (0-30)
  if (daysSinceContact >= 14) score += 30;
  else if (daysSinceContact >= 7) score += 22;
  else if (daysSinceContact >= 3) score += 12;
  else if (daysSinceContact >= 1) score += 4;

  return score;
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

@Injectable()
export class LiveChatService {
  private readonly logger = new Logger(LiveChatService.name);

  constructor(
    private prisma: PrismaService,
    private zohoApi: ZohoApiService,
    private smsMasivos: SmsMasivosService,
  ) {}

  // ─────────────────────────────────────────────────────────
  // INBOX
  // ─────────────────────────────────────────────────────────

  async getInbox(user: JwtUser, filters: InboxFilters) {
    const now = new Date();
    const page = filters.page || 1;
    const limit = filters.limit || 25;
    const skip = (page - 1) * limit;

    // ── Build WHERE clause ─────────────────────────────────
    const where: any = {
      isHistorical: false,
      deletedAt: null,
    };

    // Advisor scoping
    if (filters.advisorId) {
      where.assignedToId = filters.advisorId;
    } else if (user.role === 'OPERATOR') {
      where.assignedToId = user.id;
    }
    // SUPERADMIN / OPERATIONS → show all (no advisor filter)

    // Type filter
    if (filters.type === 'deal') {
      where.status = { in: CLOSING_STAGES as any };
    } else if (filters.type === 'lead') {
      where.status = { in: NON_CLOSING_STAGES as any };
    } else {
      where.status = { in: ACTIVE_STAGES as any };
    }

    // Zone
    if (filters.zone) {
      where.zone = filters.zone;
    }

    // Stage override
    if (filters.stage) {
      where.status = filters.stage;
    }

    // Amount range
    if (filters.minAmount !== undefined || filters.maxAmount !== undefined) {
      where.estimatedValue = {};
      if (filters.minAmount !== undefined) where.estimatedValue.gte = filters.minAmount;
      if (filters.maxAmount !== undefined) where.estimatedValue.lte = filters.maxAmount;
    }

    // Search
    if (filters.search) {
      const term = filters.search;
      where.OR = [
        { companyName: { contains: term, mode: 'insensitive' } },
        { contactName: { contains: term, mode: 'insensitive' } },
        { contactEmail: { contains: term, mode: 'insensitive' } },
        { contactPhone: { contains: term } },
      ];
    }

    // Filter-specific conditions
    if (filters.filter === 'no_contact_3d') {
      const cutoff = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      where.OR = [
        { lastContactedAt: { lt: cutoff } },
        { lastContactedAt: null },
      ];
    } else if (filters.filter === 'no_contact_7d') {
      const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      where.OR = [
        { lastContactedAt: { lt: cutoff } },
        { lastContactedAt: null },
      ];
    } else if (filters.filter === 'no_contact_14d') {
      const cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      where.OR = [
        { lastContactedAt: { lt: cutoff } },
        { lastContactedAt: null },
      ];
    } else if (filters.filter === 'closing') {
      where.status = { in: CLOSING_STAGES as any };
    } else if (filters.filter === 'quotation_delivered') {
      where.status = 'COTIZACION_ENTREGADA';
    } else if (filters.filter === 'pending_contact') {
      where.status = 'PENDIENTE_CONTACTAR';
    } else if (filters.filter === 'high_priority') {
      where.OR = [
        { estimatedValue: { gte: HIGH_VALUE_THRESHOLD } },
        { status: { in: CLOSING_STAGES as any } },
      ];
    }

    // ── Fetch leads ────────────────────────────────────────
    let leads: any[];
    let total: number;

    if (filters.filter === 'reminder_overdue') {
      // Special case: join through reminders
      const overdueLeadIds = await this.prisma.reminder.findMany({
        where: {
          status: 'pending',
          dueDate: { lt: now },
          lead: { isHistorical: false, deletedAt: null },
        },
        select: { leadId: true },
        distinct: ['leadId'] as any,
      });
      const ids = Array.from(new Set(overdueLeadIds.map((r: any) => r.leadId)));

      if (ids.length === 0) {
        return {
          records: [],
          total: 0,
          filters: await this.buildFilterOptions(where),
        };
      }

      where.id = { in: ids };

      [leads, total] = await Promise.all([
        this.prisma.lead.findMany({
          where,
          include: {
            assignedTo: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
          orderBy: { updatedAt: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.lead.count({ where }),
      ]);
    } else {
      [leads, total] = await Promise.all([
        this.prisma.lead.findMany({
          where,
          include: {
            assignedTo: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
          orderBy: { updatedAt: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.lead.count({ where }),
      ]);
    }

    // ── Enrich each lead ───────────────────────────────────
    const leadIds = leads.map((l: any) => l.id);

    const [latestTimelines, reminderCounts, overdueReminderCounts, alertsList] =
      await Promise.all([
        this.getLatestTimelinesForLeads(leadIds),
        this.getPendingReminderCounts(leadIds),
        this.getOverdueReminderCounts(leadIds),
        this.getAlertsForLeads(leadIds),
      ]);

    const records = leads.map((lead: any) => {
      const lastContact = lead.lastContactedAt
        ? new Date(lead.lastContactedAt)
        : new Date(lead.createdAt);
      const daysSinceContact = daysBetween(lastContact, now);
      const daysInStage = daysBetween(new Date(lead.updatedAt), now);
      const priorityScore = computePriorityScore(
        lead.estimatedValue,
        lead.status,
        daysSinceContact,
      );
      const status = contactStatus(daysSinceContact);
      const timeline = latestTimelines.get(lead.id);
      const pending = reminderCounts.get(lead.id) || 0;
      const overdue = overdueReminderCounts.get(lead.id) || 0;
      const alerts = alertsList.get(lead.id) || [];

      const needsAttention =
        daysSinceContact >= 3 ||
        overdue > 0 ||
        (CLOSING_STAGES.includes(lead.status) && daysInStage >= 5) ||
        (lead.status === 'COTIZACION_ENTREGADA' && daysSinceContact >= 3);

      return {
        id: lead.id,
        companyName: lead.companyName,
        contactName: lead.contactName,
        contactPhone: lead.contactPhone,
        contactEmail: lead.contactEmail,
        status: lead.status,
        stageLabel: STAGE_LABELS[lead.status] || lead.status,
        zone: lead.zone,
        source: lead.source,
        industry: lead.industry,
        estimatedValue: lead.estimatedValue ? Number(lead.estimatedValue) : null,
        assignedTo: lead.assignedTo
          ? {
              id: lead.assignedTo.id,
              name: `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`,
              email: lead.assignedTo.email,
            }
          : null,
        daysSinceContact,
        daysInStage,
        priorityScore,
        contactStatus: status,
        lastChannel: timeline?.channel || null,
        lastContactedAt: lead.lastContactedAt,
        pendingReminders: pending,
        overdueReminders: overdue,
        alerts,
        needsAttention,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
      };
    });

    // Sort by priority score DESC
    records.sort((a: any, b: any) => b.priorityScore - a.priorityScore);

    // ── Filter options ─────────────────────────────────────
    const filterOptions = await this.buildFilterOptions(where);

    return {
      records,
      total,
      filters: filterOptions,
    };
  }

  // ─────────────────────────────────────────────────────────
  // PROFILE
  // ─────────────────────────────────────────────────────────

  async getProfile(leadId: string) {
    const now = new Date();

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    if (!lead) throw new NotFoundException(`Lead ${leadId} not found`);

    // Parallel fetches
    const [timeline, reminders, smsLogs, alerts] = await Promise.all([
      this.prisma.contactTimeline.findMany({
        where: { leadId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.reminder.findMany({
        where: { leadId },
        orderBy: { dueDate: 'asc' },
      }),
      this.prisma.smsLog.findMany({
        where: { leadId },
        orderBy: { sentAt: 'desc' },
        take: 20,
      }),
      this.prisma.salesAlert.findMany({
        where: { leadId, status: 'active' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Detection flags
    const lastContact = lead.lastContactedAt
      ? new Date(lead.lastContactedAt)
      : new Date(lead.createdAt);
    const noContactDays = daysBetween(lastContact, now);
    const noConversionDays = daysBetween(new Date(lead.createdAt), now);
    const daysInStage = daysBetween(new Date(lead.updatedAt), now);

    const lastNote = timeline.find(
      (t: any) => t.eventType === 'note',
    );
    const lastNoteDays = lastNote
      ? daysBetween(new Date(lastNote.createdAt), now)
      : null;

    const lastActivity = timeline.length > 0
      ? daysBetween(new Date(timeline[0].createdAt), now)
      : noContactDays;

    const pendingReminders = reminders.filter(
      (r: any) => r.status === 'pending',
    );
    const overdueReminders = pendingReminders.filter(
      (r: any) => new Date(r.dueDate) < now,
    );

    const quotationWithoutFollowup =
      lead.status === 'COTIZACION_ENTREGADA' && lastActivity >= 3;

    const dealStalled =
      CLOSING_STAGES.includes(lead.status) && lastActivity >= 5;

    const reminderOverdue = overdueReminders.length > 0;

    const lastNoteTooOld = lastNoteDays !== null ? lastNoteDays > 7 : true;

    const needsAttention =
      noContactDays >= 3 ||
      reminderOverdue ||
      quotationWithoutFollowup ||
      dealStalled;

    // Suggested next action
    const suggestion = this.computeSuggestion(
      lead,
      noContactDays,
      lastActivity,
      pendingReminders.length,
      timeline,
      smsLogs,
      daysInStage,
    );

    return {
      lead: {
        id: lead.id,
        companyName: lead.companyName,
        contactName: lead.contactName,
        contactEmail: lead.contactEmail,
        contactPhone: lead.contactPhone,
        status: lead.status,
        stageLabel: STAGE_LABELS[lead.status] || lead.status,
        source: lead.source,
        zone: lead.zone,
        industry: lead.industry,
        billRange: lead.billRange,
        estimatedValue: lead.estimatedValue ? Number(lead.estimatedValue) : null,
        financingType: lead.financingType,
        financialStage: lead.financialStage,
        financialNotes: lead.financialNotes,
        notes: lead.notes,
        zohoDealId: lead.zohoDealId,
        zohoLeadId: lead.zohoLeadId,
        zohoContactId: lead.zohoContactId,
        zohoAccountId: lead.zohoAccountId,
        lastContactedAt: lead.lastContactedAt,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
      },
      advisor: lead.assignedTo
        ? {
            id: lead.assignedTo.id,
            name: `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`,
            email: lead.assignedTo.email,
            role: lead.assignedTo.role,
          }
        : null,
      timeline,
      reminders,
      smsLogs,
      alerts,
      detection: {
        noContactDays,
        noConversionDays,
        quotationWithoutFollowup,
        dealStalled,
        reminderOverdue,
        lastNoteTooOld,
        needsAttention,
      },
      suggestion,
    };
  }

  // ─────────────────────────────────────────────────────────
  // CREATE NOTE
  // ─────────────────────────────────────────────────────────

  async createNote(userId: string, leadId: string, content: string) {
    const [lead, user] = await Promise.all([
      this.prisma.lead.findUnique({ where: { id: leadId } }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);

    if (!lead) throw new NotFoundException(`Lead ${leadId} not found`);

    const advisorName = user
      ? `${user.firstName} ${user.lastName}`
      : 'Sistema';

    // Create timeline entry
    const entry = await this.prisma.contactTimeline.create({
      data: {
        leadId,
        eventType: 'note',
        eventSource: 'manual',
        channel: 'note',
        content,
        advisorId: userId,
        advisorName,
        status: 'completed',
      },
    });

    // Update last contact
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { lastContactedAt: new Date() },
    });

    // Sync to Zoho if deal exists
    if (lead.zohoDealId) {
      try {
        await this.zohoApi.createNote(
          'Deals',
          lead.zohoDealId,
          'Nota desde CRM',
          content,
        );
        this.logger.log(`Note synced to Zoho deal ${lead.zohoDealId}`);
      } catch (err: any) {
        this.logger.warn(
          `Failed to sync note to Zoho: ${err.message}`,
        );
      }
    }

    return entry;
  }

  // ─────────────────────────────────────────────────────────
  // SEND SMS
  // ─────────────────────────────────────────────────────────

  async sendSms(
    userId: string,
    leadId: string,
    phone: string,
    message: string,
  ) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
    });
    if (!lead) throw new NotFoundException(`Lead ${leadId} not found`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true },
    });
    const advisorName = user
      ? `${user.firstName} ${user.lastName}`
      : 'Sistema';

    // Send via SMS provider
    let result: any;
    try {
      result = await this.smsMasivos.sendSms(phone, message, leadId, userId, advisorName);
    } catch (err: any) {
      this.logger.error(`SMS send failed: ${err.message}`);
      // Log the failure in timeline
      await this.prisma.contactTimeline.create({
        data: {
          leadId,
          eventType: 'sms',
          eventSource: 'manual',
          channel: 'sms',
          content: message,
          advisorId: userId,
          advisorName,
          status: 'failed',
          metadata: { error: err.message } as any,
        },
      });
      throw err;
    }

    // Update last contact
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { lastContactedAt: new Date() },
    });

    return { success: true, result };
  }

  // ─────────────────────────────────────────────────────────
  // CREATE REMINDER
  // ─────────────────────────────────────────────────────────

  async createReminder(
    userId: string,
    data: {
      leadId: string;
      title: string;
      description?: string;
      dueDate: string;
      priority?: string;
    },
  ) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: data.leadId },
    });
    if (!lead) throw new NotFoundException(`Lead ${data.leadId} not found`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true },
    });
    const advisorName = user
      ? `${user.firstName} ${user.lastName}`
      : 'Sistema';

    // Create reminder
    const reminder = await this.prisma.reminder.create({
      data: {
        leadId: data.leadId,
        advisorId: userId,
        advisorName,
        title: data.title,
        description: data.description || null,
        dueDate: new Date(data.dueDate),
        priority: data.priority || 'medium',
        status: 'pending',
      },
    });

    // Timeline entry
    await this.prisma.contactTimeline.create({
      data: {
        leadId: data.leadId,
        eventType: 'reminder',
        eventSource: 'manual',
        channel: 'system',
        content: `Recordatorio creado: ${data.title}`,
        advisorId: userId,
        advisorName,
        status: 'completed',
        metadata: {
          reminderId: reminder.id,
          dueDate: data.dueDate,
          priority: data.priority || 'medium',
        } as any,
      },
    });

    // Sync to Zoho if deal exists
    if (lead.zohoDealId) {
      try {
        const dueFormatted = new Date(data.dueDate)
          .toISOString()
          .split('T')[0];
        await this.zohoApi.createTask({
          Subject: data.title,
          Due_Date: dueFormatted,
          What_Id: { id: lead.zohoDealId },
          Description: data.description || '',
          Priority: (data.priority || 'medium') === 'high' ? 'High' : 'Normal',
          Status: 'Not Started',
        });
        this.logger.log(
          `Reminder synced to Zoho as task for deal ${lead.zohoDealId}`,
        );
      } catch (err: any) {
        this.logger.warn(
          `Failed to sync reminder to Zoho: ${err.message}`,
        );
      }
    }

    return reminder;
  }

  // ─────────────────────────────────────────────────────────
  // LOG WHATSAPP
  // ─────────────────────────────────────────────────────────

  async logWhatsApp(userId: string, leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
    });
    if (!lead) throw new NotFoundException(`Lead ${leadId} not found`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true },
    });
    const advisorName = user
      ? `${user.firstName} ${user.lastName}`
      : 'Sistema';

    const entry = await this.prisma.contactTimeline.create({
      data: {
        leadId,
        eventType: 'whatsapp',
        eventSource: 'manual',
        channel: 'whatsapp',
        content: 'Contacto por WhatsApp registrado',
        advisorId: userId,
        advisorName,
        status: 'completed',
      },
    });

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { lastContactedAt: new Date() },
    });

    return entry;
  }

  // ─────────────────────────────────────────────────────────
  // CHANGE STAGE
  // ─────────────────────────────────────────────────────────

  async changeStage(
    userId: string,
    leadId: string,
    newStage: string,
    notes?: string,
  ) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
    });
    if (!lead) throw new NotFoundException(`Lead ${leadId} not found`);

    const previousStage = lead.status;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true },
    });
    const advisorName = user
      ? `${user.firstName} ${user.lastName}`
      : 'Sistema';

    // Update lead status
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { status: newStage as any },
    });

    // Timeline entry
    await this.prisma.contactTimeline.create({
      data: {
        leadId,
        eventType: 'stage_change',
        eventSource: 'manual',
        channel: 'system',
        content: notes || `Etapa cambiada: ${STAGE_LABELS[previousStage] || previousStage} → ${STAGE_LABELS[newStage] || newStage}`,
        advisorId: userId,
        advisorName,
        status: 'completed',
        metadata: { previousStage, newStage } as any,
      },
    });

    // Create SalesTask for pipeline movement
    await this.prisma.salesTask.create({
      data: {
        advisorId: userId,
        leadId,
        type: 'stage_change',
        title: `Cambio de etapa: ${STAGE_LABELS[previousStage] || previousStage} → ${STAGE_LABELS[newStage] || newStage}`,
        description: notes || null,
        channel: 'system',
        dueDate: new Date(),
        priority: 'medium',
        priorityScore: 50,
        status: 'completed',
        completedAt: new Date(),
        pipelineMoved: true,
        previousStage,
        newStage,
      },
    });

    // Sync to Zoho
    if (lead.zohoDealId && STAGE_TO_ZOHO[newStage]) {
      try {
        await this.zohoApi.updateDealStage(
          lead.zohoDealId,
          STAGE_TO_ZOHO[newStage],
        );
        this.logger.log(
          `Stage synced to Zoho: ${STAGE_TO_ZOHO[newStage]} for deal ${lead.zohoDealId}`,
        );
      } catch (err: any) {
        this.logger.warn(
          `Failed to sync stage to Zoho: ${err.message}`,
        );
      }
    }

    return {
      leadId,
      previousStage,
      newStage,
      previousLabel: STAGE_LABELS[previousStage] || previousStage,
      newLabel: STAGE_LABELS[newStage] || newStage,
    };
  }

  // ─────────────────────────────────────────────────────────
  // COMPLETE REMINDER
  // ─────────────────────────────────────────────────────────

  async completeReminder(userId: string, reminderId: string) {
    const reminder = await this.prisma.reminder.findUnique({
      where: { id: reminderId },
    });
    if (!reminder)
      throw new NotFoundException(`Reminder ${reminderId} not found`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true },
    });
    const advisorName = user
      ? `${user.firstName} ${user.lastName}`
      : 'Sistema';

    const updated = await this.prisma.reminder.update({
      where: { id: reminderId },
      data: {
        status: 'completed',
        completedAt: new Date(),
      },
    });

    // Timeline entry
    await this.prisma.contactTimeline.create({
      data: {
        leadId: reminder.leadId,
        eventType: 'reminder_completed',
        eventSource: 'manual',
        channel: 'system',
        content: `Recordatorio completado: ${reminder.title}`,
        advisorId: userId,
        advisorName,
        status: 'completed',
        metadata: { reminderId: reminder.id } as any,
      },
    });

    return updated;
  }

  // ─────────────────────────────────────────────────────────
  // LOG ACTIVITY
  // ─────────────────────────────────────────────────────────

  async logActivity(
    userId: string,
    data: {
      leadId: string;
      type: string;
      channel?: string;
      notes?: string;
    },
  ) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: data.leadId },
    });
    if (!lead) throw new NotFoundException(`Lead ${data.leadId} not found`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true },
    });
    const advisorName = user
      ? `${user.firstName} ${user.lastName}`
      : 'Sistema';

    // Timeline entry
    const entry = await this.prisma.contactTimeline.create({
      data: {
        leadId: data.leadId,
        eventType: data.type,
        eventSource: 'manual',
        channel: data.channel || 'other',
        content: data.notes || `Actividad registrada: ${data.type}`,
        advisorId: userId,
        advisorName,
        status: 'completed',
      },
    });

    // Update last contact
    await this.prisma.lead.update({
      where: { id: data.leadId },
      data: { lastContactedAt: new Date() },
    });

    // Create corresponding SalesTask
    await this.prisma.salesTask.create({
      data: {
        advisorId: userId,
        leadId: data.leadId,
        type: data.type,
        title: `Actividad: ${data.type}`,
        description: data.notes || null,
        channel: data.channel || 'other',
        dueDate: new Date(),
        priority: 'medium',
        priorityScore: 30,
        status: 'completed',
        completedAt: new Date(),
        pipelineMoved: false,
      },
    });

    return entry;
  }

  // ─────────────────────────────────────────────────────────
  // TIMELINE
  // ─────────────────────────────────────────────────────────

  async getTimeline(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true },
    });
    if (!lead) throw new NotFoundException(`Lead ${leadId} not found`);

    return this.prisma.contactTimeline.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ─────────────────────────────────────────────────────────
  // SUGGESTIONS
  // ─────────────────────────────────────────────────────────

  async getSuggestions(leadId: string) {
    const now = new Date();

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
    });
    if (!lead) throw new NotFoundException(`Lead ${leadId} not found`);

    const [timeline, reminders, smsLogs] = await Promise.all([
      this.prisma.contactTimeline.findMany({
        where: { leadId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.reminder.findMany({
        where: { leadId, status: 'pending' },
      }),
      this.prisma.smsLog.findMany({
        where: { leadId },
        orderBy: { sentAt: 'desc' },
        take: 5,
      }),
    ]);

    const lastContact = lead.lastContactedAt
      ? new Date(lead.lastContactedAt)
      : new Date(lead.createdAt);
    const daysSinceContact = daysBetween(lastContact, now);
    const daysInStage = daysBetween(new Date(lead.updatedAt), now);

    const lastActivity = timeline.length > 0
      ? daysBetween(new Date(timeline[0].createdAt), now)
      : daysSinceContact;

    const lastSms = smsLogs.length > 0
      ? daysBetween(new Date(smsLogs[0].sentAt), now)
      : null;

    return this.computeSuggestion(
      lead,
      daysSinceContact,
      lastActivity,
      reminders.length,
      timeline,
      smsLogs,
      daysInStage,
    );
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════

  private computeSuggestion(
    lead: any,
    daysSinceContact: number,
    lastActivity: number,
    pendingReminderCount: number,
    timeline: any[],
    smsLogs: any[],
    daysInStage: number,
  ): any[] {
    const suggestions: any[] = [];
    const now = new Date();

    const lastSms = smsLogs.length > 0
      ? daysBetween(new Date(smsLogs[0].sentAt), now)
      : null;

    // No contact in 3+ days
    if (daysSinceContact >= 3) {
      suggestions.push({
        icon: 'phone',
        type: 'call',
        title: 'Llamar al prospecto',
        description: `Sin contacto en ${daysSinceContact} dias. Se recomienda llamar para dar seguimiento.`,
        priority: daysSinceContact >= 7 ? 'high' : 'medium',
      });
    }

    // Quotation delivered + no followup 3d
    if (
      lead.status === 'COTIZACION_ENTREGADA' &&
      lastActivity >= 3
    ) {
      suggestions.push({
        icon: 'file-text',
        type: 'followup',
        title: 'Dar seguimiento a cotizacion',
        description:
          'Cotizacion entregada sin seguimiento en 3+ dias. Contactar para resolver dudas.',
        priority: 'high',
      });
    }

    // High value + closing
    if (
      CLOSING_STAGES.includes(lead.status) &&
      Number(lead.estimatedValue) >= HIGH_VALUE_THRESHOLD
    ) {
      suggestions.push({
        icon: 'dollar-sign',
        type: 'priority_close',
        title: 'Priorizar cierre — monto alto',
        description: `Oportunidad de $${Number(lead.estimatedValue).toLocaleString('es-MX')} en etapa de cierre. Priorizar atencion.`,
        priority: 'high',
      });
    }

    // No pending reminders
    if (pendingReminderCount === 0) {
      suggestions.push({
        icon: 'bell',
        type: 'reminder',
        title: 'Crear recordatorio de seguimiento',
        description:
          'No hay recordatorios pendientes. Crear uno para no perder continuidad.',
        priority: 'medium',
      });
    }

    // No SMS in 7d
    if (lastSms === null || lastSms >= 7) {
      suggestions.push({
        icon: 'message-square',
        type: 'sms',
        title: 'Enviar SMS de seguimiento',
        description:
          lastSms === null
            ? 'Nunca se ha enviado SMS a este prospecto.'
            : `Ultimo SMS hace ${lastSms} dias. Enviar mensaje de seguimiento.`,
        priority: 'low',
      });
    }

    // Stage stuck >7d
    if (daysInStage > 7) {
      suggestions.push({
        icon: 'arrow-right',
        type: 'stage_update',
        title: 'Revisar si cambiar de etapa',
        description: `Lleva ${daysInStage} dias en ${STAGE_LABELS[lead.status] || lead.status}. Evaluar si avanzar o reclasificar.`,
        priority: daysInStage > 14 ? 'high' : 'medium',
      });
    }

    // WhatsApp suggestion if no recent whatsapp contact
    const lastWhatsapp = timeline.find(
      (t: any) => t.channel === 'whatsapp',
    );
    const whatsappDays = lastWhatsapp
      ? daysBetween(new Date(lastWhatsapp.createdAt), now)
      : null;
    if (
      lead.contactPhone &&
      (whatsappDays === null || whatsappDays >= 5)
    ) {
      suggestions.push({
        icon: 'message-circle',
        type: 'whatsapp',
        title: 'Enviar WhatsApp',
        description:
          whatsappDays === null
            ? 'Aun no se ha contactado por WhatsApp.'
            : `Ultimo contacto WhatsApp hace ${whatsappDays} dias.`,
        priority: 'low',
      });
    }

    // Sort by priority
    const priorityOrder: Record<string, number> = {
      high: 0,
      medium: 1,
      low: 2,
    };
    suggestions.sort(
      (a: any, b: any) =>
        (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3),
    );

    return suggestions;
  }

  // ─── Batch helpers for inbox enrichment ──────────────────

  private async getLatestTimelinesForLeads(
    leadIds: string[],
  ): Promise<Map<string, any>> {
    if (leadIds.length === 0) return new Map();

    const timelines = await this.prisma.contactTimeline.findMany({
      where: { leadId: { in: leadIds } },
      orderBy: { createdAt: 'desc' },
      distinct: ['leadId'] as any,
      select: {
        leadId: true,
        channel: true,
        eventType: true,
        createdAt: true,
      },
    });

    const map = new Map<string, any>();
    for (const t of timelines) {
      if (!map.has(t.leadId)) {
        map.set(t.leadId, t);
      }
    }
    return map;
  }

  private async getPendingReminderCounts(
    leadIds: string[],
  ): Promise<Map<string, number>> {
    if (leadIds.length === 0) return new Map();

    const groups = await (this.prisma.reminder.groupBy as any)({
      by: ['leadId'],
      where: {
        leadId: { in: leadIds },
        status: 'pending',
      },
      _count: { id: true },
    });

    const map = new Map<string, number>();
    for (const g of groups) {
      map.set(g.leadId, g._count.id);
    }
    return map;
  }

  private async getOverdueReminderCounts(
    leadIds: string[],
  ): Promise<Map<string, number>> {
    if (leadIds.length === 0) return new Map();

    const now = new Date();
    const groups = await (this.prisma.reminder.groupBy as any)({
      by: ['leadId'],
      where: {
        leadId: { in: leadIds },
        status: 'pending',
        dueDate: { lt: now },
      },
      _count: { id: true },
    });

    const map = new Map<string, number>();
    for (const g of groups) {
      map.set(g.leadId, g._count.id);
    }
    return map;
  }

  private async getAlertsForLeads(
    leadIds: string[],
  ): Promise<Map<string, any[]>> {
    if (leadIds.length === 0) return new Map();

    const alerts = await this.prisma.salesAlert.findMany({
      where: {
        leadId: { in: leadIds },
        status: 'active',
      },
      select: {
        id: true,
        leadId: true,
        type: true,
        severity: true,
        title: true,
        message: true,
      },
    });

    const map = new Map<string, any[]>();
    for (const a of alerts) {
      if (!a.leadId) continue;
      const existing = map.get(a.leadId) || [];
      existing.push(a);
      map.set(a.leadId, existing);
    }
    return map;
  }

  private async buildFilterOptions(where: any) {
    // Get all active leads for filter option generation
    const baseWhere = {
      isHistorical: false,
      deletedAt: null,
      status: { in: ACTIVE_STAGES as any },
    };

    const allLeads = await this.prisma.lead.findMany({
      where: baseWhere,
      select: {
        status: true,
        zone: true,
        assignedToId: true,
        assignedTo: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    // Unique advisors
    const advisorMap = new Map<string, any>();
    for (const lead of allLeads) {
      if (lead.assignedTo && !advisorMap.has(lead.assignedTo.id)) {
        advisorMap.set(lead.assignedTo.id, {
          id: lead.assignedTo.id,
          name: `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`,
        });
      }
    }
    const advisors = Array.from(advisorMap.values());

    // Unique zones
    const zoneSet = new Set<string>();
    for (const lead of allLeads) {
      if (lead.zone) zoneSet.add(lead.zone);
    }
    const zones = Array.from(zoneSet).sort();

    // Stages with counts
    const stageCounts: Record<string, number> = {};
    for (const lead of allLeads) {
      const s = lead.status;
      stageCounts[s] = (stageCounts[s] || 0) + 1;
    }
    const stages = Object.entries(stageCounts).map(([stage, count]: [string, number]) => ({
      stage,
      label: STAGE_LABELS[stage] || stage,
      count,
    }));

    // Overall counts
    const counts = {
      total: allLeads.length,
      closing: allLeads.filter((l: any) =>
        CLOSING_STAGES.includes(l.status),
      ).length,
      leads: allLeads.filter(
        (l: any) => !CLOSING_STAGES.includes(l.status),
      ).length,
    };

    return { advisors, zones, stages, counts };
  }
}
