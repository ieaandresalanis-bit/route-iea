import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const TERMINAL = ['CERRADO_GANADO', 'CERRADO_PERDIDO', 'LEAD_BASURA', 'CONTACTAR_FUTURO'];
const MEETING_STAGES = ['AGENDAR_CITA', 'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO', 'CERRADO_GANADO'];
const DEAL_STAGES = ['ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO', 'CERRADO_GANADO'];
const CLOSED_STAGES = ['CERRADO_GANADO'];

const TRIGGER_LABELS: Record<string, string> = {
  new_lead: 'Lead Nuevo', no_response: 'Sin Respuesta', stalled_deal: 'Deal Estancado',
  cold_lead: 'Lead Frio', reactivation: 'Reactivacion', post_sale: 'Post-Venta',
};
const CHANNEL_LABELS: Record<string, { label: string; icon: string }> = {
  whatsapp: { label: 'WhatsApp', icon: '💬' }, sms: { label: 'SMS', icon: '📱' },
  email: { label: 'Email', icon: '📧' }, crm_task: { label: 'CRM Task', icon: '💻' },
};

// Alert thresholds
const THRESHOLDS = {
  lowResponseRate: 3,       // % — below triggers alert
  lowConversion: 1,         // % — response-to-meeting below this
  highDropoff: 70,          // % — step1→step2 dropoff above this
  stalledSequences: 5,      // count of overdue sequences
  channelUnderperform: 2,   // % — channel reply rate below this
};

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface FunnelMetrics {
  messagesSent: number;
  messagesDelivered: number;
  responsesReceived: number;
  meetingsGenerated: number;
  dealsCreated: number;
  dealsClosed: number;
  revenueGenerated: number;
  responseRate: number;
  conversionToMeeting: number;
  conversionToDeal: number;
  conversionToClose: number;
  roi: number;
}

export interface BreakdownEntry extends FunnelMetrics {
  key: string;
  label: string;
}

export interface SequenceRanking {
  id: string;
  trigger: string;
  triggerLabel: string;
  leadName: string | null;
  companyName: string | null;
  zone: string | null;
  advisorName: string | null;
  channel: string;
  stepsSent: number;
  totalSteps: number;
  wasReplied: boolean;
  meetingBooked: boolean;
  dealCreated: boolean;
  dealClosed: boolean;
  revenueGenerated: number | null;
  estimatedValue: number | null;
  score: number;
  startedAt: string;
}

export interface ABTestResult {
  id: string;
  name: string;
  status: string;
  trigger: string;
  channel: string;
  stepNumber: number;
  variantA: { body: string; tone: string; sent: number; opened: number; replied: number; converted: number; openRate: number; replyRate: number; convRate: number };
  variantB: { body: string; tone: string; sent: number; opened: number; replied: number; converted: number; openRate: number; replyRate: number; convRate: number };
  winner: string | null;
  winnerConfidence: number | null;
  statisticallySignificant: boolean;
  recommendation: string;
}

export interface MessageRanking {
  templateKey: string;
  channel: string;
  trigger: string;
  tone: string;
  stepNumber: number;
  sent: number;
  opened: number;
  replied: number;
  advanced: number;
  openRate: number;
  replyRate: number;
  advanceRate: number;
  score: number;
  sampleBody: string;
}

export interface AlertEntry {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  recommendation: string | null;
  metric: string | null;
  metricValue: number | null;
  threshold: number | null;
  dimension: string | null;
  dimensionId: string | null;
  status: string;
  createdAt: string;
}

export interface Recommendation {
  type: string; // improve_message | prioritize_channel | scale_sequence | fix_dropoff | stop_underperformer
  priority: string; // critical | high | medium
  title: string;
  description: string;
  impact: string;
  action: string;
  data: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

@Injectable()
export class AutomationPerformanceService {
  private readonly logger = new Logger(AutomationPerformanceService.name);

