import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PriorityEngineService } from '../priority-engine/priority-engine.service';

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const TERMINAL = ['CERRADO_GANADO', 'CERRADO_PERDIDO', 'LEAD_BASURA', 'CONTACTAR_FUTURO'];
const LATE_STAGES = ['COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO'];
const MID_STAGES = ['AGENDAR_CITA', 'ESPERANDO_COTIZACION'];
const EARLY_STAGES = ['PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR', 'EN_PROSPECCION'];

// Base sequence timing (days from sequence start)
const BASE_SEQUENCE: Array<{ day: number; label: string }> = [
  { day: 0, label: 'Contacto inicial' },
  { day: 3, label: 'Seguimiento' },
  { day: 7, label: 'Recordatorio' },
  { day: 15, label: 'Reactivacion' },
  { day: 30, label: 'Ultimo intento' },
];

// Channel priority by context
const CHANNEL_PREFERENCE: Record<string, string[]> = {
  new_lead: ['whatsapp', 'email', 'sms'],
  no_response: ['whatsapp', 'sms', 'email'],
  stalled_deal: ['whatsapp', 'email', 'crm_task'],
  cold_lead: ['email', 'whatsapp', 'sms'],
  reactivation: ['whatsapp', 'email', 'sms'],
  post_sale: ['email', 'whatsapp', 'crm_task'],
};

// Tone by trigger type
const TRIGGER_TONE: Record<string, string> = {
  new_lead: 'warm',
  no_response: 'consultative',
  stalled_deal: 'urgent',
  cold_lead: 'warm',
  reactivation: 'consultative',
  post_sale: 'formal',
};

// Ticket ranges
function getTicketRange(value: number | null | undefined): string {
  if (!value) return 'low';
  if (value >= 1_000_000) return 'enterprise';
  if (value >= 500_000) return 'high';
  if (value >= 150_000) return 'medium';
  return 'low';
}

// Contact frequency limits (max contacts per period)
const CONTACT_LIMITS = {
  maxPerDay: 2,
  maxPerWeek: 5,
  minHoursBetween: 12,
};

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

const TRIGGER_LABELS: Record<string, string> = {
  new_lead: 'Lead Nuevo',
  no_response: 'Sin Respuesta',
  stalled_deal: 'Deal Estancado',
  cold_lead: 'Lead Frio',
  reactivation: 'Reactivacion',
  post_sale: 'Post-Venta',
};

const CHANNEL_LABELS: Record<string, { label: string; icon: string }> = {
  whatsapp: { label: 'WhatsApp', icon: '💬' },
  sms: { label: 'SMS', icon: '📱' },
  email: { label: 'Email', icon: '📧' },
  crm_task: { label: 'CRM Task', icon: '💻' },
};

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface EnrollmentResult {
  totalEnrolled: number;
  byTrigger: Record<string, number>;
  skippedAlreadyActive: number;
  skippedTerminal: number;
  timestamp: string;
}

export interface SequenceDetail {
  id: string;
  leadId: string;
  leadName: string | null;
  companyName: string | null;
  advisorId: string;
  advisorName: string | null;
  trigger: string;
  triggerLabel: string;
  status: string;
  currentStep: number;
  maxSteps: number;
  zone: string | null;
  industry: string | null;
  estimatedValue: number | null;
  priorityScore: number;
  stopReason: string | null;
  nextActionAt: string | null;
  startedAt: string;
  lastActionAt: string | null;
  steps: StepDetail[];
}

export interface StepDetail {
  id: string;
  stepNumber: number;
  channel: string;
  channelLabel: string;
  channelIcon: string;
  tone: string;
  subject: string | null;
  messageBody: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  repliedAt: string | null;
  wasOpened: boolean;
  wasReplied: boolean;
  ledToAdvance: boolean;
}

export interface AutomationDashboard {
  kpis: {
    activeSequences: number;
    completedSequences: number;
    stoppedSequences: number;
    totalStepsSent: number;
    overallOpenRate: number;
    overallReplyRate: number;
    overallConversionRate: number;
    pipelineAdvanced: number;
    leadsInAutomation: number;
  };
  byTrigger: Array<{ trigger: string; label: string; active: number; completed: number; stopped: number; conversionRate: number }>;
  byChannel: Array<{ channel: string; label: string; icon: string; sent: number; opened: number; replied: number; openRate: number; replyRate: number }>;
  recentActions: Array<{ id: string; leadName: string; channel: string; status: string; sentAt: string; trigger: string }>;
  sequencesNeedingAttention: SequenceDetail[];
}

export interface ChannelPerformance {
  channel: string;
  label: string;
  icon: string;
  totalSent: number;
  delivered: number;
  opened: number;
  replied: number;
  failed: number;
  openRate: number;
  replyRate: number;
  deliveryRate: number;
  ledToAdvance: number;
  advanceRate: number;
  byTrigger: Array<{ trigger: string; sent: number; replied: number; replyRate: number }>;
}

export interface TemplatePerformance {
  id: string;
  key: string;
  name: string;
  trigger: string;
  channel: string;
  tone: string;
  industry: string | null;
  timesSent: number;
  timesOpened: number;
  timesReplied: number;
  conversions: number;
  openRate: number;
  replyRate: number;
  conversionRate: number;
  performanceScore: number;
}

export interface SequencePerformance {
  trigger: string;
  triggerLabel: string;
  totalSequences: number;
  activeSequences: number;
  completedNaturally: number;
  stoppedByResponse: number;
  stoppedByAdvance: number;
  avgStepsBeforeResponse: number;
  conversionRate: number;
  avgTimeToResponseHours: number;
  bestChannel: string;
  bestTone: string;
  stepBreakdown: Array<{ stepNumber: number; sent: number; opened: number; replied: number; openRate: number; replyRate: number }>;
}

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

@Injectable()
export class FollowUpAutomationService {
  private readonly logger = new Logger(FollowUpAutomationService.name);

  constructor(
    private prisma: PrismaService,
    private priorityEngine: PriorityEngineService,
  ) {}

  // ─────────────────────────────────────────────────────────
  // 1. SCAN & ENROLL — find leads needing sequences
  // ─────────────────────────────────────────────────────────

  async scanAndEnroll(): Promise<EnrollmentResult> {
    const result: EnrollmentResult = {
      totalEnrolled: 0, byTrigger: {}, skippedAlreadyActive: 0, skippedTerminal: 0,
      timestamp: new Date().toISOString(),
    };

    // Get all active sequences to avoid duplicates
    const activeSeqs = await this.prisma.followUpSequence.findMany({
      where: { status: 'active' },
      select: { leadId: true },
    });
    const activeLeadIds = new Set(activeSeqs.map((s: any) => s.leadId));

    // Get all non-terminal leads
    const leads = await this.prisma.lead.findMany({
      where: { status: { notIn: TERMINAL as any }, deletedAt: null, isHistorical: false },
      include: { assignedTo: true },
    });

    // Fallback advisor: first active user (for leads without assignment)
    const fallbackUser = await this.prisma.user.findFirst({
      where: { isActive: true },
      select: { id: true },
    });

    for (const lead of leads) {
      if (activeLeadIds.has(lead.id)) { result.skippedAlreadyActive++; continue; }
      if (TERMINAL.includes(lead.status)) { result.skippedTerminal++; continue; }

      const trigger = this.detectTrigger(lead);
      if (!trigger) continue;

      const enrolled = await this.enrollLead(lead, trigger, fallbackUser?.id);
      if (enrolled) {
        result.totalEnrolled++;
        result.byTrigger[trigger] = (result.byTrigger[trigger] || 0) + 1;
      }
    }

    this.logger.log(`Enrolled ${result.totalEnrolled} leads in follow-up sequences`);
    return result;
  }

