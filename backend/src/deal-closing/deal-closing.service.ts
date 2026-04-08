import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';

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

/** Stages considered "closing pipeline" */
const CLOSING_STAGES = [
  'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO',
  'PENDIENTE_PAGO',
];

/** All stages in closing funnel (including pre-close) */
const LATE_PIPELINE_STAGES = [
  'ESPERANDO_COTIZACION',
  'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO',
  'PENDIENTE_PAGO',
];

const TERMINAL_STATUSES = ['CERRADO_GANADO', 'CERRADO_PERDIDO', 'LEAD_BASURA', 'CONTACTAR_FUTURO'];

/** Stage order for progression tracking */
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
};

/** Closing probability per stage */
const STAGE_PROBABILITY: Record<string, number> = {
  ESPERANDO_COTIZACION: 0.40,
  COTIZACION_ENTREGADA: 0.55,
  ESPERANDO_CONTRATO: 0.75,
  PENDIENTE_PAGO: 0.90,
};

/** Stage labels in Spanish */
const STAGE_LABELS: Record<string, string> = {
  ESPERANDO_COTIZACION: 'Esperando Cotizacion',
  COTIZACION_ENTREGADA: 'Cotizacion Entregada',
  ESPERANDO_CONTRATO: 'Esperando Contrato',
  PENDIENTE_PAGO: 'Pendiente de Pago',
  CERRADO_GANADO: 'Cerrado Ganado',
  CERRADO_PERDIDO: 'Cerrado Perdido',
};

const HIGH_VALUE_THRESHOLD = 200_000;
const CRITICAL_VALUE_THRESHOLD = 500_000;

// ═══════════════════════════════════════════════════════════
// CLOSING PLAYBOOK — Stage-based actions
// ═══════════════════════════════════════════════════════════

interface PlaybookAction {
  action: string;
  channel: string;
  script: string;
  guidance: string;
  priority: 'critical' | 'high' | 'medium';
}

const CLOSING_PLAYBOOK: Record<string, PlaybookAction[]> = {
  COTIZACION_ENTREGADA: [
    {
      action: 'Seguimiento de cotizacion',
      channel: 'phone',
      script: 'Hola {contactName}, le llamo para dar seguimiento a la cotizacion que le enviamos para {companyName}. Queria saber si tuvo oportunidad de revisarla y si tiene alguna duda sobre los paneles, la instalacion o el financiamiento.',
      guidance: 'Objetivo: resolver dudas y avanzar a contrato. Escuchar objeciones activamente. Si menciona precio, ofrecer opciones de financiamiento.',
      priority: 'high',
    },
    {
      action: 'Aclarar dudas tecnicas',
      channel: 'whatsapp',
      script: 'Hola {contactName}! Queria confirmar que haya recibido la cotizacion de su proyecto solar. Si tiene cualquier duda sobre especificaciones tecnicas, garantias o ahorro proyectado, con gusto le explico. Saludos, {advisorName}.',
      guidance: 'Enviar si no contesta llamada. Adjuntar comparativo de ahorro si aplica.',
      priority: 'medium',
    },
    {
      action: 'Enviar caso de exito similar',
      channel: 'email',
      script: 'Estimado {contactName}, le comparto un caso de exito de un proyecto similar al suyo en {zone}. [Adjuntar caso]. Estos resultados se pueden replicar en {companyName}. Quedo atento para agendar una llamada y resolver cualquier duda.',
      guidance: 'Usar cuando el prospecto esta indeciso. El social proof acelera la decision.',
      priority: 'medium',
    },
  ],
  ESPERANDO_CONTRATO: [
    {
      action: 'Presionar firma de contrato',
      channel: 'phone',
      script: 'Hola {contactName}, le llamo sobre el contrato de {companyName}. Ya tenemos todo listo para iniciar el proyecto. Solo necesitamos la firma para reservar su fecha de instalacion. Tenemos buena disponibilidad esta semana.',
      guidance: 'Crear urgencia con disponibilidad de instalacion. Mencionar que los precios pueden cambiar. Ofrecer facilitar firma digital.',
      priority: 'critical',
    },
    {
      action: 'Enviar contrato digital',
      channel: 'whatsapp',
      script: 'Hola {contactName}! Le envio el contrato para su proyecto en {companyName}. Puede firmarlo digitalmente desde su celular. Si necesita algun ajuste, digame y lo actualizamos hoy mismo. Saludos, {advisorName}.',
      guidance: 'Facilitar al maximo el proceso. Enviar link de firma digital. Dar seguimiento en 24h si no firma.',
      priority: 'high',
    },
  ],
  PENDIENTE_PAGO: [
    {
      action: 'Confirmar transferencia de pago',
      channel: 'phone',
      script: 'Hola {contactName}, le llamo para confirmar los detalles del pago de su proyecto en {companyName}. Ya tenemos el contrato firmado y solo falta el anticipo para reservar su fecha de instalacion. Le puedo enviar los datos bancarios ahora mismo.',
      guidance: 'Ser directo pero profesional. Ofrecer multiples metodos de pago. Si hay objecion de precio, NO renegociar sin autorizacion del director.',
      priority: 'critical',
    },
    {
      action: 'Recordatorio de pago',
      channel: 'whatsapp',
      script: 'Hola {contactName}! Un recordatorio amable sobre el anticipo de su proyecto solar en {companyName}. Le comparto nuevamente los datos bancarios: [DATOS]. Una vez recibido, programamos su instalacion. Cualquier duda estoy para servirle. {advisorName}.',
      guidance: 'Enviar si pasan 48h sin pago. Mantener tono amable pero firme. Si pasan 5+ dias, escalar a supervisor.',
      priority: 'high',
    },
    {
      action: 'Ofrecer incentivo de cierre',
      channel: 'phone',
      script: 'Hola {contactName}, le tengo una excelente noticia. Si procesamos el pago esta semana, podemos incluir [incentivo] sin costo adicional en su proyecto de {companyName}. Esta promocion es por tiempo limitado.',
      guidance: 'SOLO usar con autorizacion del director. Usar como ultimo recurso para deals de alto valor estancados 5+ dias.',
      priority: 'medium',
    },
  ],
};