  constructor(private prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────
  // 1. SYNC OUTCOMES — cross-reference sequences with lead status
  // ─────────────────────────────────────────────────────────

  async syncOutcomes(): Promise<{ updated: number }> {
    let updated = 0;
    const sequences = await this.prisma.followUpSequence.findMany({
      select: { id: true, leadId: true, meetingBooked: true, dealCreated: true, dealClosed: true, revenueGenerated: true },
    });

    for (const seq of sequences) {
      const lead = await this.prisma.lead.findUnique({
        where: { id: seq.leadId },
        select: { status: true, estimatedValue: true },
      });
      if (!lead) continue;

      const data: any = {};
      if (!seq.meetingBooked && MEETING_STAGES.includes(lead.status)) {
        data.meetingBooked = true;
        data.meetingAt = new Date();
      }
      if (!seq.dealCreated && DEAL_STAGES.includes(lead.status)) {
        data.dealCreated = true;
        data.dealCreatedAt = new Date();
        data.dealStageReached = lead.status;
      }
      if (!seq.dealClosed && CLOSED_STAGES.includes(lead.status)) {
        data.dealClosed = true;
        data.dealClosedAt = new Date();
        data.revenueGenerated = lead.estimatedValue || 0;
      }
      // Update stage even if already tracked
      if (DEAL_STAGES.includes(lead.status)) {
        data.dealStageReached = lead.status;
      }

      if (Object.keys(data).length > 0) {
        await this.prisma.followUpSequence.update({ where: { id: seq.id }, data });
        updated++;
      }
    }

    this.logger.log(`Synced outcomes for ${updated} sequences`);
    return { updated };
  }

  // ─────────────────────────────────────────────────────────
  // 2. FULL FUNNEL DASHBOARD
  // ─────────────────────────────────────────────────────────

  async getPerformanceDashboard(): Promise<{
    overall: FunnelMetrics;
    byChannel: BreakdownEntry[];
    byTrigger: BreakdownEntry[];
    byAdvisor: BreakdownEntry[];
    byZone: BreakdownEntry[];
    byIndustry: BreakdownEntry[];
    byCampaign: BreakdownEntry[];
    topSequences: SequenceRanking[];
    worstSequences: SequenceRanking[];
    alerts: AlertEntry[];
    recommendations: Recommendation[];
  }> {
    // Sync outcomes first
    await this.syncOutcomes();

    const sequences = await this.prisma.followUpSequence.findMany({
      include: {
        steps: { select: { id: true, channel: true, status: true, wasOpened: true, wasReplied: true, ledToAdvance: true, sentAt: true, tone: true, stepNumber: true, templateKey: true, messageBody: true, abTestId: true, abVariant: true } },
      },
    });

    // Get advisor names
    const advisorIds = [...new Set(sequences.map((s) => s.advisorId))];
    const advisors = advisorIds.length > 0
      ? await this.prisma.user.findMany({ where: { id: { in: advisorIds }, isActive: true }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const advisorMap = new Map(advisors.map((a) => [a.id, `${a.firstName} ${a.lastName}`]));

    // Overall funnel
    const overall = this.computeFunnel(sequences);

    // Breakdowns
    const byChannel = this.breakdownByDimension(sequences, (seq) => {
      const channels = new Set<string>(seq.steps.filter((s: any) => s.sentAt).map((s: any) => s.channel));
      return Array.from(channels);
    }, (ch) => CHANNEL_LABELS[ch]?.label || ch);

    const byTrigger = this.breakdownByDimension(sequences, (seq) => [seq.trigger],
      (t) => TRIGGER_LABELS[t] || t);

    const byAdvisor = this.breakdownByDimension(sequences, (seq) => [seq.advisorId],
      (id) => advisorMap.get(id) || id);

    const byZone = this.breakdownByDimension(sequences, (seq) => seq.zone ? [seq.zone] : [],
      (z) => z);

    const byIndustry = this.breakdownByDimension(sequences, (seq) => seq.industry ? [seq.industry] : ['Sin industria'],
      (i) => i);

    const byCampaign = this.breakdownByDimension(sequences, (seq) => seq.campaignSource ? [seq.campaignSource] : ['Sin campaña'],
      (c) => c);

    // Rankings
    const ranked = this.rankSequences(sequences, advisorMap);
    const topSequences = ranked.slice(0, 10);
    const worstSequences = ranked.filter((r) => r.stepsSent >= 2).reverse().slice(0, 10);

    // Alerts & recommendations
    const alerts = await this.getAlerts();
    const recommendations = this.generateRecommendations(overall, byChannel, byTrigger, ranked);

    return { overall, byChannel, byTrigger, byAdvisor, byZone, byIndustry, byCampaign, topSequences, worstSequences, alerts, recommendations };
  }

  // ─────────────────────────────────────────────────────────
  // 3. COMPUTE FUNNEL
  // ─────────────────────────────────────────────────────────

  private computeFunnel(sequences: any[]): FunnelMetrics {
    let sent = 0, delivered = 0, replied = 0, meetings = 0, deals = 0, closed = 0, revenue = 0;

    for (const seq of sequences) {
      for (const step of seq.steps) {
        if (['sent', 'delivered', 'opened', 'replied'].includes(step.status)) sent++;
        if (step.status !== 'pending' && step.status !== 'failed' && step.status !== 'cancelled' && step.status !== 'skipped') delivered++;
        if (step.wasReplied) replied++;
      }
      if (seq.meetingBooked) meetings++;
      if (seq.dealCreated) deals++;
      if (seq.dealClosed) { closed++; revenue += seq.revenueGenerated || 0; }
    }

    return {
      messagesSent: sent,
      messagesDelivered: delivered,
      responsesReceived: replied,
      meetingsGenerated: meetings,
      dealsCreated: deals,
      dealsClosed: closed,
      revenueGenerated: revenue,
      responseRate: sent > 0 ? (replied / sent) * 100 : 0,
      conversionToMeeting: sequences.length > 0 ? (meetings / sequences.length) * 100 : 0,
      conversionToDeal: sequences.length > 0 ? (deals / sequences.length) * 100 : 0,
      conversionToClose: sequences.length > 0 ? (closed / sequences.length) * 100 : 0,
      roi: 0, // Will be computed when cost data is available
    };
  }

  private breakdownByDimension(
    sequences: any[],
    keyExtractor: (seq: any) => string[],
    labelFn: (key: string) => string,
  ): BreakdownEntry[] {
    const groups = new Map<string, any[]>();

    for (const seq of sequences) {
      const keys = keyExtractor(seq);
      for (const key of keys) {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(seq);
      }
    }

    return Array.from(groups.entries())
      .map(([key, seqs]) => ({
        key,
        label: labelFn(key),
        ...this.computeFunnel(seqs),
      }))
      .sort((a, b) => b.messagesSent - a.messagesSent);
  }

  // ─────────────────────────────────────────────────────────
  // 4. SEQUENCE RANKING
  // ─────────────────────────────────────────────────────────

  private rankSequences(sequences: any[], advisorMap: Map<string, string>): SequenceRanking[] {
    return sequences.map((seq) => {
      const sentSteps = seq.steps.filter((s: any) => s.sentAt);
      const replied = seq.steps.some((s: any) => s.wasReplied);
      const primaryChannel = sentSteps.length > 0 ? sentSteps[0].channel : 'unknown';

      // Score: weighted by funnel progression
      let score = 0;
      if (sentSteps.length > 0) score += 5;
      if (replied) score += 20;
      if (seq.meetingBooked) score += 25;
      if (seq.dealCreated) score += 25;
      if (seq.dealClosed) score += 25;

      return {
        id: seq.id,
        trigger: seq.trigger,
        triggerLabel: TRIGGER_LABELS[seq.trigger] || seq.trigger,
        leadName: seq.leadName,
        companyName: seq.companyName,
        zone: seq.zone,
        advisorName: advisorMap.get(seq.advisorId) || null,
        channel: primaryChannel,
        stepsSent: sentSteps.length,
        totalSteps: seq.maxSteps,
        wasReplied: replied,
        meetingBooked: seq.meetingBooked,
        dealCreated: seq.dealCreated,
        dealClosed: seq.dealClosed,
        revenueGenerated: seq.revenueGenerated,
        estimatedValue: seq.estimatedValue,
        score,
        startedAt: seq.startedAt.toISOString(),
      };
    }).sort((a, b) => b.score - a.score);
  }

  // ─────────────────────────────────────────────────────────
  // 5. MESSAGE PERFORMANCE RANKING
  // ─────────────────────────────────────────────────────────

  async getMessageRanking(): Promise<MessageRanking[]> {
    const steps = await this.prisma.followUpStep.findMany({
      where: { sentAt: { not: null } },
      select: {
        channel: true, tone: true, stepNumber: true, templateKey: true, messageBody: true,
        wasOpened: true, wasReplied: true, ledToAdvance: true,
        sequence: { select: { trigger: true } },
      },
    });

    // Group by templateKey or by (trigger+channel+step+tone)
    const groups = new Map<string, { steps: any[]; sample: string }>();
    for (const s of steps) {
      const key = s.templateKey || `${s.sequence.trigger}_${s.channel}_step${s.stepNumber}_${s.tone}`;
      if (!groups.has(key)) groups.set(key, { steps: [], sample: s.messageBody });
      groups.get(key)!.steps.push(s);
    }

    return Array.from(groups.entries())
      .map(([key, { steps: grp, sample }]) => {
        const sent = grp.length;
        const opened = grp.filter((s) => s.wasOpened).length;
        const replied = grp.filter((s) => s.wasReplied).length;
        const advanced = grp.filter((s) => s.ledToAdvance).length;
        const openRate = sent > 0 ? (opened / sent) * 100 : 0;
        const replyRate = sent > 0 ? (replied / sent) * 100 : 0;
        const advanceRate = sent > 0 ? (advanced / sent) * 100 : 0;
        // Score: 20% open + 50% reply + 30% advance
        const score = Math.min(100, openRate * 0.2 + replyRate * 0.5 + advanceRate * 0.3);

        const first = grp[0];
        return {
          templateKey: key,
          channel: first.channel,
          trigger: first.sequence.trigger,
          tone: first.tone,
          stepNumber: first.stepNumber,
          sent, opened, replied, advanced,
          openRate: Math.round(openRate * 10) / 10,
          replyRate: Math.round(replyRate * 10) / 10,
          advanceRate: Math.round(advanceRate * 10) / 10,
          score: Math.round(score * 10) / 10,
          sampleBody: sample.substring(0, 200),
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  // ─────────────────────────────────────────────────────────
  // 6. A/B TESTING
  // ─────────────────────────────────────────────────────────

  async createABTest(data: {
    name: string; description?: string; trigger: string; channel: string; stepNumber: number;
    variantABody: string; variantASubject?: string; variantATone?: string;
    variantBBody: string; variantBSubject?: string; variantBTone?: string;
    minSampleSize?: number;
  }) {
    return this.prisma.aBTest.create({
      data: {
        name: data.name,
        description: data.description,
        trigger: data.trigger,
        channel: data.channel,
        stepNumber: data.stepNumber,
        variantABody: data.variantABody,
        variantASubject: data.variantASubject,
        variantATone: data.variantATone || 'consultative',
        variantBBody: data.variantBBody,
        variantBSubject: data.variantBSubject,
        variantBTone: data.variantBTone || 'consultative',
        minSampleSize: data.minSampleSize || 30,
      },
    });
  }

  async getABTests(): Promise<ABTestResult[]> {
    const tests = await this.prisma.aBTest.findMany({ orderBy: { createdAt: 'desc' } });

    return tests.map((t) => {
      const aOpenRate = t.aSent > 0 ? (t.aOpened / t.aSent) * 100 : 0;
      const aReplyRate = t.aSent > 0 ? (t.aReplied / t.aSent) * 100 : 0;
      const aConvRate = t.aSent > 0 ? (t.aConverted / t.aSent) * 100 : 0;
      const bOpenRate = t.bSent > 0 ? (t.bOpened / t.bSent) * 100 : 0;
      const bReplyRate = t.bSent > 0 ? (t.bReplied / t.bSent) * 100 : 0;
      const bConvRate = t.bSent > 0 ? (t.bConverted / t.bSent) * 100 : 0;

      // Simple statistical significance (z-test approximation)
      const totalSent = t.aSent + t.bSent;
      const significant = totalSent >= t.minSampleSize * 2 && Math.abs(aReplyRate - bReplyRate) > 5;

      let recommendation = 'Se necesitan mas datos para determinar un ganador.';
      if (significant) {
        const better = aReplyRate > bReplyRate ? 'A' : 'B';
        recommendation = `Variante ${better} tiene mejor rendimiento. Considere adoptarla como default.`;
      }

      return {
        id: t.id, name: t.name, status: t.status, trigger: t.trigger, channel: t.channel, stepNumber: t.stepNumber,
        variantA: { body: t.variantABody, tone: t.variantATone, sent: t.aSent, opened: t.aOpened, replied: t.aReplied, converted: t.aConverted, openRate: Math.round(aOpenRate * 10) / 10, replyRate: Math.round(aReplyRate * 10) / 10, convRate: Math.round(aConvRate * 10) / 10 },
        variantB: { body: t.variantBBody, tone: t.variantBTone, sent: t.bSent, opened: t.bOpened, replied: t.bReplied, converted: t.bConverted, openRate: Math.round(bOpenRate * 10) / 10, replyRate: Math.round(bReplyRate * 10) / 10, convRate: Math.round(bConvRate * 10) / 10 },
        winner: t.winner, winnerConfidence: t.winnerConfidence,
        statisticallySignificant: significant,
        recommendation,
      };
    });
  }

  async recordABEvent(testId: string, variant: 'A' | 'B', event: 'sent' | 'opened' | 'replied' | 'converted') {
    const field = variant === 'A'
      ? { sent: 'aSent', opened: 'aOpened', replied: 'aReplied', converted: 'aConverted' }[event]
      : { sent: 'bSent', opened: 'bOpened', replied: 'bReplied', converted: 'bConverted' }[event];
    if (!field) return;

    const test = await this.prisma.aBTest.findUnique({ where: { id: testId } });
    if (!test || test.status !== 'active') return;

    await this.prisma.aBTest.update({
      where: { id: testId },
      data: { [field]: (test as any)[field] + 1 },
    });

    // Check if we can declare a winner
    const updated = await this.prisma.aBTest.findUnique({ where: { id: testId } });
    if (updated && updated.aSent >= updated.minSampleSize && updated.bSent >= updated.minSampleSize) {
      const aRate = updated.aSent > 0 ? updated.aReplied / updated.aSent : 0;
      const bRate = updated.bSent > 0 ? updated.bReplied / updated.bSent : 0;
      if (Math.abs(aRate - bRate) > 0.05) { // 5% difference threshold
        const winner = aRate > bRate ? 'A' : 'B';
        const confidence = Math.min(0.95, 0.5 + Math.abs(aRate - bRate) * 2);
        await this.prisma.aBTest.update({
          where: { id: testId },
          data: { winner, winnerConfidence: confidence, status: 'winner_selected' },
        });
      }
    }
  }

  async selectWinner(testId: string, winner: 'A' | 'B') {
    return this.prisma.aBTest.update({
      where: { id: testId },
      data: { winner, status: 'winner_selected', winnerConfidence: 1.0 },
    });
  }

  // ─────────────────────────────────────────────────────────
  // 7. PERFORMANCE ALERTS
  // ─────────────────────────────────────────────────────────

  async generateAlerts(): Promise<{ generated: number }> {
    const sequences = await this.prisma.followUpSequence.findMany({
      include: { steps: { select: { channel: true, status: true, wasReplied: true, sentAt: true, stepNumber: true } } },
    });
    const generated: any[] = [];

    // -- Alert: Low response rate by channel
    const channels = ['whatsapp', 'sms', 'email'];
    for (const ch of channels) {
      const chSteps = sequences.flatMap((s) => s.steps).filter((s) => s.channel === ch && s.sentAt);
      const sent = chSteps.length;
      const replied = chSteps.filter((s) => s.wasReplied).length;
      const rate = sent > 0 ? (replied / sent) * 100 : 0;

      if (sent >= 10 && rate < THRESHOLDS.lowResponseRate) {
        generated.push({
          type: 'low_response_rate', severity: rate < 1 ? 'critical' : 'high',
          dimension: 'channel', dimensionId: ch,
          title: `Tasa de respuesta baja en ${CHANNEL_LABELS[ch]?.label || ch}`,
          message: `El canal ${CHANNEL_LABELS[ch]?.label || ch} tiene solo ${rate.toFixed(1)}% de respuesta con ${sent} mensajes enviados. Muy por debajo del umbral de ${THRESHOLDS.lowResponseRate}%.`,
          recommendation: `Considere: 1) Revisar los mensajes de ${ch} 2) Cambiar el horario de envio 3) Probar tonos diferentes con A/B testing`,
          metric: 'reply_rate', metricValue: rate, threshold: THRESHOLDS.lowResponseRate,
        });
      }
    }

    // -- Alert: Low conversion by trigger
    const triggers = ['new_lead', 'no_response', 'stalled_deal', 'cold_lead', 'reactivation'];
    for (const trigger of triggers) {
      const triggerSeqs = sequences.filter((s) => s.trigger === trigger);
      const total = triggerSeqs.length;
      const meetings = triggerSeqs.filter((s) => s.meetingBooked).length;
      const convRate = total > 0 ? (meetings / total) * 100 : 0;

      if (total >= 5 && convRate < THRESHOLDS.lowConversion) {
        generated.push({
          type: 'low_conversion', severity: 'high',
          dimension: 'trigger', dimensionId: trigger,
          title: `Baja conversion en secuencias de ${TRIGGER_LABELS[trigger] || trigger}`,
          message: `Solo ${convRate.toFixed(1)}% de las ${total} secuencias de "${TRIGGER_LABELS[trigger]}" generaron una reunion. Se necesita optimizar.`,
          recommendation: `Acciones: 1) Mejorar personalizacion del mensaje 2) Ajustar timing de la secuencia 3) Escalar mas rapido a llamada directa`,
          metric: 'conversion_to_meeting', metricValue: convRate, threshold: THRESHOLDS.lowConversion,
        });
      }
    }

    // -- Alert: High drop-off between steps
    for (const trigger of triggers) {
      const triggerSeqs = sequences.filter((s) => s.trigger === trigger);
      const step1Sent = triggerSeqs.flatMap((s) => s.steps).filter((s) => s.stepNumber === 1 && s.sentAt).length;
      const step2Sent = triggerSeqs.flatMap((s) => s.steps).filter((s) => s.stepNumber === 2 && s.sentAt).length;
      const dropoff = step1Sent > 0 ? ((step1Sent - step2Sent) / step1Sent) * 100 : 0;

      if (step1Sent >= 10 && dropoff > THRESHOLDS.highDropoff) {
        generated.push({
          type: 'high_dropoff', severity: 'medium',
          dimension: 'trigger', dimensionId: trigger,
          title: `Alto abandono en secuencias de ${TRIGGER_LABELS[trigger] || trigger}`,
          message: `${dropoff.toFixed(0)}% de las secuencias se detienen antes del paso 2. Esto puede indicar que el paso 1 no genera suficiente engagement.`,
          recommendation: `Mejore el mensaje inicial, pruebe diferentes canales en paso 1, o acorte el tiempo entre paso 1 y 2.`,
          metric: 'step_dropoff', metricValue: dropoff, threshold: THRESHOLDS.highDropoff,
        });
      }
    }

    // -- Alert: Stalled sequences
    const now = new Date();
    const overdueActive = sequences.filter((s) =>
      s.status === 'active' && s.nextActionAt && new Date(s.nextActionAt) < new Date(now.getTime() - 48 * 3600000)
    );
    if (overdueActive.length >= THRESHOLDS.stalledSequences) {
      generated.push({
        type: 'stalled_sequences', severity: 'high',
        dimension: null, dimensionId: null,
        title: `${overdueActive.length} secuencias estancadas`,
        message: `Hay ${overdueActive.length} secuencias activas cuyo proximo paso esta vencido por mas de 48 horas. El sistema de ejecucion puede necesitar atencion.`,
        recommendation: `Ejecute el motor de Follow-Up para procesar los pasos pendientes, o revise si hay errores de integracion.`,
        metric: 'stalled_count', metricValue: overdueActive.length, threshold: THRESHOLDS.stalledSequences,
      });
    }

    // Save alerts (skip duplicates from last 24h)
    const yesterday = new Date(now.getTime() - 24 * 3600000);
    let savedCount = 0;
    for (const alert of generated) {
      const existing = await this.prisma.automationAlert.findFirst({
        where: {
          type: alert.type,
          dimensionId: alert.dimensionId,
          createdAt: { gte: yesterday },
          status: { not: 'resolved' },
        },
      });
      if (!existing) {
        await this.prisma.automationAlert.create({ data: { ...alert, status: 'open' } });
        savedCount++;
      }
    }

    return { generated: savedCount };
  }

  async getAlerts(): Promise<AlertEntry[]> {
    const alerts = await this.prisma.automationAlert.findMany({
      where: { status: { not: 'resolved' } },
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
      take: 50,
    });

    // Re-order severity: critical first
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    alerts.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

    return alerts.map((a) => ({
      id: a.id, type: a.type, severity: a.severity, title: a.title,
      message: a.message, recommendation: a.recommendation,
      metric: a.metric, metricValue: a.metricValue, threshold: a.threshold,
      dimension: a.dimension, dimensionId: a.dimensionId, status: a.status,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  async resolveAlert(id: string) {
    return this.prisma.automationAlert.update({
      where: { id },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
  }

  async dismissAlert(id: string) {
    return this.prisma.automationAlert.update({
      where: { id },
      data: { status: 'dismissed' },
    });
  }

  // ─────────────────────────────────────────────────────────
  // 8. RECOMMENDATION ENGINE
  // ─────────────────────────────────────────────────────────

  private generateRecommendations(
    overall: FunnelMetrics,
    byChannel: BreakdownEntry[],
    byTrigger: BreakdownEntry[],
    ranked: SequenceRanking[],
  ): Recommendation[] {
    const recs: Recommendation[] = [];

    // -- Which messages to improve
    const lowReplyChannels = byChannel.filter((c) => c.messagesSent >= 5 && c.responseRate < 5);
    for (const ch of lowReplyChannels) {
      recs.push({
        type: 'improve_message', priority: 'high',
        title: `Mejorar mensajes de ${ch.label}`,
        description: `El canal ${ch.label} tiene solo ${ch.responseRate.toFixed(1)}% de respuesta. Los mensajes no estan generando engagement.`,
        impact: `${ch.messagesSent} mensajes enviados sin resultado.`,
        action: `Cree un A/B test para ${ch.key} comparando diferentes tonos y contenidos.`,
        data: { channel: ch.key, responseRate: ch.responseRate, sent: ch.messagesSent },
      });
    }

    // Low-performing triggers
    const lowTriggers = byTrigger.filter((t) => t.messagesSent >= 5 && t.conversionToMeeting < 2);
    for (const t of lowTriggers) {
      recs.push({
        type: 'improve_message', priority: 'medium',
        title: `Optimizar secuencia "${t.label}"`,
        description: `Las secuencias de ${t.label} tienen ${t.conversionToMeeting.toFixed(1)}% conversion a reunion. Necesitan mejor personalizacion.`,
        impact: `${t.messagesSent} msgs enviados, solo ${t.meetingsGenerated} reuniones.`,
        action: `Revise el timing, ajuste el tono segun la etapa, y pruebe con llamada directa en paso 2.`,
        data: { trigger: t.key, convRate: t.conversionToMeeting },
      });
    }

    // -- Which channels to prioritize
    const channelsByReply = [...byChannel].sort((a, b) => b.responseRate - a.responseRate);
    if (channelsByReply.length >= 2 && channelsByReply[0].responseRate > channelsByReply[channelsByReply.length - 1].responseRate * 2) {
      const best = channelsByReply[0];
      recs.push({
        type: 'prioritize_channel', priority: 'high',
        title: `Priorizar ${best.label}`,
        description: `${best.label} tiene ${best.responseRate.toFixed(1)}% de respuesta — significativamente mejor que otros canales.`,
        impact: `Duplicar uso de ${best.label} podria incrementar respuestas en un ${Math.round(best.responseRate)}%.`,
        action: `Configure ${best.label} como canal principal en todas las secuencias.`,
        data: { channel: best.key, rate: best.responseRate },
      });
    }

    // -- Which sequences to scale
    const highPerformers = ranked.filter((r) => r.score >= 50);
    if (highPerformers.length > 0) {
      const topTriggers = [...new Set(highPerformers.map((r) => r.trigger))];
      for (const trigger of topTriggers) {
        const count = highPerformers.filter((r) => r.trigger === trigger).length;
        recs.push({
          type: 'scale_sequence', priority: 'medium',
          title: `Escalar secuencias de "${TRIGGER_LABELS[trigger] || trigger}"`,
          description: `${count} secuencias de este tipo han generado reuniones o deals. El modelo funciona.`,
          impact: `Potencial de escalar a mas leads del mismo tipo.`,
          action: `Aumente la prioridad de enrollment para leads tipo "${trigger}" y reduzca delays entre pasos.`,
          data: { trigger, highPerformers: count },
        });
      }
    }

    // -- Fix drop-offs
    if (overall.messagesSent > 0 && overall.responseRate < 3) {
      recs.push({
        type: 'fix_dropoff', priority: 'critical',
        title: 'Tasa de respuesta general critica',
        description: `Solo ${overall.responseRate.toFixed(1)}% de respuesta general con ${overall.messagesSent} mensajes enviados.`,
        impact: 'El sistema de automatizacion no esta generando engagement. Requiere atencion inmediata.',
        action: '1) Revise todos los templates 2) Pruebe horarios diferentes 3) Aumente personalizacion 4) Considere reducir frecuencia',
        data: { rate: overall.responseRate, sent: overall.messagesSent },
      });
    }

    // -- Stop underperformers
    const zeroResult = ranked.filter((r) => r.stepsSent >= 3 && r.score === 5 && !r.wasReplied);
    if (zeroResult.length >= 3) {
      recs.push({
        type: 'stop_underperformer', priority: 'medium',
        title: `${zeroResult.length} secuencias sin resultado despues de 3+ pasos`,
        description: `Hay secuencias con 3 o mas mensajes enviados sin ninguna respuesta. Considere detenerlas.`,
        impact: `Liberar recursos y evitar sobre-contacto a leads no interesados.`,
        action: `Detenga secuencias de bajo rendimiento y reasigne esfuerzo a leads mas prometedores.`,
        data: { count: zeroResult.length },
      });
    }

    // Sort by priority
    const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2 };
    recs.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));

    return recs;
  }

  // ─────────────────────────────────────────────────────────
  // 9. SEQUENCE OUTCOME TRACKING (manual)
  // ─────────────────────────────────────────────────────────

  async recordMeeting(sequenceId: string) {
    return this.prisma.followUpSequence.update({
      where: { id: sequenceId },
      data: { meetingBooked: true, meetingAt: new Date() },
    });
  }

  async recordDeal(sequenceId: string) {
    return this.prisma.followUpSequence.update({
      where: { id: sequenceId },
      data: { dealCreated: true, dealCreatedAt: new Date() },
    });
  }

  async recordClose(sequenceId: string, revenue: number) {
    return this.prisma.followUpSequence.update({
      where: { id: sequenceId },
      data: { dealClosed: true, dealClosedAt: new Date(), revenueGenerated: revenue },
    });
  }
}