  private detectTrigger(lead: any): string | null {
    const now = new Date();
    const lastContact = lead.lastContactedAt ? new Date(lead.lastContactedAt) : null;
    const created = new Date(lead.createdAt);
    const daysSinceContact = lastContact ? Math.floor((now.getTime() - lastContact.getTime()) / 86400000) : null;
    const daysSinceCreated = Math.floor((now.getTime() - created.getTime()) / 86400000);

    // New lead: created within 3 days, never contacted
    if (daysSinceCreated <= 3 && !lastContact && EARLY_STAGES.includes(lead.status)) {
      return 'new_lead';
    }

    // No response: contacted but no stage advancement, 3+ days; OR never contacted but 3+ days old
    if (EARLY_STAGES.includes(lead.status)) {
      if (lastContact && daysSinceContact && daysSinceContact >= 3 && daysSinceContact < 15) {
        return 'no_response';
      }
      if (!lastContact && daysSinceCreated >= 3 && daysSinceCreated < 15) {
        return 'no_response';
      }
    }

    // Stalled deal: in mid/late stage for 7+ days without contact
    if ([...MID_STAGES, ...LATE_STAGES].includes(lead.status) && daysSinceContact && daysSinceContact >= 7) {
      return 'stalled_deal';
    }

    // Cold lead: 15-60 days without contact, not terminal
    if (daysSinceContact && daysSinceContact >= 15 && daysSinceContact < 60
        && !TERMINAL.includes(lead.status) && !LATE_STAGES.includes(lead.status)) {
      return 'cold_lead';
    }

    // Reactivation: 60+ days without contact, was in active stage
    if (daysSinceContact && daysSinceContact >= 60 && !TERMINAL.includes(lead.status)) {
      return 'reactivation';
    }

    return null;
  }

  private async enrollLead(lead: any, trigger: string, fallbackAdvisorId?: string): Promise<boolean> {
    const advisorId = lead.assignedToId || lead.assignedTo?.id || fallbackAdvisorId;
    if (!advisorId) return false; // Can't enroll without advisor

    // Build adaptive sequence
    const steps = this.buildSequenceSteps(lead, trigger);

    const now = new Date();
    const seq = await this.prisma.followUpSequence.create({
      data: {
        leadId: lead.id,
        advisorId,
        trigger,
        status: 'active',
        currentStep: 0,
        maxSteps: steps.length,
        leadName: lead.contactName,
        companyName: lead.companyName,
        zone: lead.zone,
        industry: lead.industry,
        estimatedValue: lead.estimatedValue,
        leadStatus: lead.status,
        campaignSource: null, // Will be filled from attribution if available
        priorityScore: 50,
        nextActionAt: steps[0]?.scheduledAt || now,
        steps: {
          create: steps.map((s, i) => ({
            stepNumber: i + 1,
            channel: s.channel,
            tone: s.tone,
            templateKey: s.templateKey,
            subject: s.subject,
            messageBody: s.messageBody,
            variables: s.variables,
            scheduledAt: s.scheduledAt,
            delayDays: s.delayDays,
            status: 'pending',
          })),
        },
      },
    });

    this.logger.debug(`Enrolled lead ${lead.companyName} → ${trigger} (${steps.length} steps)`);
    return true;
  }

  // ─────────────────────────────────────────────────────────
  // 2. BUILD ADAPTIVE SEQUENCES
  // ─────────────────────────────────────────────────────────

  private buildSequenceSteps(lead: any, trigger: string): Array<{
    channel: string; tone: string; templateKey: string | null;
    subject: string | null; messageBody: string; variables: any;
    scheduledAt: Date; delayDays: number;
  }> {
    const now = new Date();
    const ticket = getTicketRange(lead.estimatedValue);
    const channels = CHANNEL_PREFERENCE[trigger] || ['whatsapp', 'email'];
    const baseTone = TRIGGER_TONE[trigger] || 'consultative';
    const isHighValue = ticket === 'high' || ticket === 'enterprise';

    // Adapt timing based on lead value and priority
    const timingMultiplier = isHighValue ? 0.7 : ticket === 'low' ? 1.3 : 1.0;
    const urgencyMultiplier = trigger === 'stalled_deal' ? 0.8 : trigger === 'reactivation' ? 1.5 : 1.0;

    // Build adapted sequence
    const adaptedDays = BASE_SEQUENCE.map((s: any) => ({
      ...s,
      day: Math.round(s.day * timingMultiplier * urgencyMultiplier),
    }));

    // Adjust number of steps
    let maxSteps = 5;
    if (trigger === 'post_sale') maxSteps = 3;
    if (trigger === 'reactivation') maxSteps = 4;
    if (isHighValue) maxSteps = Math.min(maxSteps + 1, 6);

    const steps: Array<any> = [];

    for (let i = 0; i < Math.min(adaptedDays.length, maxSteps); i++) {
      const dayConfig = adaptedDays[i];

      // Rotate channels: primary → secondary → primary
      const channel = channels[i % channels.length];

      // Adapt tone per step
      let tone = baseTone;
      if (i === 0) tone = trigger === 'new_lead' ? 'warm' : 'consultative';
      if (i >= 2) tone = isHighValue ? 'consultative' : 'direct';
      if (i === maxSteps - 1) tone = 'urgent';

      // Generate message content
      const msg = this.generateMessage(lead, trigger, channel, tone, i + 1, maxSteps);

      const scheduledAt = new Date(now);
      scheduledAt.setDate(scheduledAt.getDate() + dayConfig.day);
      // Schedule at optimal hours (9-11 AM or 2-4 PM)
      const hour = i % 2 === 0 ? 9 + Math.floor(Math.random() * 2) : 14 + Math.floor(Math.random() * 2);
      scheduledAt.setHours(hour, Math.floor(Math.random() * 30), 0, 0);

      steps.push({
        channel,
        tone,
        templateKey: `${trigger}_${channel}_step${i + 1}`,
        subject: channel === 'email' ? msg.subject : null,
        messageBody: msg.body,
        variables: msg.variables,
        scheduledAt,
        delayDays: dayConfig.day,
      });
    }

    return steps;
  }

  // ─────────────────────────────────────────────────────────
  // 3. MESSAGE GENERATION — dynamic personalized messages
  // ─────────────────────────────────────────────────────────