// ═══════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════

export interface ScoredDeal {
  id: string;
  companyName: string;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  stage: string;
  stageLabel: string;
  estimatedValue: number;
  probability: number;
  weightedValue: number;
  advisorId: string | null;
  advisorName: string | null;
  zone: string;
  lastContactedAt: Date | null;
  daysSinceContact: number;
  daysInStage: number;
  closingScore: number;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  verdict: string;
  nextActions: PlaybookAction[];
  risks: string[];
}

export interface WeeklyClosingPlan {
  weekOf: string;
  dealsToClose: ScoredDeal[];
  perAdvisor: Array<{
    advisorId: string;
    advisorName: string;
    deals: number;
    expectedRevenue: number;
    weightedRevenue: number;
    topDeal: string | null;
  }>;
  forecast: {
    totalPipeline: number;
    weightedForecast: number;
    weeklyTarget: number;
    revenueGap: number;
    closingRate: number;
    dealsAtRisk: number;
  };
  actionsRequired: string[];
}

export interface DailyClosingTracker {
  date: string;
  dealsClosedToday: number;
  revenueClosedToday: number;
  dealsPushedToday: number;
  dealsLostToday: number;
  closingRate: number;
  weeklyProgress: {
    dealsClosedThisWeek: number;
    revenueThisWeek: number;
    weeklyTarget: number;
    pctComplete: number;
    remainingRevenue: number;
    remainingDeals: number;
  };
  recentActivity: Array<{
    lead: string;
    action: string;
    time: string;
    outcome: string;
  }>;
}

export interface DirectorClosingView {
  topDeals: ScoredDeal[];
  highValueAtRisk: ScoredDeal[];
  needsEscalation: ScoredDeal[];
  closingForecast: {
    thisWeek: number;
    thisMonth: number;
    weighted: number;
    pipeline: number;
  };
  teamSummary: Array<{
    advisorId: string;
    advisorName: string;
    pipelineValue: number;
    weightedValue: number;
    closedThisMonth: number;
    deals: number;
    avgDaysToClose: number;
  }>;
  recommendations: string[];
}

export interface SupervisorClosingView {
  advisorPerformance: Array<{
    advisorId: string;
    advisorName: string;
    activeDeals: number;
    pipelineValue: number;
    closedThisWeek: number;
    closedRevenueWeek: number;
    overdueFollowUps: number;
    avgDaysInStage: number;
    closingGaps: string[];
  }>;
  teamMetrics: {
    totalActiveDeals: number;
    totalPipeline: number;
    totalClosedWeek: number;
    teamClosingRate: number;
    avgDaysToClose: number;
    dealsNeedingPressure: number;
  };
  actionItems: string[];
}

export interface ClosingAgentResult {
  cycleId: string;
  startedAt: string;
  completedAt: string;
  duration: number;
  dealsAnalyzed: number;
  tasksCreated: number;
  alertsCreated: number;
  escalations: number;
  topDeals: Array<{ company: string; value: number; verdict: string }>;
}

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

@Injectable()
export class DealClosingService {
  private readonly log = new Logger(DealClosingService.name);
  private lastAgentResult: ClosingAgentResult | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════
  // 1. CLOSING PRIORITY ENGINE — Score and rank deals
  // ═══════════════════════════════════════════════════════════