  private generateMessage(
    lead: any, trigger: string, channel: string, tone: string,
    stepNum: number, totalSteps: number,
  ): { subject: string | null; body: string; variables: Record<string, string> } {
    const name = lead.contactName?.split(' ')[0] || 'Estimado';
    const company = lead.companyName || 'su empresa';
    const industry = lead.industry || 'su industria';
    const zone = lead.zone || '';
    const value = lead.estimatedValue;
    const savings = value ? `$${Math.round(value * 0.25).toLocaleString()} MXN` : 'un ahorro significativo';
    const stageLabel = STATUS_LABELS[lead.status] || lead.status;

    const variables: Record<string, string> = {
      name, company, industry, zone, savings, stageLabel,
      value: value ? `$${Math.round(value).toLocaleString()} MXN` : '',
    };

    // ── TEMPLATES BY TRIGGER × CHANNEL × STEP ──

    if (trigger === 'new_lead') {
      return this.newLeadMessage(channel, tone, stepNum, variables);
    }
    if (trigger === 'no_response') {
      return this.noResponseMessage(channel, tone, stepNum, variables);
    }
    if (trigger === 'stalled_deal') {
      return this.stalledDealMessage(channel, tone, stepNum, variables);
    }
    if (trigger === 'cold_lead') {
      return this.coldLeadMessage(channel, tone, stepNum, variables);
    }
    if (trigger === 'reactivation') {
      return this.reactivationMessage(channel, tone, stepNum, variables);
    }
    if (trigger === 'post_sale') {
      return this.postSaleMessage(channel, tone, stepNum, variables);
    }

    return { subject: null, body: `Hola ${name}, seguimiento de ${company}.`, variables };
  }

  private newLeadMessage(ch: string, tone: string, step: number, v: Record<string, string>) {
    const msgs: Record<number, { subject: string | null; body: string }> = {
      1: {
        subject: `${v.name}, bienvenido a IEA — su proyecto en ${v.industry}`,
        body: ch === 'whatsapp'
          ? `Hola ${v.name} 👋\n\nSoy asesor de Ingenieria Electrica Alanis. Vi que tiene interes en un proyecto para ${v.company}.\n\n¿Le gustaria que le compartiera como podemos ayudarle a lograr ${v.savings} en ahorro?\n\nQuedo atento 🤝`
          : `Hola ${v.name},\n\nGracias por su interes en los servicios de IEA para ${v.company}.\n\nContamos con soluciones especializadas para ${v.industry} que pueden generar ${v.savings} en ahorro.\n\n¿Podemos agendar una breve llamada esta semana para explorar opciones?\n\nSaludos cordiales`,
      },
      2: {
        subject: `${v.name}, ¿reviso nuestra propuesta para ${v.company}?`,
        body: ch === 'whatsapp'
          ? `Hola ${v.name} 👋\n\nLe escribi hace unos dias sobre el proyecto para ${v.company}. ¿Tuvo oportunidad de revisar la informacion?\n\nMe encantaria resolver cualquier duda que tenga. ¿Le funcionaria una llamada rapida? 📞`
          : `${v.name},\n\nLe escribo como seguimiento a mi mensaje anterior sobre las soluciones de IEA para ${v.company}.\n\n¿Ha tenido oportunidad de considerar la propuesta? Estoy disponible para resolver cualquier duda.\n\nSaludos`,
      },
      3: {
        subject: `${v.name}, ultima oportunidad — cotizacion especial`,
        body: ch === 'whatsapp'
          ? `${v.name}, buen dia 🌞\n\nLe comparto que tenemos condiciones especiales este mes para proyectos como el de ${v.company}.\n\n¿Le interesa que le envie una cotizacion sin compromiso?\n\nQuedo a sus ordenes 💡`
          : `${v.name},\n\nQueria informarle que contamos con condiciones preferenciales este periodo para proyectos en ${v.industry}.\n\nSeria un placer prepararle una cotizacion personalizada para ${v.company}.\n\n¿Le parece bien?`,
      },
    };
    const m = msgs[Math.min(step, 3)] || msgs[3]!;
    return { ...m, variables: v };
  }

  private noResponseMessage(ch: string, tone: string, step: number, v: Record<string, string>) {
    const msgs: Record<number, { subject: string | null; body: string }> = {
      1: {
        subject: `${v.name}, seguimiento — ${v.company}`,
        body: ch === 'whatsapp'
          ? `Hola ${v.name} 👋\n\nIntente comunicarme antes pero no logre contactarle. Entiendo que debe estar ocupado.\n\n¿Hay algun horario que le funcione mejor para hablar sobre el proyecto de ${v.company}? 📞\n\nCualquier canal esta bien: llamada, WhatsApp o email.`
          : `${v.name},\n\nHe intentado comunicarme sin exito. Entiendo que las agendas son complicadas.\n\n¿Podria indicarme un horario conveniente? Tambien puedo enviarle la informacion por este medio si lo prefiere.\n\nQuedo atento.`,
      },
      2: {
        subject: `Informacion rapida para ${v.company}`,
        body: ch === 'sms'
          ? `${v.name}, le envio info de IEA sobre su proyecto. Responda SI para recibir cotizacion sin compromiso.`
          : `${v.name} 👋\n\nSe que el tiempo es valioso. Le comparto un resumen rapido:\n\n✅ Ahorro estimado: ${v.savings}\n✅ Retorno de inversion: 3-5 años\n✅ Sin costo de evaluacion inicial\n\n¿Le interesa agendar una visita tecnica gratuita?`,
      },
      3: {
        subject: `${v.name}, ¿sigue interesado?`,
        body: `${v.name}, buen dia.\n\nNo he recibido respuesta, asi que no quiero ser insistente. Si el proyecto para ${v.company} sigue siendo de interes, estoy aqui para ayudar.\n\nSi las prioridades cambiaron, lo entiendo perfectamente. Solo hagamelo saber. 🤝`,
      },
    };
    const m = msgs[Math.min(step, 3)] || msgs[3]!;
    return { ...m, variables: v };
  }

  private stalledDealMessage(ch: string, tone: string, step: number, v: Record<string, string>) {
    const msgs: Record<number, { subject: string | null; body: string }> = {
      1: {
        subject: `${v.name}, avance en su cotizacion — ${v.company}`,
        body: ch === 'whatsapp'
          ? `Hola ${v.name} 👋\n\nQueria darle seguimiento a la cotizacion de ${v.company}. Actualmente esta en etapa: ${v.stageLabel}.\n\n¿Hay algo que pueda ajustar o aclarar para avanzar? Estoy para ayudarle 💪`
          : `${v.name},\n\nLe escribo para darle seguimiento a su proyecto con IEA. Noto que la cotizacion lleva tiempo en revision.\n\n¿Hay dudas tecnicas o de presupuesto que pueda resolver? Con gusto agendo una llamada para aclarar cualquier punto.\n\nSaludos`,
      },
      2: {
        subject: `Propuesta actualizada — ${v.company}`,
        body: `${v.name},\n\nHe preparado una version actualizada de la propuesta para ${v.company} con condiciones mejoradas.\n\n¿Le gustaria revisarla? Puedo enviarla ahora mismo o presentarla en una breve llamada.\n\nValor del proyecto: ${v.value}\nAhorro estimado: ${v.savings}`,
      },
      3: {
        subject: `Ultima revision — proyecto ${v.company}`,
        body: `${v.name}, las condiciones actuales de la cotizacion tienen vigencia limitada.\n\nSi hay interes en avanzar, le sugiero que lo revisemos esta semana. ¿Le funciona una llamada de 15 min?\n\nQuiero asegurarme de que ${v.company} obtenga las mejores condiciones posibles.`,
      },
    };
    const m = msgs[Math.min(step, 3)] || msgs[3]!;
    return { ...m, variables: v };
  }

  private coldLeadMessage(ch: string, tone: string, step: number, v: Record<string, string>) {
    const msgs: Record<number, { subject: string | null; body: string }> = {
      1: {
        subject: `${v.name}, novedades en ${v.industry} — IEA`,
        body: ch === 'whatsapp'
          ? `Hola ${v.name} 👋\n\nHace tiempo tuvimos una conversacion sobre un proyecto para ${v.company}. Queria compartirle que tenemos nuevas opciones y mejores condiciones.\n\n¿Le interesa que le cuente mas? 🔋`
          : `${v.name},\n\nEspero se encuentre bien. Le escribo porque desde nuestra ultima conversacion, IEA ha desarrollado nuevas soluciones para ${v.industry}.\n\n¿Sigue siendo de interes explorar opciones para ${v.company}?\n\nSaludos`,
      },
      2: {
        subject: `Caso de exito en ${v.industry}`,
        body: `${v.name}, le comparto que recientemente completamos un proyecto similar al que platicamos para ${v.company}.\n\nEl cliente logro ${v.savings} de ahorro anual. ¿Le gustaria conocer los detalles?\n\nSin compromiso, solo informativo. 📊`,
      },
    };
    const m = msgs[Math.min(step, 2)] || msgs[2]!;
    return { ...m, variables: v };
  }

  private reactivationMessage(ch: string, tone: string, step: number, v: Record<string, string>) {
    const msgs: Record<number, { subject: string | null; body: string }> = {
      1: {
        subject: `${v.name}, vale la pena retomar — ${v.company}`,
        body: ch === 'whatsapp'
          ? `Hola ${v.name} 👋\n\nHace un tiempo conversamos sobre un proyecto para ${v.company}. Las condiciones del mercado han cambiado y ahora podria ser un excelente momento para retomarlo.\n\n¿Tendria 5 minutos para una actualizacion rapida? 🔋`
          : `${v.name},\n\nHan pasado varios meses desde nuestra ultima conversacion sobre ${v.company}.\n\nQueria informarle que las condiciones actuales son mas favorables que antes, con nuevos incentivos disponibles.\n\n¿Le interesa agendar una breve actualizacion?\n\nSaludos cordiales`,
      },
      2: {
        subject: `Promocion especial — retome su proyecto`,
        body: `${v.name},\n\nTenemos una promocion especial para proyectos en ${v.industry} este trimestre.\n\nCondiciones preferenciales + evaluacion gratuita para ${v.company}.\n\n¿Le envio los detalles? Responda y se los comparto de inmediato. ✅`,
      },
    };
    const m = msgs[Math.min(step, 2)] || msgs[2]!;
    return { ...m, variables: v };
  }

  private postSaleMessage(ch: string, tone: string, step: number, v: Record<string, string>) {
    const msgs: Record<number, { subject: string | null; body: string }> = {
      1: {
        subject: `${v.name}, felicidades por su proyecto — ${v.company}`,
        body: `Hola ${v.name} 👏\n\nFelicidades por iniciar su proyecto con IEA. Queria asegurarme de que todo este avanzando correctamente.\n\n¿Hay algo en lo que pueda ayudarle? Estoy a sus ordenes.\n\nTambien queria preguntarle: ¿conoce a alguien mas que pudiera beneficiarse de nuestros servicios? 🤝`,
      },
      2: {
        subject: `Seguimiento post-venta — ${v.company}`,
        body: `${v.name}, buen dia.\n\nRealizando seguimiento de satisfaccion de su proyecto.\n\n¿Como va todo? Si tiene alguna necesidad adicional o conoce empresas que pudieran beneficiarse, no dude en contactarnos.\n\nAgradecemos su confianza. ⭐`,
      },
    };
    const m = msgs[Math.min(step, 2)] || msgs[2]!;
    return { ...m, variables: v };
  }

  // ─────────────────────────────────────────────────────────
  // 4. EXECUTE PENDING STEPS — process due steps
  // ─────────────────────────────────────────────────────────

  async executePendingSteps(): Promise<{ executed: number; failed: number; skipped: number }> {
    const now = new Date();
    const result = { executed: 0, failed: 0, skipped: 0 };

    // Check stop conditions first
    await this.checkStopConditions();

    // Get due steps from active sequences
    const dueSteps = await this.prisma.followUpStep.findMany({
      where: {
        status: 'pending',
        scheduledAt: { lte: now },
        sequence: { status: 'active' },
      },
      include: { sequence: true },
      orderBy: { scheduledAt: 'asc' },
      take: 100, // batch limit
    });

    for (const step of dueSteps) {
      // Check over-contact limits
      const canContact = await this.checkContactLimits(step.sequence.leadId);
      if (!canContact) {
        // Reschedule 12h later
        await this.prisma.followUpStep.update({
          where: { id: step.id },
          data: { scheduledAt: new Date(now.getTime() + 12 * 3600000) },
        });
        result.skipped++;
        continue;
      }

      try {
        // Simulate sending (in production, integrate with actual APIs)
        await this.prisma.followUpStep.update({
          where: { id: step.id },
          data: {
            status: 'sent',
            sentAt: now,
            deliveredAt: now, // Assume delivered for now
          },
        });

        // Update sequence state
        await this.prisma.followUpSequence.update({
          where: { id: step.sequenceId },
          data: {
            currentStep: step.stepNumber,
            lastActionAt: now,
            nextActionAt: await this.getNextStepDate(step.sequenceId, step.stepNumber),
          },
        });

        // Log activity
        await this.logAction(step, 'sent');

        result.executed++;
      } catch (err) {
        await this.prisma.followUpStep.update({
          where: { id: step.id },
          data: { status: 'failed', failedAt: now, failReason: String(err) },
        });
        result.failed++;
      }
    }

    this.logger.log(`Executed ${result.executed} steps, ${result.failed} failed, ${result.skipped} skipped`);
    return result;
  }

  private async checkContactLimits(leadId: string): Promise<boolean> {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 3600000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600000);
    const hoursAgo = new Date(now.getTime() - CONTACT_LIMITS.minHoursBetween * 3600000);