  async getClosingPipeline(): Promise<ScoredDeal[]> {
    const deals = await this.prisma.lead.findMany({
      where: {
        status: { in: LATE_PIPELINE_STAGES as any },
        deletedAt: null,
        isHistorical: false,
      },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { estimatedValue: 'desc' },
    });

    const now = new Date();
    const scored: ScoredDeal[] = [];

    for (const deal of deals) {
      const value = deal.estimatedValue || 0;
      const probability = STAGE_PROBABILITY[deal.status] || 0.3;
      const daysSinceContact = deal.lastContactedAt
        ? Math.floor((now.getTime() - new Date(deal.lastContactedAt).getTime()) / 86400000)
        : 999;
      const daysInStage = Math.floor(
        (now.getTime() - new Date(deal.updatedAt).getTime()) / 86400000,
      );

      // Score calculation (0-100)
      let score = 0;

      // Value component (0-30)
      if (value >= CRITICAL_VALUE_THRESHOLD) score += 30;
      else if (value >= HIGH_VALUE_THRESHOLD) score += 22;
      else if (value >= 100_000) score += 15;
      else if (value >= 50_000) score += 10;
      else score += 5;

      // Stage component (0-25) — later stages score higher
      const stageScores: Record<string, number> = {
        ESPERANDO_COTIZACION: 8,
        COTIZACION_ENTREGADA: 15,
        ESPERANDO_CONTRATO: 22,
        PENDIENTE_PAGO: 25,
      };
      score += stageScores[deal.status] || 0;

      // Probability boost (0-15)
      score += Math.round(probability * 15);

      // Inactivity penalty/urgency (0-20)
      if (daysSinceContact >= 5) score += 20;
      else if (daysSinceContact >= 3) score += 15;
      else if (daysSinceContact >= 2) score += 10;
      else score += 3;

      // Time in stage urgency (0-10)
      if (daysInStage >= 14) score += 10;
      else if (daysInStage >= 7) score += 7;
      else if (daysInStage >= 3) score += 4;

      score = Math.min(100, score);

      // Urgency level
      let urgency: 'critical' | 'high' | 'medium' | 'low';
      if (score >= 80 || (value >= CRITICAL_VALUE_THRESHOLD && daysSinceContact >= 2)) {
        urgency = 'critical';
      } else if (score >= 60 || (value >= HIGH_VALUE_THRESHOLD && daysSinceContact >= 3)) {
        urgency = 'high';
      } else if (score >= 40) {
        urgency = 'medium';
      } else {
        urgency = 'low';
      }

      // Verdict
      let verdict: string;
      if (deal.status === 'PENDIENTE_PAGO' && daysSinceContact <= 2) {
        verdict = 'Cerrar este deal esta semana';
      } else if (probability >= 0.7 && daysSinceContact <= 3) {
        verdict = 'Alta probabilidad de cierre';
      } else if (daysSinceContact >= 5) {
        verdict = 'Seguimiento urgente requerido';
      } else if (value >= CRITICAL_VALUE_THRESHOLD) {
        verdict = 'Deal de alto valor — priorizar';
      } else if (daysInStage >= 14) {
        verdict = 'Deal estancado — intervenir';
      } else if (probability >= 0.5) {
        verdict = 'Buen avance — mantener presion';
      } else {
        verdict = 'Monitorear y dar seguimiento';
      }

      // Risks
      const risks: string[] = [];
      if (daysSinceContact >= 5) risks.push(`${daysSinceContact} dias sin contacto — riesgo de enfriamiento`);
      if (daysInStage >= 14) risks.push(`${daysInStage} dias en ${STAGE_LABELS[deal.status] ?? deal.status} — deal estancado`);
      if (!deal.assignedToId) risks.push('Sin asesor asignado');
      if (value >= HIGH_VALUE_THRESHOLD && daysSinceContact >= 3) risks.push('Deal de alto valor sin seguimiento reciente');
      if (deal.status === 'PENDIENTE_PAGO' && daysSinceContact >= 3) risks.push('Pago pendiente sin confirmacion — escalar');

      // Get playbook actions for this stage
      const nextActions = CLOSING_PLAYBOOK[deal.status] || [];
      // Personalize scripts
      const advisorName = deal.assignedTo
        ? `${deal.assignedTo.firstName} ${deal.assignedTo.lastName}`
        : 'Tu asesor en IEA';
      const personalizedActions = nextActions.map((a: any) => ({
        ...a,
        script: a.script
          .replace(/{contactName}/g, deal.contactName)
          .replace(/{companyName}/g, deal.companyName)
          .replace(/{advisorName}/g, advisorName)
          .replace(/{zone}/g, deal.zone || 'la zona'),
      }));

      scored.push({
        id: deal.id,
        companyName: deal.companyName,
        contactName: deal.contactName,
        contactPhone: deal.contactPhone,
        contactEmail: deal.contactEmail,
        stage: deal.status,
        stageLabel: STAGE_LABELS[deal.status] ?? deal.status,
        estimatedValue: value,
        probability,
        weightedValue: Math.round(value * probability),
        advisorId: deal.assignedToId,
        advisorName: deal.assignedTo ? `${deal.assignedTo.firstName} ${deal.assignedTo.lastName}` : null,
        zone: deal.zone,
        lastContactedAt: deal.lastContactedAt,
        daysSinceContact,
        daysInStage,
        closingScore: score,
        urgency,
        verdict,
        nextActions: personalizedActions,
        risks,
      });
    }

    // Sort by closing score descending
    scored.sort((a: any, b: any) => b.closingScore - a.closingScore);
    return scored;
  }

  // ═══════════════════════════════════════════════════════════
  // 2. CLOSING AGENT — Autonomous deal pusher (cron)
  // ═══════════════════════════════════════════════════════════