    const [dayCount, weekCount, recentCount] = await Promise.all([
      this.prisma.followUpStep.count({
        where: { sequence: { leadId }, status: 'sent', sentAt: { gte: dayAgo } },
      }),
      this.prisma.followUpStep.count({
        where: { sequence: { leadId }, status: 'sent', sentAt: { gte: weekAgo } },
      }),
      this.prisma.followUpStep.count({
        where: { sequence: { leadId }, status: 'sent', sentAt: { gte: hoursAgo } },
      }),
    ]);

    return dayCount < CONTACT_LIMITS.maxPerDay
        && weekCount < CONTACT_LIMITS.maxPerWeek
        && recentCount === 0;
  }

  private async getNextStepDate(seqId: string, currentStep: number): Promise<Date | null> {
    const nextStep = await this.prisma.followUpStep.findFirst({
      where: { sequenceId: seqId, stepNumber: currentStep + 1, status: 'pending' },
      select: { scheduledAt: true },
    });
    return nextStep?.scheduledAt || null;
  }

  // ─────────────────────────────────────────────────────────
  // 5. STOP CONDITIONS — auto-detect when to stop
  // ─────────────────────────────────────────────────────────

  private async checkStopConditions(): Promise<number> {
    let stopped = 0;
    const activeSeqs = await this.prisma.followUpSequence.findMany({
      where: { status: 'active' },
      select: { id: true, leadId: true, startedAt: true, currentStep: true, maxSteps: true },
    });

    for (const seq of activeSeqs) {
      const lead = await this.prisma.lead.findUnique({
        where: { id: seq.leadId },
        select: { status: true, lastContactedAt: true },
      });
      if (!lead) continue;

      let stopReason: string | null = null;

      // Lead closed or terminal
      if (TERMINAL.includes(lead.status)) {
        stopReason = lead.status === 'CERRADO_GANADO' ? 'closed' : lead.status === 'CERRADO_PERDIDO' ? 'rejected' : 'closed';
      }

      // Lead advanced (stage changed since sequence start — advisor intervened)
      // Check if lead was contacted more recently than last sequence action
      if (lead.lastContactedAt) {
        const lastManual = await this.prisma.salesTask.findFirst({
          where: {
            leadId: seq.leadId,
            status: 'completed',
            source: { not: 'automation' },
            completedAt: { gte: seq.startedAt },
            isHistorical: false,
          },
        });
        if (lastManual) stopReason = 'advisor_intervened';
      }

      // Sequence completed naturally
      if (seq.currentStep >= seq.maxSteps) {
        stopReason = 'expired';
      }

      // Check for replies
      const hasReply = await this.prisma.followUpStep.findFirst({
        where: { sequenceId: seq.id, wasReplied: true },
      });
      if (hasReply) stopReason = 'responded';

      if (stopReason) {
        await this.stopSequence(seq.id, stopReason);
        stopped++;
      }
    }

    return stopped;
  }

  async stopSequence(id: string, reason: string): Promise<void> {
    const now = new Date();
    await this.prisma.followUpSequence.update({
      where: { id },
      data: { status: 'stopped', stopReason: reason, completedAt: now },
    });
    // Cancel remaining pending steps
    await this.prisma.followUpStep.updateMany({
      where: { sequenceId: id, status: 'pending' },
      data: { status: 'cancelled' },
    });
  }

  // ─────────────────────────────────────────────────────────
  // 6. MANUAL ACTIONS
  // ─────────────────────────────────────────────────────────

  async pauseSequence(id: string) {
    return this.prisma.followUpSequence.update({
      where: { id },
      data: { status: 'paused', pausedAt: new Date() },
    });
  }

  async resumeSequence(id: string) {
    return this.prisma.followUpSequence.update({
      where: { id },
      data: { status: 'active', pausedAt: null },
    });
  }

  async markStepReplied(stepId: string) {
    const now = new Date();
    const step = await this.prisma.followUpStep.update({
      where: { id: stepId },
      data: { wasReplied: true, repliedAt: now, status: 'replied' },
    });
    // Stop the sequence — lead responded
    await this.stopSequence(step.sequenceId, 'responded');
    // Update template performance
    if (step.templateKey) await this.updateTemplatePerformance(step.templateKey, 'replied');
    return step;
  }

  async markStepOpened(stepId: string) {
    const step = await this.prisma.followUpStep.update({
      where: { id: stepId },
      data: { wasOpened: true, openedAt: new Date(), status: 'opened' },
    });
    if (step.templateKey) await this.updateTemplatePerformance(step.templateKey, 'opened');
    return step;
  }

  async markStepAdvanced(stepId: string) {
    const step = await this.prisma.followUpStep.update({
      where: { id: stepId },
      data: { ledToAdvance: true },
    });
    if (step.templateKey) await this.updateTemplatePerformance(step.templateKey, 'conversion');
    await this.stopSequence(step.sequenceId, 'advanced');
    return step;
  }

  // ─────────────────────────────────────────────────────────
  // 7. TEMPLATE PERFORMANCE — learning system
  // ─────────────────────────────────────────────────────────

  private async updateTemplatePerformance(templateKey: string, event: 'sent' | 'opened' | 'replied' | 'conversion') {
    const template = await this.prisma.messageTemplate.findUnique({ where: { key: templateKey } });
    if (!template) return;

    const data: any = {};
    if (event === 'sent') data.timesSent = template.timesSent + 1;
    if (event === 'opened') data.timesOpened = template.timesOpened + 1;
    if (event === 'replied') data.timesReplied = template.timesReplied + 1;
    if (event === 'conversion') data.conversions = template.conversions + 1;

    // Recalculate rates
    const sent = event === 'sent' ? template.timesSent + 1 : template.timesSent;
    if (sent > 0) {
      const opened = event === 'opened' ? template.timesOpened + 1 : template.timesOpened;
      const replied = event === 'replied' ? template.timesReplied + 1 : template.timesReplied;
      const conversions = event === 'conversion' ? template.conversions + 1 : template.conversions;
      data.openRate = (opened / sent) * 100;
      data.replyRate = (replied / sent) * 100;
      data.conversionRate = (conversions / sent) * 100;
      // Performance score: weighted combination
      data.performanceScore = Math.min(100, data.openRate * 0.2 + data.replyRate * 0.5 + data.conversionRate * 0.3);
    }

    await this.prisma.messageTemplate.update({ where: { key: templateKey }, data });
  }

  async getTemplatePerformance(): Promise<TemplatePerformance[]> {
    const templates = await this.prisma.messageTemplate.findMany({
      where: { isActive: true },
      orderBy: { performanceScore: 'desc' },
    });
    return templates.map((t: any) => ({
      id: t.id, key: t.key, name: t.name, trigger: t.trigger, channel: t.channel,
      tone: t.tone, industry: t.industry, timesSent: t.timesSent,
      timesOpened: t.timesOpened, timesReplied: t.timesReplied, conversions: t.conversions,
      openRate: t.openRate, replyRate: t.replyRate, conversionRate: t.conversionRate,
      performanceScore: t.performanceScore,
    }));
  }

  // ─────────────────────────────────────────────────────────
  // 8. CHANNEL PERFORMANCE
  // ─────────────────────────────────────────────────────────

  async getChannelPerformance(): Promise<ChannelPerformance[]> {
    const channels = ['whatsapp', 'sms', 'email', 'crm_task'];
    const result: ChannelPerformance[] = [];

    for (const ch of channels) {
      const steps = await this.prisma.followUpStep.findMany({
        where: { channel: ch, status: { not: 'pending' } },
        include: { sequence: { select: { trigger: true } } },
      });

      const sent = steps.filter((s: any) => ['sent', 'delivered', 'opened', 'replied'].includes(s.status)).length;
      const delivered = steps.filter((s: any) => s.deliveredAt).length;
      const opened = steps.filter((s: any) => s.wasOpened).length;
      const replied = steps.filter((s: any) => s.wasReplied).length;
      const failed = steps.filter((s: any) => s.status === 'failed').length;
      const advanced = steps.filter((s: any) => s.ledToAdvance).length;

      // By trigger breakdown
      const triggerMap = new Map<string, { sent: number; replied: number }>();
      for (const s of steps) {
        const t = s.sequence.trigger;
        const entry = triggerMap.get(t) || { sent: 0, replied: 0 };
        if (['sent', 'delivered', 'opened', 'replied'].includes(s.status)) entry.sent++;
        if (s.wasReplied) entry.replied++;
        triggerMap.set(t, entry);
      }

      const chInfo = CHANNEL_LABELS[ch] || { label: ch, icon: '📎' };

      result.push({
        channel: ch,
        label: chInfo.label,
        icon: chInfo.icon,
        totalSent: sent,
        delivered,
        opened,
        replied,
        failed,
        openRate: sent > 0 ? (opened / sent) * 100 : 0,
        replyRate: sent > 0 ? (replied / sent) * 100 : 0,
        deliveryRate: sent > 0 ? (delivered / sent) * 100 : 0,
        ledToAdvance: advanced,
        advanceRate: sent > 0 ? (advanced / sent) * 100 : 0,
        byTrigger: Array.from(triggerMap.entries()).map(([trigger, d]) => ({
          trigger, sent: d.sent, replied: d.replied,
          replyRate: d.sent > 0 ? (d.replied / d.sent) * 100 : 0,
        })),
      });
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────
  // 9. SEQUENCE PERFORMANCE — by trigger type
  // ─────────────────────────────────────────────────────────

  async getSequencePerformance(): Promise<SequencePerformance[]> {
    const triggers = ['new_lead', 'no_response', 'stalled_deal', 'cold_lead', 'reactivation', 'post_sale'];
    const result: SequencePerformance[] = [];

    for (const trigger of triggers) {
      const sequences = await this.prisma.followUpSequence.findMany({
        where: { trigger },
        include: { steps: true },
      });

      const total = sequences.length;
      const active = sequences.filter((s: any) => s.status === 'active').length;
      const completed = sequences.filter((s: any) => s.status === 'completed' || s.stopReason === 'expired').length;
      const respondedStop = sequences.filter((s: any) => s.stopReason === 'responded').length;
      const advancedStop = sequences.filter((s: any) => s.stopReason === 'advanced').length;

      // Steps analysis
      const allSteps = sequences.flatMap((s) => s.steps);
      const sentSteps = allSteps.filter((s: any) => s.sentAt);
      const repliedSteps = allSteps.filter((s: any) => s.wasReplied);

      // Best channel
      const channelCounts = new Map<string, { sent: number; replied: number }>();
      for (const s of sentSteps) {
        const entry = channelCounts.get(s.channel) || { sent: 0, replied: 0 };
        entry.sent++;
        if (s.wasReplied) entry.replied++;
        channelCounts.set(s.channel, entry);
      }
      let bestChannel = 'whatsapp';
      let bestReplyRate = 0;
      for (const [ch, d] of channelCounts.entries()) {
        const rate = d.sent > 0 ? d.replied / d.sent : 0;
        if (rate > bestReplyRate) { bestReplyRate = rate; bestChannel = ch; }
      }

      // Best tone
      const toneCounts = new Map<string, { sent: number; replied: number }>();
      for (const s of sentSteps) {
        const entry = toneCounts.get(s.tone) || { sent: 0, replied: 0 };
        entry.sent++;
        if (s.wasReplied) entry.replied++;
        toneCounts.set(s.tone, entry);
      }
      let bestTone = 'consultative';
      let bestToneRate = 0;
      for (const [tone, d] of toneCounts.entries()) {
        const rate = d.sent > 0 ? d.replied / d.sent : 0;
        if (rate > bestToneRate) { bestToneRate = rate; bestTone = tone; }
      }

      // Average steps before first response
      const seqsWithResponse = sequences.filter((s: any) => s.stopReason === 'responded');
      const avgSteps = seqsWithResponse.length > 0
        ? seqsWithResponse.reduce((sum, s) => sum + s.currentStep, 0) / seqsWithResponse.length
        : 0;

      // Time to response
      const responseTimes = seqsWithResponse
        .filter((s: any) => s.completedAt && s.startedAt)
        .map((s: any) => (new Date(s.completedAt!).getTime() - new Date(s.startedAt).getTime()) / 3600000);
      const avgTimeToResponse = responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;

      // Step breakdown
      const stepMap = new Map<number, { sent: number; opened: number; replied: number }>();
      for (const s of allSteps) {
        const entry = stepMap.get(s.stepNumber) || { sent: 0, opened: 0, replied: 0 };
        if (s.sentAt) entry.sent++;
        if (s.wasOpened) entry.opened++;
        if (s.wasReplied) entry.replied++;
        stepMap.set(s.stepNumber, entry);
      }

      result.push({
        trigger,
        triggerLabel: TRIGGER_LABELS[trigger] || trigger,
        totalSequences: total,
        activeSequences: active,
        completedNaturally: completed,
        stoppedByResponse: respondedStop,
        stoppedByAdvance: advancedStop,
        avgStepsBeforeResponse: Math.round(avgSteps * 10) / 10,
        conversionRate: total > 0 ? ((respondedStop + advancedStop) / total) * 100 : 0,
        avgTimeToResponseHours: Math.round(avgTimeToResponse * 10) / 10,
        bestChannel,
        bestTone,
        stepBreakdown: Array.from(stepMap.entries())
          .sort(([a], [b]) => a - b)
          .map(([stepNumber, d]) => ({
            stepNumber, sent: d.sent, opened: d.opened, replied: d.replied,
            openRate: d.sent > 0 ? (d.opened / d.sent) * 100 : 0,
            replyRate: d.sent > 0 ? (d.replied / d.sent) * 100 : 0,
          })),
      });
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────
  // 10. AUTOMATION DASHBOARD — main overview
  // ─────────────────────────────────────────────────────────

  async getDashboard(): Promise<AutomationDashboard> {
    const [sequences, allSteps] = await Promise.all([
      this.prisma.followUpSequence.findMany({
        include: { steps: true },
      }),
      this.prisma.followUpStep.findMany({
        where: { status: { not: 'pending' } },
        include: { sequence: { select: { trigger: true, leadName: true } } },
      }),
    ]);

    const active = sequences.filter((s: any) => s.status === 'active');
    const completed = sequences.filter((s: any) => s.status === 'completed' || s.stopReason === 'expired');
    const stopped = sequences.filter((s: any) => s.status === 'stopped');

    const sentSteps = allSteps.filter((s: any) => ['sent', 'delivered', 'opened', 'replied'].includes(s.status));
    const openedSteps = allSteps.filter((s: any) => s.wasOpened);
    const repliedSteps = allSteps.filter((s: any) => s.wasReplied);
    const advancedSteps = allSteps.filter((s: any) => s.ledToAdvance);

    const uniqueLeads = new Set(sequences.map((s: any) => s.leadId));

    // By trigger
    const triggerMap = new Map<string, { active: number; completed: number; stopped: number; responded: number }>();
    for (const s of sequences) {
      const entry = triggerMap.get(s.trigger) || { active: 0, completed: 0, stopped: 0, responded: 0 };
      if (s.status === 'active') entry.active++;
      if (s.status === 'completed' || s.stopReason === 'expired') entry.completed++;
      if (s.status === 'stopped') entry.stopped++;
      if (s.stopReason === 'responded' || s.stopReason === 'advanced') entry.responded++;
      triggerMap.set(s.trigger, entry);
    }

    // By channel
    const channelMap = new Map<string, { sent: number; opened: number; replied: number }>();
    for (const s of sentSteps) {
      const entry = channelMap.get(s.channel) || { sent: 0, opened: 0, replied: 0 };
      entry.sent++;
      if (s.wasOpened) entry.opened++;
      if (s.wasReplied) entry.replied++;
      channelMap.set(s.channel, entry);
    }

    // Recent actions
    const recent = allSteps
      .filter((s: any) => s.sentAt)
      .sort((a: any, b: any) => new Date(b.sentAt!).getTime() - new Date(a.sentAt!).getTime())
      .slice(0, 20)
      .map((s: any) => ({
        id: s.id,
        leadName: s.sequence.leadName || 'Sin nombre',
        channel: s.channel,
        status: s.status,
        sentAt: s.sentAt!.toISOString(),
        trigger: s.sequence.trigger,
      }));

    // Sequences needing attention (active, overdue next action)
    const now = new Date();
    const needAttention = active
      .filter((s: any) => s.nextActionAt && new Date(s.nextActionAt) < now)
      .slice(0, 10)
      .map((s: any) => this.enrichSequence(s));

    const totalSeqs = sequences.length;

    return {
      kpis: {
        activeSequences: active.length,
        completedSequences: completed.length,
        stoppedSequences: stopped.length,
        totalStepsSent: sentSteps.length,
        overallOpenRate: sentSteps.length > 0 ? (openedSteps.length / sentSteps.length) * 100 : 0,
        overallReplyRate: sentSteps.length > 0 ? (repliedSteps.length / sentSteps.length) * 100 : 0,
        overallConversionRate: totalSeqs > 0 ? (advancedSteps.length / totalSeqs) * 100 : 0,
        pipelineAdvanced: advancedSteps.length,
        leadsInAutomation: uniqueLeads.size,
      },
      byTrigger: Array.from(triggerMap.entries()).map(([trigger, d]) => ({
        trigger,
        label: TRIGGER_LABELS[trigger] || trigger,
        active: d.active,
        completed: d.completed,
        stopped: d.stopped,
        conversionRate: (d.active + d.completed + d.stopped) > 0
          ? (d.responded / (d.active + d.completed + d.stopped)) * 100
          : 0,
      })),
      byChannel: Array.from(channelMap.entries()).map(([channel, d]) => {
        const ch = CHANNEL_LABELS[channel] || { label: channel, icon: '📎' };
        return {
          channel, label: ch.label, icon: ch.icon,
          sent: d.sent, opened: d.opened, replied: d.replied,
          openRate: d.sent > 0 ? (d.opened / d.sent) * 100 : 0,
          replyRate: d.sent > 0 ? (d.replied / d.sent) * 100 : 0,
        };
      }),
      recentActions: recent,
      sequencesNeedingAttention: needAttention,
    };
  }

  // ─────────────────────────────────────────────────────────
  // 11. LEADS IN AUTOMATION
  // ─────────────────────────────────────────────────────────

  async getLeadsInAutomation(filters?: { status?: string; trigger?: string; zone?: string }): Promise<SequenceDetail[]> {
    const where: any = {};
    if (filters?.status) where.status = filters.status;
    if (filters?.trigger) where.trigger = filters.trigger;
    if (filters?.zone) where.zone = filters.zone;

    const sequences = await this.prisma.followUpSequence.findMany({
      where,
      include: { steps: { orderBy: { stepNumber: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });

    // Get advisor names
    const advisorIds = [...new Set(sequences.map((s: any) => s.advisorId))];
    const advisors = await this.prisma.user.findMany({
      where: { id: { in: advisorIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    const advisorMap = new Map(advisors.map((a) => [a.id, `${a.firstName} ${a.lastName}`]));

    return sequences.map((s: any) => ({
      ...this.enrichSequence(s),
      advisorName: advisorMap.get(s.advisorId) || null,
    }));
  }

  private enrichSequence(s: any): SequenceDetail {
    return {
      id: s.id,
      leadId: s.leadId,
      leadName: s.leadName,
      companyName: s.companyName,
      advisorId: s.advisorId,
      advisorName: null, // filled by caller
      trigger: s.trigger,
      triggerLabel: TRIGGER_LABELS[s.trigger] || s.trigger,
      status: s.status,
      currentStep: s.currentStep,
      maxSteps: s.maxSteps,
      zone: s.zone,
      industry: s.industry,
      estimatedValue: s.estimatedValue,
      priorityScore: s.priorityScore,
      stopReason: s.stopReason,
      nextActionAt: s.nextActionAt?.toISOString() || null,
      startedAt: s.startedAt.toISOString(),
      lastActionAt: s.lastActionAt?.toISOString() || null,
      steps: (s.steps || []).map((st: any) => {
        const ch = CHANNEL_LABELS[st.channel] || { label: st.channel, icon: '📎' };
        return {
          id: st.id,
          stepNumber: st.stepNumber,
          channel: st.channel,
          channelLabel: ch.label,
          channelIcon: ch.icon,
          tone: st.tone,
          subject: st.subject,
          messageBody: st.messageBody,
          status: st.status,
          scheduledAt: st.scheduledAt?.toISOString() || null,
          sentAt: st.sentAt?.toISOString() || null,
          deliveredAt: st.deliveredAt?.toISOString() || null,
          openedAt: st.openedAt?.toISOString() || null,
          repliedAt: st.repliedAt?.toISOString() || null,
          wasOpened: st.wasOpened,
          wasReplied: st.wasReplied,
          ledToAdvance: st.ledToAdvance,
        };
      }),
    };
  }

  // ─────────────────────────────────────────────────────────
  // 12. LEARNING — best-performing recommendations
  // ─────────────────────────────────────────────────────────

  async getLearningInsights(): Promise<{
    bestChannelByTrigger: Record<string, { channel: string; replyRate: number }>;
    bestToneByTrigger: Record<string, { tone: string; replyRate: number }>;
    bestTimingByChannel: Record<string, { bestHour: number; bestDay: string }>;
    topTemplates: TemplatePerformance[];
    recommendations: string[];
  }> {
    const allSteps = await this.prisma.followUpStep.findMany({
      where: { sentAt: { not: null } },
      include: { sequence: { select: { trigger: true } } },
    });

    // Best channel by trigger
    const bestChannelByTrigger: Record<string, { channel: string; replyRate: number }> = {};
    const triggerChannelMap = new Map<string, Map<string, { sent: number; replied: number }>>();
    for (const s of allSteps) {
      const t = s.sequence.trigger;
      if (!triggerChannelMap.has(t)) triggerChannelMap.set(t, new Map());
      const chMap = triggerChannelMap.get(t)!;
      const entry = chMap.get(s.channel) || { sent: 0, replied: 0 };
      entry.sent++;
      if (s.wasReplied) entry.replied++;
      chMap.set(s.channel, entry);
    }
    for (const [trigger, chMap] of triggerChannelMap.entries()) {
      let best = { channel: 'whatsapp', replyRate: 0 };
      for (const [ch, d] of chMap.entries()) {
        const rate = d.sent > 0 ? (d.replied / d.sent) * 100 : 0;
        if (rate > best.replyRate) best = { channel: ch, replyRate: Math.round(rate * 10) / 10 };
      }
      bestChannelByTrigger[trigger] = best;
    }

    // Best tone by trigger
    const bestToneByTrigger: Record<string, { tone: string; replyRate: number }> = {};
    const triggerToneMap = new Map<string, Map<string, { sent: number; replied: number }>>();
    for (const s of allSteps) {
      const t = s.sequence.trigger;
      if (!triggerToneMap.has(t)) triggerToneMap.set(t, new Map());
      const toneMap = triggerToneMap.get(t)!;
      const entry = toneMap.get(s.tone) || { sent: 0, replied: 0 };
      entry.sent++;
      if (s.wasReplied) entry.replied++;
      toneMap.set(s.tone, entry);
    }
    for (const [trigger, toneMap] of triggerToneMap.entries()) {
      let best = { tone: 'consultative', replyRate: 0 };
      for (const [tone, d] of toneMap.entries()) {
        const rate = d.sent > 0 ? (d.replied / d.sent) * 100 : 0;
        if (rate > best.replyRate) best = { tone, replyRate: Math.round(rate * 10) / 10 };
      }
      bestToneByTrigger[trigger] = best;
    }

    // Best timing by channel
    const bestTimingByChannel: Record<string, { bestHour: number; bestDay: string }> = {};
    const channelHourMap = new Map<string, Map<number, { sent: number; replied: number }>>();
    const days = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
    const channelDayMap = new Map<string, Map<number, { sent: number; replied: number }>>();
    for (const s of allSteps) {
      if (!s.sentAt) continue;
      const d = new Date(s.sentAt);
      const hour = d.getHours();
      const day = d.getDay();

      if (!channelHourMap.has(s.channel)) channelHourMap.set(s.channel, new Map());
      const hm = channelHourMap.get(s.channel)!;
      const he = hm.get(hour) || { sent: 0, replied: 0 };
      he.sent++; if (s.wasReplied) he.replied++;
      hm.set(hour, he);

      if (!channelDayMap.has(s.channel)) channelDayMap.set(s.channel, new Map());
      const dm = channelDayMap.get(s.channel)!;
      const de = dm.get(day) || { sent: 0, replied: 0 };
      de.sent++; if (s.wasReplied) de.replied++;
      dm.set(day, de);
    }
    for (const [ch, hm] of channelHourMap.entries()) {
      let bestHour = 9; let bestHourRate = 0;
      for (const [h, d] of hm.entries()) {
        const rate = d.sent > 0 ? d.replied / d.sent : 0;
        if (rate > bestHourRate) { bestHourRate = rate; bestHour = h; }
      }
      let bestDay = 'Martes'; let bestDayRate = 0;
      const dm = channelDayMap.get(ch);
      if (dm) {
        for (const [day, d] of dm.entries()) {
          const rate = d.sent > 0 ? d.replied / d.sent : 0;
          if (rate > bestDayRate) { bestDayRate = rate; bestDay = days[day]; }
        }
      }
      bestTimingByChannel[ch] = { bestHour, bestDay };
    }

    // Top templates
    const topTemplates = await this.prisma.messageTemplate.findMany({
      where: { isActive: true, timesSent: { gt: 0 } },
      orderBy: { performanceScore: 'desc' },
      take: 10,
    });

    // Generate recommendations
    const recommendations: string[] = [];
    const totalSent = allSteps.length;
    const totalReplied = allSteps.filter((s: any) => s.wasReplied).length;
    const overallRate = totalSent > 0 ? (totalReplied / totalSent) * 100 : 0;

    if (overallRate < 5) {
      recommendations.push('La tasa de respuesta general es muy baja. Considere revisar los mensajes y horarios de envio.');
    }
    if (overallRate > 20) {
      recommendations.push('Excelente tasa de respuesta. Las secuencias automatizadas estan generando engagement.');
    }

    for (const [trigger, best] of Object.entries(bestChannelByTrigger)) {
      const label = TRIGGER_LABELS[trigger] || trigger;
      recommendations.push(`Para ${label}: mejor canal es ${CHANNEL_LABELS[best.channel]?.label || best.channel} (${best.replyRate}% respuesta)`);
    }

    if (totalSent === 0) {
      recommendations.push('No hay datos suficientes aun. Ejecute secuencias para comenzar a aprender.');
    }

    return {
      bestChannelByTrigger,
      bestToneByTrigger,
      bestTimingByChannel,
      topTemplates: topTemplates.map((t: any) => ({
        id: t.id, key: t.key, name: t.name, trigger: t.trigger, channel: t.channel,
        tone: t.tone, industry: t.industry, timesSent: t.timesSent,
        timesOpened: t.timesOpened, timesReplied: t.timesReplied, conversions: t.conversions,
        openRate: t.openRate, replyRate: t.replyRate, conversionRate: t.conversionRate,
        performanceScore: t.performanceScore,
      })),
      recommendations,
    };
  }

  // ─────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────

  private async logAction(step: any, action: string) {
    // Could write to audit_logs or a dedicated action_log table
    this.logger.debug(`[${action}] Step ${step.stepNumber} → ${step.channel} for sequence ${step.sequenceId}`);
  }
}