  @Cron('0 30 8-18 * * 1-6')
  async runClosingAgent(): Promise<ClosingAgentResult> {
    const start = Date.now();
    const cycleId = `closing-${Date.now()}`;
    this.log.log(`[${cycleId}] Closing Agent starting...`);

    const pipeline = await this.getClosingPipeline();
    let tasksCreated = 0;
    let alertsCreated = 0;
    let escalations = 0;

    for (const deal of pipeline) {
      // Skip deals without advisor
      if (!deal.advisorId) continue;

      // Check if there's already a pending closing task for this deal
      const existingTask = await this.prisma.salesTask.findFirst({
        where: {
          leadId: deal.id,
          type: 'close_deal',
          status: 'pending',
          isHistorical: false,
        },
      });
      if (existingTask) continue;

      // --- CRITICAL & HIGH urgency: Create tasks + alerts ---
      if (deal.urgency === 'critical' || deal.urgency === 'high') {
        const topAction = deal.nextActions[0];
        const taskTitle = deal.urgency === 'critical'
          ? `🔥 CERRAR: ${deal.companyName} (${deal.stageLabel}) — $${Math.round(deal.estimatedValue).toLocaleString()}`
          : `⚡ Cierre: ${deal.companyName} (${deal.stageLabel}) — $${Math.round(deal.estimatedValue).toLocaleString()}`;

        await this.prisma.salesTask.create({
          data: {
            advisorId: deal.advisorId,
            leadId: deal.id,
            title: taskTitle,
            description: `${deal.verdict}\n\n${topAction ? `Accion recomendada: ${topAction.action}\nCanal: ${topAction.channel}\n\nScript:\n${topAction.script}\n\nGuia:\n${topAction.guidance}` : 'Contactar para avanzar al cierre.'}`,
            suggestion: deal.risks.length > 0 ? `Riesgos: ${deal.risks.join('. ')}` : undefined,
            type: 'close_deal',
            priority: deal.urgency,
            priorityScore: deal.closingScore,
            status: 'pending',
            dueDate: new Date(),
            source: 'automation',
            channel: topAction?.channel,
            zone: deal.zone,
            estimatedValue: deal.estimatedValue,
            leadStatus: deal.stage,
          },
        });
        tasksCreated++;

        // Create alert for critical deals
        if (deal.urgency === 'critical') {
          await this.prisma.salesAlert.create({
            data: {
              type: 'deal_stuck',
              severity: 'critical',
              leadId: deal.id,
              advisorId: deal.advisorId,
              title: `Deal critico: ${deal.companyName} — $${Math.round(deal.estimatedValue).toLocaleString()}`,
              message: `${deal.verdict}. ${deal.risks.join('. ')}. Valor: $${Math.round(deal.estimatedValue).toLocaleString()}, probabilidad: ${Math.round(deal.probability * 100)}%. ${deal.daysSinceContact}d sin contacto, ${deal.daysInStage}d en etapa.`,
              suggestion: topAction ? `${topAction.action} via ${topAction.channel}` : 'Contactar de inmediato',
              priorityScore: deal.closingScore,
              daysSinceActivity: deal.daysSinceContact,
              stageDuration: deal.daysInStage,
              riskOfLoss: Math.min(100, deal.daysSinceContact * 10 + (deal.daysInStage > 14 ? 30 : 0)),
              recommendedAction: topAction?.channel === 'phone' ? 'call' : 'message',
              estimatedValue: deal.estimatedValue,
              zone: deal.zone,
              status: 'open',
            },
          });
          alertsCreated++;
        }

        // Escalate to director for $500K+ deals inactive 3+ days
        if (deal.estimatedValue >= CRITICAL_VALUE_THRESHOLD && deal.daysSinceContact >= 3) {
          await this.prisma.salesAlert.create({
            data: {
              type: 'high_value_unattended',
              severity: 'critical',
              leadId: deal.id,
              advisorId: deal.advisorId,
              assignedToId: DIRECTOR_ID,
              title: `ESCALAR: ${deal.companyName} $${Math.round(deal.estimatedValue).toLocaleString()} — ${deal.daysSinceContact}d sin contacto`,
              message: `Deal de $${Math.round(deal.estimatedValue).toLocaleString()} en ${deal.stageLabel} sin contacto hace ${deal.daysSinceContact} dias. Asesor: ${deal.advisorName ?? 'Sin asignar'}. Requiere intervencion del director.`,
              suggestion: 'Intervenir directamente o reasignar deal a asesor mas agresivo.',
              priorityScore: 95,
              riskOfLoss: Math.min(100, 50 + deal.daysSinceContact * 10),
              estimatedValue: deal.estimatedValue,
              escalatedTo: 'director',
              status: 'open',
            },
          });
          escalations++;
        }
      }

      // --- MEDIUM urgency: Create task if value > 100K ---
      if (deal.urgency === 'medium' && deal.estimatedValue >= 100_000) {
        const topAction = deal.nextActions[0];
        await this.prisma.salesTask.create({
          data: {
            advisorId: deal.advisorId,
            leadId: deal.id,
            title: `📋 Seguimiento cierre: ${deal.companyName} — $${Math.round(deal.estimatedValue).toLocaleString()}`,
            description: topAction
              ? `${topAction.action}\n\nScript:\n${topAction.script}`
              : `Dar seguimiento para avanzar ${deal.companyName} al cierre.`,
            type: 'close_deal',
            priority: 'medium',
            priorityScore: deal.closingScore,
            status: 'pending',
            dueDate: new Date(Date.now() + 86400000), // tomorrow
            source: 'automation',
            channel: topAction?.channel,
            zone: deal.zone,
            estimatedValue: deal.estimatedValue,
            leadStatus: deal.stage,
          },
        });
        tasksCreated++;
      }
    }

    const result: ClosingAgentResult = {
      cycleId,
      startedAt: new Date(start).toISOString(),
      completedAt: new Date().toISOString(),
      duration: Date.now() - start,
      dealsAnalyzed: pipeline.length,
      tasksCreated,
      alertsCreated,
      escalations,
      topDeals: pipeline.slice(0, 10).map((d: any) => ({
        company: d.companyName,
        value: d.estimatedValue,
        verdict: d.verdict,
      })),
    };

    this.lastAgentResult = result;
    this.log.log(
      `[${cycleId}] Closing Agent done: ${pipeline.length} deals, ${tasksCreated} tasks, ${alertsCreated} alerts, ${escalations} escalations in ${result.duration}ms`,
    );
    return result;
  }

  // ═══════════════════════════════════════════════════════════
  // 3. CLOSING PLAYBOOK — Get actions for a specific deal
  // ═══════════════════════════════════════════════════════════

  async getDealPlaybook(leadId: string) {
    const deal = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!deal) return null;

    const advisorName = deal.assignedTo
      ? `${deal.assignedTo.firstName} ${deal.assignedTo.lastName}`
      : 'Tu asesor en IEA';

    const actions = (CLOSING_PLAYBOOK[deal.status] || []).map((a: any) => ({
      ...a,
      script: a.script
        .replace(/{contactName}/g, deal.contactName)
        .replace(/{companyName}/g, deal.companyName)
        .replace(/{advisorName}/g, advisorName)
        .replace(/{zone}/g, deal.zone || 'la zona'),
    }));

    return {
      leadId: deal.id,
      companyName: deal.companyName,
      contactName: deal.contactName,
      stage: deal.status,
      stageLabel: STAGE_LABELS[deal.status] ?? deal.status,
      estimatedValue: deal.estimatedValue || 0,
      actions,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 4. WEEKLY CLOSING PLAN
  // ═══════════════════════════════════════════════════════════

  async getWeeklyClosingPlan(): Promise<WeeklyClosingPlan> {
    const pipeline = await this.getClosingPipeline();
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // Monday
    weekStart.setHours(0, 0, 0, 0);

    // Weekly target: $2M (configurable)
    const weeklyTarget = 2_000_000;

    // Deals closed this week
    const closedThisWeek = await this.prisma.lead.findMany({
      where: {
        status: 'CERRADO_GANADO',
        convertedAt: { gte: weekStart },
        deletedAt: null,
        isHistorical: false,
      },
      select: { estimatedValue: true },
    });
    const closedRevenue = closedThisWeek.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0);

    // Per advisor breakdown
    const advisorMap = new Map<string, { name: string; deals: ScoredDeal[] }>();
    for (const deal of pipeline) {
      const key = deal.advisorId ?? 'unassigned';
      if (!advisorMap.has(key)) {
        advisorMap.set(key, { name: deal.advisorName ?? 'Sin asignar', deals: [] });
      }
      advisorMap.get(key)!.deals.push(deal);
    }

    const perAdvisor = Array.from(advisorMap.entries()).map(([id, data]) => ({
      advisorId: id,
      advisorName: data.name,
      deals: data.deals.length,
      expectedRevenue: Math.round(data.deals.reduce((s: any, d: any) => s + d.estimatedValue, 0)),
      weightedRevenue: Math.round(data.deals.reduce((s: any, d: any) => s + d.weightedValue, 0)),
      topDeal: data.deals[0]?.companyName ?? null,
    }));
    perAdvisor.sort((a: any, b: any) => b.weightedRevenue - a.weightedRevenue);

    const totalPipeline = pipeline.reduce((s: any, d: any) => s + d.estimatedValue, 0);
    const weightedForecast = pipeline.reduce((s: any, d: any) => s + d.weightedValue, 0);
    const dealsAtRisk = pipeline.filter((d: any) => d.daysSinceContact >= 5 || d.daysInStage >= 14).length;

    // Historical closing rate
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [closedMonth, lostMonth] = await Promise.all([
      this.prisma.lead.count({ where: { status: 'CERRADO_GANADO', isHistorical: false, convertedAt: { gte: monthStart } } }),
      this.prisma.lead.count({ where: { status: 'CERRADO_PERDIDO', isHistorical: false, updatedAt: { gte: monthStart } } }),
    ]);
    const closingRate = closedMonth + lostMonth > 0
      ? Math.round((closedMonth / (closedMonth + lostMonth)) * 100)
      : 0;

    // Action items
    const actions: string[] = [];
    const revenueGap = weeklyTarget - closedRevenue;
    if (revenueGap > 0) {
      actions.push(`Faltan $${Math.round(revenueGap).toLocaleString()} para meta semanal. Pipeline ponderado: $${Math.round(weightedForecast).toLocaleString()}.`);
    }
    const criticalDeals = pipeline.filter((d: any) => d.urgency === 'critical');
    if (criticalDeals.length > 0) {
      actions.push(`${criticalDeals.length} deals criticos requieren accion inmediata.`);
    }
    if (dealsAtRisk > 0) {
      actions.push(`${dealsAtRisk} deals en riesgo por inactividad o estancamiento.`);
    }
    const paymentDeals = pipeline.filter((d: any) => d.stage === 'PENDIENTE_PAGO');
    if (paymentDeals.length > 0) {
      const paymentValue = paymentDeals.reduce((s: any, d: any) => s + d.estimatedValue, 0);
      actions.push(`${paymentDeals.length} deals en Pendiente de Pago por $${Math.round(paymentValue).toLocaleString()} — confirmar transferencias.`);
    }
    const unassigned = pipeline.filter((d: any) => !d.advisorId);
    if (unassigned.length > 0) {
      actions.push(`${unassigned.length} deals sin asesor asignado — asignar inmediatamente.`);
    }
    if (actions.length === 0) {
      actions.push('Pipeline en buen estado. Mantener presion de cierre.');
    }

    return {
      weekOf: weekStart.toISOString().slice(0, 10),
      dealsToClose: pipeline.filter((d: any) => d.urgency === 'critical' || d.urgency === 'high'),
      perAdvisor,
      forecast: {
        totalPipeline: Math.round(totalPipeline),
        weightedForecast: Math.round(weightedForecast),
        weeklyTarget,
        revenueGap: Math.round(Math.max(0, revenueGap)),
        closingRate,
        dealsAtRisk,
      },
      actionsRequired: actions,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 5. DAILY CLOSING TRACKER
  // ═══════════════════════════════════════════════════════════

  async getDailyTracker(): Promise<DailyClosingTracker> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    if (weekStart > todayStart) weekStart.setDate(weekStart.getDate() - 7);

    const weeklyTarget = 2_000_000;

    const [closedToday, lostToday, closedWeek, lostWeek] = await Promise.all([
      this.prisma.lead.findMany({
        where: { status: 'CERRADO_GANADO', convertedAt: { gte: todayStart }, deletedAt: null, isHistorical: false },
        select: { estimatedValue: true, companyName: true, convertedAt: true },
      }),
      this.prisma.lead.count({
        where: { status: 'CERRADO_PERDIDO', updatedAt: { gte: todayStart }, deletedAt: null, isHistorical: false },
      }),
      this.prisma.lead.findMany({
        where: { status: 'CERRADO_GANADO', convertedAt: { gte: weekStart }, deletedAt: null, isHistorical: false },
        select: { estimatedValue: true },
      }),
      this.prisma.lead.count({
        where: { status: 'CERRADO_PERDIDO', updatedAt: { gte: weekStart }, deletedAt: null, isHistorical: false },
      }),
    ]);

    // Tasks completed today (close_deal type)
    const pushedToday = await this.prisma.salesTask.count({
      where: {
        type: 'close_deal',
        status: 'completed',
        completedAt: { gte: todayStart },
        isHistorical: false,
      },
    });

    const revenueToday = closedToday.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0);
    const revenueWeek = closedWeek.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0);
    const totalDecisionsToday = closedToday.length + lostToday;
    const closingRateToday = totalDecisionsToday > 0
      ? Math.round((closedToday.length / totalDecisionsToday) * 100)
      : 0;

    // Recent closing activity
    const recentTasks = await this.prisma.salesTask.findMany({
      where: {
        type: 'close_deal',
        completedAt: { gte: todayStart },
        isHistorical: false,
      },
      orderBy: { completedAt: 'desc' },
      take: 10,
    });

    // Enrich with lead names
    const leadIds = [...new Set(recentTasks.filter((t: any) => t.leadId).map((t: any) => t.leadId!))];
    const leadMap = new Map<string, string>();
    if (leadIds.length > 0) {
      const leads = await this.prisma.lead.findMany({
        where: { id: { in: leadIds } },
        select: { id: true, companyName: true },
      });
      leads.forEach((l: any) => leadMap.set(l.id, l.companyName));
    }

    return {
      date: todayStart.toISOString().slice(0, 10),
      dealsClosedToday: closedToday.length,
      revenueClosedToday: Math.round(revenueToday),
      dealsPushedToday: pushedToday,
      dealsLostToday: lostToday,
      closingRate: closingRateToday,
      weeklyProgress: {
        dealsClosedThisWeek: closedWeek.length,
        revenueThisWeek: Math.round(revenueWeek),
        weeklyTarget,
        pctComplete: weeklyTarget > 0 ? Math.round((revenueWeek / weeklyTarget) * 100) : 0,
        remainingRevenue: Math.round(Math.max(0, weeklyTarget - revenueWeek)),
        remainingDeals: Math.max(0, Math.ceil((weeklyTarget - revenueWeek) / 250_000)),
      },
      recentActivity: recentTasks.map((t: any) => ({
        lead: t.leadId ? (leadMap.get(t.leadId) ?? 'N/A') : 'N/A',
        action: t.title,
        time: t.completedAt?.toISOString() ?? '',
        outcome: t.outcome ?? 'completed',
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 6. DIRECTOR CLOSING VIEW (ANDRES)
  // ═══════════════════════════════════════════════════════════

  async getDirectorView(): Promise<DirectorClosingView> {
    const pipeline = await this.getClosingPipeline();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);

    // Top deals across team (by closing score)
    const topDeals = pipeline.slice(0, 15);

    // High value at risk
    const highValueAtRisk = pipeline.filter(
      (d) => d.estimatedValue >= HIGH_VALUE_THRESHOLD && (d.daysSinceContact >= 3 || d.daysInStage >= 10),
    );

    // Needs escalation
    const needsEscalation = pipeline.filter(
      (d) =>
        (d.estimatedValue >= CRITICAL_VALUE_THRESHOLD && d.daysSinceContact >= 3) ||
        (d.urgency === 'critical' && d.daysInStage >= 14) ||
        (d.stage === 'PENDIENTE_PAGO' && d.daysSinceContact >= 5),
    );

    // Forecast
    const thisWeekForecast = pipeline
      .filter((d: any) => d.probability >= 0.7)
      .reduce((s: any, d: any) => s + d.estimatedValue, 0);
    const thisMonthForecast = pipeline.reduce((s: any, d: any) => s + d.weightedValue, 0);

    // Closed this month
    const closedMonth = await this.prisma.lead.findMany({
      where: { status: 'CERRADO_GANADO', convertedAt: { gte: monthStart }, deletedAt: null, isHistorical: false },
      select: { estimatedValue: true, assignedToId: true },
    });

    // Team summary
    const teamUsers = await this.prisma.user.findMany({
      where: { email: { in: TEAM_EMAILS }, isActive: true },
      select: { id: true, firstName: true, lastName: true },
    });

    const teamSummary = await Promise.all(
      teamUsers.map(async (user) => {
        const advisorDeals = pipeline.filter((d: any) => d.advisorId === user.id);
        const closedByAdvisor = closedMonth.filter((c: any) => c.assignedToId === user.id);

        // Avg days to close (from closed deals this month)
        const closedLeads = await this.prisma.lead.findMany({
          where: {
            assignedToId: user.id,
            status: 'CERRADO_GANADO',
            convertedAt: { gte: monthStart },
            deletedAt: null,
            isHistorical: false,
          },
          select: { createdAt: true, convertedAt: true },
        });
        const avgDays = closedLeads.length > 0
          ? Math.round(
              closedLeads.reduce((s: any, l: any) => {
                const days = l.convertedAt
                  ? Math.floor((l.convertedAt.getTime() - l.createdAt.getTime()) / 86400000)
                  : 0;
                return s + days;
              }, 0) / closedLeads.length,
            )
          : 0;

        return {
          advisorId: user.id,
          advisorName: `${user.firstName} ${user.lastName}`,
          pipelineValue: Math.round(advisorDeals.reduce((s: any, d: any) => s + d.estimatedValue, 0)),
          weightedValue: Math.round(advisorDeals.reduce((s: any, d: any) => s + d.weightedValue, 0)),
          closedThisMonth: Math.round(closedByAdvisor.reduce((s: any, c: any) => s + (c.estimatedValue || 0), 0)),
          deals: advisorDeals.length,
          avgDaysToClose: avgDays,
        };
      }),
    );
    teamSummary.sort((a: any, b: any) => b.weightedValue - a.weightedValue);

    // Recommendations
    const recommendations: string[] = [];
    if (needsEscalation.length > 0) {
      const escValue = needsEscalation.reduce((s: any, d: any) => s + d.estimatedValue, 0);
      recommendations.push(`${needsEscalation.length} deals necesitan intervencion directa (${fmt(escValue)}).`);
    }
    if (highValueAtRisk.length > 0) {
      recommendations.push(`${highValueAtRisk.length} deals de alto valor en riesgo. Revisar y reasignar si es necesario.`);
    }
    const paymentDeals = pipeline.filter((d: any) => d.stage === 'PENDIENTE_PAGO');
    if (paymentDeals.length > 0) {
      const pv = paymentDeals.reduce((s: any, d: any) => s + d.estimatedValue, 0);
      recommendations.push(`${paymentDeals.length} deals en Pendiente de Pago (${fmt(pv)}) — confirmar cobros.`);
    }
    const closedMonthValue = closedMonth.reduce((s: any, c: any) => s + (c.estimatedValue || 0), 0);
    recommendations.push(`Revenue cerrado este mes: ${fmt(closedMonthValue)}. Pipeline ponderado: ${fmt(thisMonthForecast)}.`);
    if (recommendations.length === 1) {
      recommendations.push('Pipeline de cierre estable. Mantener presion.');
    }

    return {
      topDeals,
      highValueAtRisk,
      needsEscalation,
      closingForecast: {
        thisWeek: Math.round(thisWeekForecast),
        thisMonth: Math.round(thisMonthForecast),
        weighted: Math.round(pipeline.reduce((s: any, d: any) => s + d.weightedValue, 0)),
        pipeline: Math.round(pipeline.reduce((s: any, d: any) => s + d.estimatedValue, 0)),
      },
      teamSummary,
      recommendations,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 7. SUPERVISOR CONTROL (NETO)
  // ═══════════════════════════════════════════════════════════

  async getSupervisorView(): Promise<SupervisorClosingView> {
    const pipeline = await this.getClosingPipeline();
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    weekStart.setHours(0, 0, 0, 0);

    const teamUsers = await this.prisma.user.findMany({
      where: { email: { in: TEAM_EMAILS }, isActive: true },
      select: { id: true, firstName: true, lastName: true },
    });

    const advisorPerformance = await Promise.all(
      teamUsers.map(async (user: any) => {
        const deals = pipeline.filter((d: any) => d.advisorId === user.id);

        // Closed this week
        const closedWeek = await this.prisma.lead.findMany({
          where: {
            assignedToId: user.id,
            status: 'CERRADO_GANADO',
            convertedAt: { gte: weekStart },
            deletedAt: null,
            isHistorical: false,
          },
          select: { estimatedValue: true },
        });

        // Overdue follow-ups
        const overdue = await this.prisma.salesTask.count({
          where: {
            advisorId: user.id,
            type: 'close_deal',
            status: 'pending',
            dueDate: { lt: now },
            isHistorical: false,
          },
        });

        const avgDaysInStage = deals.length > 0
          ? Math.round(deals.reduce((s: any, d: any) => s + d.daysInStage, 0) / deals.length)
          : 0;

        // Identify gaps
        const gaps: string[] = [];
        const inactiveDeals = deals.filter((d: any) => d.daysSinceContact >= 3);
        if (inactiveDeals.length > 0) {
          gaps.push(`${inactiveDeals.length} deals sin contacto 3+ dias`);
        }
        if (overdue > 0) {
          gaps.push(`${overdue} tareas de cierre vencidas`);
        }
        const stuckDeals = deals.filter((d: any) => d.daysInStage >= 14);
        if (stuckDeals.length > 0) {
          gaps.push(`${stuckDeals.length} deals estancados 14+ dias`);
        }
        if (deals.length === 0 && closedWeek.length === 0) {
          gaps.push('Sin deals activos ni cierres esta semana');
        }

        return {
          advisorId: user.id,
          advisorName: `${user.firstName} ${user.lastName}`,
          activeDeals: deals.length,
          pipelineValue: Math.round(deals.reduce((s: any, d: any) => s + d.estimatedValue, 0)),
          closedThisWeek: closedWeek.length,
          closedRevenueWeek: Math.round(closedWeek.reduce((s: any, c: any) => s + (c.estimatedValue || 0), 0)),
          overdueFollowUps: overdue,
          avgDaysInStage,
          closingGaps: gaps,
        };
      }),
    );

    // Team metrics
    const totalClosedWeek = advisorPerformance.reduce((s: any, a: any) => s + a.closedThisWeek, 0);
    const totalDeals = pipeline.length;
    const totalPipeline = pipeline.reduce((s: any, d: any) => s + d.estimatedValue, 0);
    const dealsNeedingPressure = pipeline.filter(
      (d) => d.daysSinceContact >= 3 || d.daysInStage >= 10,
    ).length;

    const avgDays = pipeline.length > 0
      ? Math.round(pipeline.reduce((s: any, d: any) => s + d.daysInStage, 0) / pipeline.length)
      : 0;

    // Action items for supervisor
    const actions: string[] = [];
    const worstPerformers = advisorPerformance
      .filter((a) => a.closingGaps.length > 0)
      .sort((a: any, b: any) => b.closingGaps.length - a.closingGaps.length);
    for (const adv of worstPerformers.slice(0, 3)) {
      actions.push(`${adv.advisorName}: ${adv.closingGaps.join(', ')}`);
    }
    if (dealsNeedingPressure > 0) {
      actions.push(`${dealsNeedingPressure} deals necesitan presion de seguimiento.`);
    }

    return {
      advisorPerformance,
      teamMetrics: {
        totalActiveDeals: totalDeals,
        totalPipeline: Math.round(totalPipeline),
        totalClosedWeek,
        teamClosingRate: 0, // Calculated at weekly level
        avgDaysToClose: avgDays,
        dealsNeedingPressure,
      },
      actionItems: actions,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ACCESSORS
  // ═══════════════════════════════════════════════════════════

  getLastAgentResult(): ClosingAgentResult | null {
    return this.lastAgentResult;
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════

  private fmt = fmt;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}
