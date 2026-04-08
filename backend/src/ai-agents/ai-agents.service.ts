import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CommercialDirectorService } from '../commercial-director/commercial-director.service';
import { PriorityEngineService } from '../priority-engine/priority-engine.service';
import { SalesCoachService, CoachStage } from '../sales-coach/sales-coach.service';
import { AlertIntelligenceService } from '../alert-intelligence/alert-intelligence.service';
import { ExecutionEngineService } from '../execution-engine/execution-engine.service';
import { FollowUpAutomationService } from '../followup-automation/followup-automation.service';
import { AutomationPerformanceService } from '../automation-performance/automation-performance.service';
import { ClientLifecycleService } from '../client-lifecycle/client-lifecycle.service';

// ─── Interfaces ──────────────────────────────────────────────

export interface DirectorBriefing {
  greeting: string;
  executiveSummary: string;
  kpis: {
    label: string;
    value: string;
    trend: 'up' | 'down' | 'flat';
    interpretation: string;
  }[];
  criticalAlerts: {
    severity: 'critical' | 'high' | 'medium';
    message: string;
    action: string;
    impact: string;
  }[];
  bottlenecks: {
    stage: string;
    issue: string;
    recommendation: string;
    estimatedImpact: string;
  }[];
  advisorInsights: {
    name: string;
    performance: string;
    recommendation: string;
  }[];
  zoneInsights: {
    zone: string;
    status: string;
    opportunity: string;
  }[];
  strategicActions: {
    priority: number;
    action: string;
    rationale: string;
    expectedOutcome: string;
    assignTo: string;
  }[];
  automationHealth: {
    status: 'healthy' | 'warning' | 'critical';
    activeSequences: number;
    responseRate: string;
    topInsight: string;
  };
  narrative: string;
  generatedAt: string;
}

export interface PriorityIntelligence {
  summary: string;
  hotLeads: {
    id: string;
    company: string;
    contact: string;
    score: number;
    probability: number;
    urgency: string;
    value: number;
    reason: string;
    nextAction: string;
    deadline: string;
  }[];
  dealsToPush: {
    id: string;
    company: string;
    stage: string;
    value: number;
    daysInStage: number;
    risk: string;
    action: string;
    closingTip: string;
  }[];
  reactivationTargets: {
    id: string;
    company: string;
    lastContact: string;
    previousValue: number;
    reason: string;
    approach: string;
  }[];
  advisorWorkload: {
    name: string;
    totalLeads: number;
    hotLeads: number;
    recommendation: string;
  }[];
  generatedAt: string;
}

export interface CoachResponse {
  situation: string;
  coaching: any;
  quickWins: string[];
  mindset: string;
  generatedAt: string;
}

export interface ReactivationPlan {
  summary: string;
  totalOpportunity: string;
  targets: {
    id: string;
    company: string;
    contact: string;
    lastContact: string;
    daysSinceContact: number;
    previousStage: string;
    estimatedValue: number;
    reactivationScore: number;
    reason: string;
    approach: string;
    suggestedMessage: string;
    suggestedChannel: string;
    bestTimeToContact: string;
    inAutomation: boolean;
  }[];
  strategies: {
    segment: string;
    count: number;
    approach: string;
    expectedConversion: string;
  }[];
  generatedAt: string;
}

// ─── Service ──────────────────────────────────────────────────

@Injectable()
export class AiAgentsService {
  private readonly logger = new Logger(AiAgentsService.name);

  constructor(
    private prisma: PrismaService,
    private director: CommercialDirectorService,
    private priority: PriorityEngineService,
    private coach: SalesCoachService,
    private alerts: AlertIntelligenceService,
    private execution: ExecutionEngineService,
    private followUp: FollowUpAutomationService,
    private performance: AutomationPerformanceService,
    private lifecycle: ClientLifecycleService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // AGENT 1: COMMERCIAL DIRECTOR — Strategic overview & decisions
  // ═══════════════════════════════════════════════════════════

  async getDirectorBriefing(): Promise<DirectorBriefing> {
    this.logger.log('🧠 Director Agent: Generating executive briefing...');

    const [
      daily,
      bottlenecks,
      advisors,
      zones,
      riskAlerts,
      recommendations,
      alertCenter,
      automationDash,
      perfDash,
      executionStats,
    ] = await Promise.all([
      this.director.getDailySummary(),
      this.director.detectBottlenecks(),
      this.director.analyzeAdvisors(),
      this.director.analyzeZones(),
      this.director.getRiskAlerts(),
      this.director.getStrategicRecommendations(),
      this.alerts.getDirectorView().catch(() => null),
      this.followUp.getDashboard().catch(() => null),
      this.performance.getPerformanceDashboard().catch(() => null),
      this.execution.getExecutionStats().catch(() => null),
    ]);

    // Build interpreted KPIs
    const kpis = this.buildDirectorKPIs(daily);

    // Interpret critical alerts
    const criticalAlerts = this.interpretAlerts(riskAlerts, alertCenter);

    // Interpret bottlenecks with actionable recommendations
    const interpretedBottlenecks = bottlenecks.map((b: any) => ({
      stage: b.stage || b.name || 'Pipeline',
      issue: b.description || b.issue || `${b.count || 0} leads stuck`,
      recommendation: b.recommendation || this.generateBottleneckFix(b),
      estimatedImpact: b.potentialRevenue
        ? `$${(b.potentialRevenue / 1000).toFixed(0)}K en riesgo`
        : b.count
          ? `${b.count} deals afectados`
          : 'Impacto significativo',
    }));

    // Advisor performance insights
    const advisorInsights = advisors.slice(0, 5).map((a: any) => ({
      name: a.name || a.advisorName || 'Asesor',
      performance: this.interpretAdvisorPerformance(a),
      recommendation: this.generateAdvisorRecommendation(a),
    }));

    // Zone insights
    const zoneInsights = zones.map((z: any) => ({
      zone: z.zone || z.name,
      status: this.interpretZoneStatus(z),
      opportunity: this.generateZoneOpportunity(z),
    }));

    // Strategic actions from recommendations
    const strategicActions = recommendations.slice(0, 5).map((r: any, i: number) => ({
      priority: i + 1,
      action: r.action || r.recommendation || r.title,
      rationale: r.rationale || r.reason || r.description || 'Basado en análisis de datos',
      expectedOutcome: r.expectedOutcome || r.impact || 'Mejora en conversión',
      assignTo: r.assignTo || r.target || 'Director Comercial',
    }));

    // Automation health summary
    const automationHealth = this.interpretAutomationHealth(automationDash, perfDash);

    // Build executive narrative
    const narrative = this.buildExecutiveNarrative(daily, bottlenecks, riskAlerts, advisors, automationHealth);

    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Buenos días' : hour < 18 ? 'Buenas tardes' : 'Buenas noches';

    return {
      greeting,
      executiveSummary: narrative,
      kpis,
      criticalAlerts,
      bottlenecks: interpretedBottlenecks,
      advisorInsights,
      zoneInsights,
      strategicActions,
      automationHealth,
      narrative,
      generatedAt: new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // AGENT 2: PRIORITY & OPPORTUNITY — What to do NOW
  // ═══════════════════════════════════════════════════════════

  async getPriorityIntelligence(): Promise<PriorityIntelligence> {
    this.logger.log('🎯 Priority Agent: Analyzing opportunities...');

    const [topLeads, dealsToPush, advisorLists] = await Promise.all([
      this.priority.getTopLeadsOfDay(20),
      this.priority.getTopDealsToPush(15),
      this.priority.getAdvisorPriorityLists(),
    ]);

    // Interpret hot leads with context
    const hotLeads = topLeads.slice(0, 10).map((l: any) => ({
      id: l.id,
      company: l.companyName || 'Sin nombre',
      contact: l.contactName || 'Sin contacto',
      score: l.score,
      probability: l.probability || 0,
      urgency: l.urgency || 'medium',
      value: l.estimatedValue || 0,
      reason: this.explainLeadPriority(l),
      nextAction: this.suggestNextAction(l),
      deadline: this.calculateDeadline(l),
    }));

    // Interpret deals to push with closing tips
    const dealsToPushInterpreted = dealsToPush.slice(0, 10).map((d: any) => ({
      id: d.id,
      company: d.companyName || 'Sin nombre',
      stage: d.status || d.stage || 'Pipeline',
      value: d.estimatedValue || 0,
      daysInStage: d.daysInCurrentStage || this.priority.daysSince(d.lastStageChange) || 0,
      risk: this.assessDealRisk(d),
      action: this.suggestDealAction(d),
      closingTip: this.generateClosingTip(d),
    }));

    // Identify reactivation targets from cold/inactive leads
    const reactivationTargets = await this.findReactivationTargets();

    // Advisor workload analysis
    const advisorWorkload = advisorLists.map((a: any) => ({
      name: a.advisorName || a.name || 'Asesor',
      totalLeads: a.leads?.length || a.totalLeads || 0,
      hotLeads: a.leads?.filter((l: any) => l.urgency === 'critical' || l.urgency === 'high').length || 0,
      recommendation: this.recommendWorkloadAction(a),
    }));

    const totalHotValue = hotLeads.reduce((s, l) => s + l.value, 0);
    const totalDealValue = dealsToPushInterpreted.reduce((s, d) => s + d.value, 0);
    const summary = `Hoy tienes ${hotLeads.length} leads calientes ($${(totalHotValue / 1000).toFixed(0)}K) ` +
      `y ${dealsToPushInterpreted.length} deals por cerrar ($${(totalDealValue / 1000).toFixed(0)}K). ` +
      `${hotLeads.filter(l => l.urgency === 'critical').length} son urgencia CRITICA — actúa primero en ellos.`;

    return {
      summary,
      hotLeads,
      dealsToPush: dealsToPushInterpreted,
      reactivationTargets,
      advisorWorkload,
      generatedAt: new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // AGENT 3: SALES COACH — Contextual advice for specific leads
  // ═══════════════════════════════════════════════════════════

  async getCoachAdvice(leadId: string, advisorId: string, situation?: string): Promise<CoachResponse> {
    this.logger.log(`🤖 Coach Agent: Generating advice for lead ${leadId}...`);

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        visits: { orderBy: { visitDate: 'desc' }, take: 5 },
        assignedTo: true,
      },
    });

    if (!lead) {
      return {
        situation: 'Lead no encontrado',
        coaching: null,
        quickWins: ['Verifica el ID del lead'],
        mindset: 'Mantén la calma y verifica los datos.',
        generatedAt: new Date().toISOString(),
      };
    }

    // Determine coach stage from lead status
    const stage: CoachStage = this.mapStatusToCoachStage(lead.status);

    // Build coach input
    const coachInput = {
      leadId: lead.id,
      advisorId,
      stage,
      leadStatus: lead.status,
      leadSource: lead.source || 'MANUAL',
      companyName: lead.companyName,
      contactName: lead.contactName || '',
      estimatedValue: lead.estimatedValue || 0,
      daysSinceLastContact: this.priority.daysSince(lead.lastContactedAt),
      daysSinceCreated: this.priority.daysSince(lead.createdAt),
      zone: lead.zone || 'OTHER',
      industry: (lead as any).industry || '',
      visitCount: lead.visits?.length || 0,
      lastVisitOutcome: lead.visits?.[0]?.outcome || null,
      product: (lead as any).productInterest || (lead as any).industry || 'servicios eléctricos',
      situation: situation || undefined,
    };

    const coaching = await this.coach.generateCoaching(coachInput);

    // Generate quick wins based on current situation
    const quickWins = this.generateQuickWins(lead, coaching);

    // Generate mindset advice
    const mindset = this.generateMindset(lead, stage);

    // Enrich situation description
    const situationDesc = this.describeSituation(lead, stage);

    return {
      situation: situationDesc,
      coaching,
      quickWins,
      mindset,
      generatedAt: new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // AGENT 4: REACTIVATION — Recover lost opportunities
  // ═══════════════════════════════════════════════════════════

  async getReactivationPlan(): Promise<ReactivationPlan> {
    this.logger.log('♻️ Reactivation Agent: Scanning dormant opportunities...');

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // Find cold & inactive leads that aren't terminal
    const dormantLeads = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        isHistorical: false,
        status: {
          notIn: ['CERRADO_GANADO', 'CERRADO_PERDIDO', 'LEAD_BASURA'],
        },
        OR: [
          // No contact in 30+ days
          { lastContactedAt: { lt: thirtyDaysAgo } },
          // Never contacted but created 15+ days ago
          {
            lastContactedAt: null,
            createdAt: { lt: new Date(Date.now() - 15 * 86400000) },
          },
          // Explicitly set to CONTACTAR_FUTURO
          { status: 'CONTACTAR_FUTURO' as any },
        ],
      },
      include: {
        assignedTo: true,
        visits: { orderBy: { visitDate: 'desc' }, take: 1 },
      },
      orderBy: { estimatedValue: 'desc' },
      take: 50,
    });

    // Check which are already in automation
    const leadIds = dormantLeads.map(l => l.id);
    const activeSequences = await this.prisma.followUpSequence.findMany({
      where: {
        leadId: { in: leadIds },
        status: { in: ['active', 'paused'] },
      },
      select: { leadId: true },
    });
    const inAutomationSet = new Set(activeSequences.map(s => s.leadId));

    // Score and rank for reactivation
    const targets = dormantLeads.map((lead) => {
      const daysSinceContact = this.priority.daysSince(lead.lastContactedAt) ||
        this.priority.daysSince(lead.createdAt) || 999;
      const scored = this.priority.scoreLead(lead as any);

      return {
        id: lead.id,
        company: lead.companyName,
        contact: lead.contactName || 'Sin contacto',
        lastContact: lead.lastContactedAt?.toISOString() || 'Nunca',
        daysSinceContact,
        previousStage: lead.status,
        estimatedValue: lead.estimatedValue || 0,
        reactivationScore: this.calculateReactivationScore(lead, daysSinceContact, scored),
        reason: this.explainDormancy(lead, daysSinceContact),
        approach: this.suggestReactivationApproach(lead, daysSinceContact),
        suggestedMessage: this.generateReactivationMessage(lead),
        suggestedChannel: this.suggestReactivationChannel(lead, daysSinceContact),
        bestTimeToContact: this.suggestBestTime(lead),
        inAutomation: inAutomationSet.has(lead.id),
      };
    })
    .sort((a, b) => b.reactivationScore - a.reactivationScore)
    .slice(0, 20);

    // Build segment strategies
    const strategies = this.buildReactivationStrategies(targets);

    const totalValue = targets.reduce((s, t) => s + t.estimatedValue, 0);
    const notInAutomation = targets.filter(t => !t.inAutomation).length;

    return {
      summary: `${targets.length} oportunidades dormidas identificadas con valor total de $${(totalValue / 1000).toFixed(0)}K. ` +
        `${notInAutomation} aún no están en automatización — inscríbelas para maximizar recuperación.`,
      totalOpportunity: `$${(totalValue / 1000).toFixed(0)}K`,
      targets,
      strategies,
      generatedAt: new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVATE HELPERS — Interpretation & Intelligence Layer
  // ═══════════════════════════════════════════════════════════

  private buildDirectorKPIs(daily: any): DirectorBriefing['kpis'] {
    if (!daily) return [];
    const kpis: DirectorBriefing['kpis'] = [];

    if (daily.totalLeads !== undefined) {
      kpis.push({
        label: 'Leads Totales',
        value: String(daily.totalLeads),
        trend: 'flat',
        interpretation: `${daily.totalLeads} leads en el sistema. ${daily.newLeadsToday || 0} nuevos hoy.`,
      });
    }
    if (daily.pipelineValue !== undefined) {
      kpis.push({
        label: 'Pipeline Activo',
        value: `$${(daily.pipelineValue / 1000).toFixed(0)}K`,
        trend: daily.pipelineValue > (daily.previousPipelineValue || 0) ? 'up' : 'down',
        interpretation: `Pipeline de $${(daily.pipelineValue / 1000).toFixed(0)}K en ${daily.pipelineCount || '?'} deals activos.`,
      });
    }
    if (daily.wonThisMonth !== undefined) {
      kpis.push({
        label: 'Ganados Este Mes',
        value: String(daily.wonThisMonth),
        trend: daily.wonThisMonth > 0 ? 'up' : 'flat',
        interpretation: `${daily.wonThisMonth} deals cerrados este mes con valor de $${((daily.wonValueThisMonth || 0) / 1000).toFixed(0)}K.`,
      });
    }
    if (daily.conversionRate !== undefined) {
      kpis.push({
        label: 'Tasa de Conversión',
        value: `${daily.conversionRate}%`,
        trend: daily.conversionRate > 15 ? 'up' : daily.conversionRate < 8 ? 'down' : 'flat',
        interpretation: daily.conversionRate > 15
          ? 'Conversión saludable — el equipo está cerrando bien.'
          : daily.conversionRate < 8
            ? 'Conversión baja — revisar calidad de prospectos y proceso de ventas.'
            : 'Conversión estable — buscar optimizaciones incrementales.',
      });
    }

    return kpis;
  }

  private interpretAlerts(riskAlerts: any[], alertCenter: any): DirectorBriefing['criticalAlerts'] {
    const alerts: DirectorBriefing['criticalAlerts'] = [];

    if (riskAlerts) {
      for (const a of riskAlerts.slice(0, 5)) {
        alerts.push({
          severity: a.severity === 'CRITICAL' ? 'critical' : a.severity === 'HIGH' ? 'high' : 'medium',
          message: a.message || a.title || a.description,
          action: a.recommendedAction || a.action || 'Revisar inmediatamente',
          impact: a.impact || a.potentialLoss
            ? `$${((a.potentialLoss || 0) / 1000).toFixed(0)}K en riesgo`
            : 'Impacto en pipeline',
        });
      }
    }

    if (alertCenter?.summary) {
      const s = alertCenter.summary;
      if (s.critical > 0) {
        alerts.unshift({
          severity: 'critical',
          message: `${s.critical} alertas CRÍTICAS sin resolver en el sistema`,
          action: 'Revisar Alert Center inmediatamente',
          impact: `${s.critical} situaciones requieren acción urgente`,
        });
      }
    }

    return alerts.slice(0, 6);
  }

  private generateBottleneckFix(bottleneck: any): string {
    const stage = (bottleneck.stage || bottleneck.name || '').toUpperCase();
    if (stage.includes('COTIZACION')) return 'Agilizar entrega de cotizaciones — usar templates pre-armados.';
    if (stage.includes('CONTRATO')) return 'Seguimiento diario con decision-makers. Escalar si lleva >5 días.';
    if (stage.includes('PAGO')) return 'Enviar recordatorio de pago y ofrecer facilidades.';
    if (stage.includes('CITA')) return 'Reagendar citas caídas dentro de 24h. Usar WhatsApp para confirmar.';
    return 'Analizar causa raíz y aplicar acción correctiva específica.';
  }

  private interpretAdvisorPerformance(advisor: any): string {
    const conv = advisor.conversionRate || advisor.conversion || 0;
    const deals = advisor.dealsWon || advisor.won || 0;
    const active = advisor.activeLeads || advisor.totalLeads || 0;

    if (conv > 20) return `⭐ Alto rendimiento: ${conv}% conversión, ${deals} deals ganados.`;
    if (conv > 10) return `✅ Rendimiento estable: ${conv}% conversión, ${active} leads activos.`;
    if (conv > 0) return `⚠️ Bajo rendimiento: ${conv}% conversión — necesita coaching.`;
    return `❌ Sin conversiones recientes — revisar actividad y pipeline.`;
  }

  private generateAdvisorRecommendation(advisor: any): string {
    const conv = advisor.conversionRate || advisor.conversion || 0;
    const active = advisor.activeLeads || advisor.totalLeads || 0;

    if (active > 30 && conv < 10) return 'Reducir cartera y enfocarse en leads de mayor valor.';
    if (active < 10) return 'Asignar más leads — tiene capacidad disponible.';
    if (conv > 20) return 'Compartir mejores prácticas con el equipo.';
    if (conv < 5) return 'Sesión de coaching urgente — revisar técnica de cierre.';
    return 'Mantener ritmo actual y enfocarse en seguimiento.';
  }

  private interpretZoneStatus(zone: any): string {
    const leads = zone.totalLeads || zone.leads || 0;
    const won = zone.won || zone.dealsWon || 0;
    const pipeline = zone.pipelineValue || 0;

    if (won > 3) return `🟢 Activa: ${won} cierres, $${(pipeline / 1000).toFixed(0)}K en pipeline.`;
    if (leads > 10) return `🟡 En desarrollo: ${leads} leads, potencial sin explotar.`;
    return `🔴 Baja actividad: solo ${leads} leads. Necesita estrategia de penetración.`;
  }

  private generateZoneOpportunity(zone: any): string {
    const zoneName = (zone.zone || zone.name || '').toUpperCase();
    if (zoneName.includes('GUADALAJARA')) return 'Mercado base — mantener presencia y expandir verticales.';
    if (zoneName.includes('BAJIO')) return 'Zona industrial fuerte — enfocarse en manufactura y automotriz.';
    if (zoneName.includes('CDMX')) return 'Mercado más grande — requiere equipo dedicado para escalar.';
    if (zoneName.includes('MONTERREY')) return 'Alto poder adquisitivo — posicionar servicios premium.';
    return 'Evaluar potencial real vs. costo de atención para decidir inversión.';
  }

  private interpretAutomationHealth(automDash: any, perfDash: any): DirectorBriefing['automationHealth'] {
    const activeSeqs = automDash?.activeSequences || automDash?.summary?.activeSequences || 0;
    const responseRate = perfDash?.overall?.replyRate || automDash?.summary?.responseRate || 0;

    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    let topInsight = 'Automatización funcionando correctamente.';

    if (responseRate < 5) {
      status = 'critical';
      topInsight = 'Tasa de respuesta muy baja — revisar mensajes y canales.';
    } else if (responseRate < 15) {
      status = 'warning';
      topInsight = 'Tasa de respuesta por debajo del objetivo — optimizar templates.';
    } else {
      topInsight = `Buena tasa de respuesta (${responseRate.toFixed(1)}%) — continuar escalando.`;
    }

    return {
      status,
      activeSequences: activeSeqs,
      responseRate: `${responseRate.toFixed(1)}%`,
      topInsight,
    };
  }

  private buildExecutiveNarrative(daily: any, bottlenecks: any[], riskAlerts: any[], advisors: any[], automation: any): string {
    const parts: string[] = [];

    if (daily) {
      parts.push(
        `El pipeline comercial tiene un valor de $${((daily.pipelineValue || 0) / 1000).toFixed(0)}K ` +
        `con ${daily.pipelineCount || '?'} deals activos.`
      );
    }

    if (bottlenecks.length > 0) {
      parts.push(
        `Se detectaron ${bottlenecks.length} cuellos de botella que requieren atención, ` +
        `principalmente en etapa de ${bottlenecks[0]?.stage || bottlenecks[0]?.name || 'pipeline'}.`
      );
    }

    if (riskAlerts.length > 0) {
      const critical = riskAlerts.filter((a: any) => a.severity === 'CRITICAL').length;
      if (critical > 0) {
        parts.push(`⚠️ ${critical} alertas CRÍTICAS activas — requieren acción inmediata.`);
      }
    }

    if (automation.status === 'critical') {
      parts.push('La automatización de seguimiento tiene rendimiento bajo — priorizar optimización de mensajes.');
    }

    if (parts.length === 0) {
      parts.push('El sistema está operando normalmente. Revisa las prioridades del día para maximizar cierre.');
    }

    return parts.join(' ');
  }

  // --- Priority Agent Helpers ---

  private explainLeadPriority(lead: any): string {
    const reasons: string[] = [];
    if (lead.urgency === 'critical') reasons.push('urgencia CRITICA');
    if (lead.estimatedValue > 100000) reasons.push(`alto valor ($${(lead.estimatedValue / 1000).toFixed(0)}K)`);
    if (lead.probability > 60) reasons.push(`${lead.probability}% probabilidad de cierre`);
    if (lead.breakdown?.recency > 3) reasons.push('contacto reciente positivo');
    if (lead.breakdown?.value > 3) reasons.push('ticket alto');
    return reasons.length > 0
      ? `Prioridad alta por: ${reasons.join(', ')}.`
      : `Score ${lead.score}/20 — potencial sólido.`;
  }

  private suggestNextAction(lead: any): string {
    const status = (lead.status || '').toUpperCase();
    if (status.includes('PENDIENTE_CONTACTAR')) return 'Llamar hoy — primer contacto. Presentar solución.';
    if (status.includes('INTENTANDO')) return 'Intentar por WhatsApp si teléfono no responde.';
    if (status.includes('PROSPECCION')) return 'Enviar caso de éxito relevante y agendar demo.';
    if (status.includes('CITA')) return 'Confirmar cita 1h antes. Preparar propuesta preliminar.';
    if (status.includes('COTIZACION')) return 'Dar seguimiento a cotización. Preguntar si tiene dudas.';
    if (status.includes('CONTRATO')) return 'Enviar contrato y agendar firma. Urgente.';
    if (status.includes('PAGO')) return 'Confirmar forma de pago y enviar datos bancarios.';
    return 'Evaluar estado actual y definir siguiente paso.';
  }

  private calculateDeadline(lead: any): string {
    if (lead.urgency === 'critical') return 'HOY — acción inmediata';
    if (lead.urgency === 'high') return 'Antes de mañana';
    if (lead.urgency === 'medium') return 'Esta semana';
    return 'Próximos 5 días';
  }

  private assessDealRisk(deal: any): string {
    const days = deal.daysInCurrentStage || this.priority.daysSince(deal.lastStageChange) || 0;
    if (days > 30) return '🔴 ALTO — Deal estancado >30 días. Riesgo de pérdida.';
    if (days > 14) return '🟡 MEDIO — Lleva >2 semanas sin avance.';
    return '🟢 BAJO — Avance reciente.';
  }

  private suggestDealAction(deal: any): string {
    const status = (deal.status || '').toUpperCase();
    if (status.includes('COTIZACION_ENTREGADA')) return 'Llamar para resolver objeciones. Ofrecer ajuste de precio si necesario.';
    if (status.includes('ESPERANDO_CONTRATO')) return 'Enviar contrato HOY. Cada día sin firma es riesgo.';
    if (status.includes('PENDIENTE_PAGO')) return 'Confirmar pago. Ofrecer facilidades si hay retraso.';
    return 'Agendar reunión de seguimiento esta semana.';
  }

  private generateClosingTip(deal: any): string {
    const value = deal.estimatedValue || 0;
    if (value > 200000) return 'Deal de alto valor — involucrar a dirección en la negociación final.';
    if (value > 50000) return 'Ofrecer valor agregado (soporte extendido, capacitación) para diferenciarte.';
    return 'Cierre rápido — simplificar proceso y reducir fricción.';
  }

  private async findReactivationTargets(): Promise<PriorityIntelligence['reactivationTargets']> {
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const coldLeads = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        isHistorical: false,
        status: { notIn: ['CERRADO_GANADO', 'CERRADO_PERDIDO', 'LEAD_BASURA'] },
        lastContactedAt: { lt: sixtyDaysAgo },
        estimatedValue: { gt: 0 },
      },
      orderBy: { estimatedValue: 'desc' },
      take: 5,
    });

    return coldLeads.map(l => ({
      id: l.id,
      company: l.companyName,
      lastContact: l.lastContactedAt?.toISOString() || 'Nunca',
      previousValue: l.estimatedValue || 0,
      reason: `Sin contacto hace ${this.priority.daysSince(l.lastContactedAt) || '?'} días. Valor de $${((l.estimatedValue || 0) / 1000).toFixed(0)}K.`,
      approach: 'Recontactar con nueva propuesta de valor o caso de éxito reciente.',
    }));
  }

  private recommendWorkloadAction(advisor: any): string {
    const total = advisor.leads?.length || advisor.totalLeads || 0;
    const hot = advisor.leads?.filter((l: any) => l.urgency === 'critical' || l.urgency === 'high').length || 0;

    if (hot > 5) return `🔥 ${hot} leads calientes — enfocarse exclusivamente en ellos hoy.`;
    if (total > 25) return 'Cartera grande — priorizar top 10 y delegar resto.';
    if (total < 5) return 'Capacidad disponible — asignar más leads.';
    return 'Carga balanceada — seguir plan de trabajo.';
  }

  // --- Coach Agent Helpers ---

  private mapStatusToCoachStage(status: string): CoachStage {
    const s = (status || '').toUpperCase();
    if (['PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR', 'EN_PROSPECCION'].includes(s)) return 'new_lead';
    if (['AGENDAR_CITA', 'ESPERANDO_COTIZACION'].includes(s)) return 'follow_up';
    if (['COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO'].includes(s)) return 'negotiation';
    if (s === 'CONTACTAR_FUTURO') return 'reactivation';
    if (s === 'CERRADO_GANADO') return 'post_sale';
    return 'follow_up';
  }

  private generateQuickWins(lead: any, coaching: any): string[] {
    const wins: string[] = [];
    const days = this.priority.daysSince(lead.lastContactedAt);

    if (!lead.contactPhone && !lead.contactEmail) {
      wins.push('Conseguir datos de contacto — buscar en LinkedIn o sitio web.');
    }
    if (days && days > 7) {
      wins.push(`Recontactar — llevas ${days} días sin contacto.`);
    }
    if (lead.estimatedValue && lead.estimatedValue > 100000 && !lead.visits?.length) {
      wins.push('Lead de alto valor sin visita — agendar reunión presencial.');
    }
    if (coaching?.nextBestAction?.action) {
      wins.push(coaching.nextBestAction.action);
    }
    if (wins.length === 0) {
      wins.push('Seguir el plan de coaching sugerido.');
    }
    return wins.slice(0, 4);
  }

  private generateMindset(lead: any, stage: string): string {
    if (stage === 'new_lead') return 'Primer contacto = primera impresión. Sé consultivo, no vendedor. Escucha más de lo que hablas.';
    if (stage === 'follow_up') return 'La persistencia gana. Cada seguimiento es una oportunidad de aportar valor. No solo "checar".';
    if (stage === 'negotiation') return 'Estás cerca del cierre. Mantén la confianza, resuelve objeciones con datos, y crea urgencia genuina.';
    if (stage === 'reactivation') return 'No es un rechazo, es un "ahora no". Aporta algo nuevo: caso de éxito, innovación, o cambio de contexto.';
    if (stage === 'post_sale') return 'Un cliente satisfecho es tu mejor vendedor. Supera expectativas y pide referidos.';
    return 'Cada interacción suma. Sé profesional, empático y orientado a soluciones.';
  }

  private describeSituation(lead: any, stage: string): string {
    const days = this.priority.daysSince(lead.lastContactedAt);
    const visits = lead.visits?.length || 0;
    const value = lead.estimatedValue || 0;

    return `${lead.companyName} (${lead.contactName || 'sin contacto'}) — ` +
      `Etapa: ${lead.status}, Valor: $${(value / 1000).toFixed(0)}K, ` +
      `${days ? `Último contacto: hace ${days} días` : 'Sin contacto previo'}, ` +
      `${visits} visita(s). Fase de coaching: ${stage}.`;
  }

  // --- Reactivation Agent Helpers ---

  private calculateReactivationScore(lead: any, daysSinceContact: number, scored: any): number {
    let score = 0;
    // Value weight (0-30)
    const value = lead.estimatedValue || 0;
    if (value > 200000) score += 30;
    else if (value > 100000) score += 25;
    else if (value > 50000) score += 20;
    else if (value > 10000) score += 10;

    // Recency weight (0-25) — more recent = higher reactivation chance
    if (daysSinceContact < 45) score += 25;
    else if (daysSinceContact < 90) score += 20;
    else if (daysSinceContact < 180) score += 10;
    else score += 5;

    // Stage advancement weight (0-25) — further = warmer
    const status = (lead.status || '').toUpperCase();
    if (status.includes('COTIZACION') || status.includes('CONTRATO')) score += 25;
    else if (status.includes('CITA') || status.includes('ESPERANDO')) score += 20;
    else if (status.includes('PROSPECCION')) score += 10;
    else score += 5;

    // Has contact info (0-10)
    if (lead.contactPhone) score += 5;
    if (lead.contactEmail) score += 5;

    // Priority engine score boost (0-10)
    score += Math.min(10, (scored?.score || 0) / 2);

    return Math.min(100, Math.round(score));
  }

  private explainDormancy(lead: any, daysSinceContact: number): string {
    const status = (lead.status || '').toUpperCase();
    if (status === 'CONTACTAR_FUTURO') return 'Marcado para contactar en el futuro — posible interés latente.';
    if (daysSinceContact > 90) return `Sin contacto hace ${daysSinceContact} días — oportunidad olvidada.`;
    if (daysSinceContact > 60) return `Sin contacto hace ${daysSinceContact} días — perdiendo momentum.`;
    if (daysSinceContact > 30) return `Sin contacto hace ${daysSinceContact} días — requiere re-engagement.`;
    return 'Lead inactivo — evaluar situación actual.';
  }

  private suggestReactivationApproach(lead: any, daysSinceContact: number): string {
    const status = (lead.status || '').toUpperCase();
    if (status.includes('COTIZACION')) return 'Enviar cotización actualizada con mejora de precio o alcance.';
    if (status.includes('CONTRATO')) return 'Retomar negociación — preguntar qué frenó la decisión.';
    if (daysSinceContact > 90) return 'Nuevo approach: compartir caso de éxito reciente del sector.';
    if (daysSinceContact > 60) return 'Re-contactar con valor agregado: estudio técnico gratuito.';
    return 'Seguimiento consultivo — preguntar cómo ha cambiado su situación.';
  }

  private generateReactivationMessage(lead: any): string {
    const name = lead.contactName || 'estimado cliente';
    const company = lead.companyName;
    return `Hola ${name}, soy del equipo de IEA. Estuvimos trabajando en una propuesta para ${company} ` +
      `y me gustaría retomar la conversación. Hemos tenido resultados excelentes en proyectos similares ` +
      `recientemente. ¿Le parece si agendamos 15 minutos esta semana para platicar?`;
  }

  private suggestReactivationChannel(lead: any, daysSinceContact: number): string {
    if (lead.contactPhone && daysSinceContact < 60) return 'WhatsApp — más personal y directo.';
    if (lead.contactEmail) return 'Email — menos intrusivo para leads fríos.';
    if (lead.contactPhone) return 'Llamada telefónica — mayor impacto.';
    return 'Buscar contacto en LinkedIn primero.';
  }

  private suggestBestTime(lead: any): string {
    const zone = (lead.zone || '').toUpperCase();
    if (zone.includes('CDMX') || zone.includes('MONTERREY')) return 'Martes o miércoles, 10:00-12:00.';
    if (zone.includes('GUADALAJARA')) return 'Lunes a miércoles, 9:00-11:00.';
    return 'Martes a jueves, 10:00-12:00 — hora óptima para decisores.';
  }

  private buildReactivationStrategies(targets: any[]): ReactivationPlan['strategies'] {
    const segments: Record<string, { count: number; value: number }> = {};

    for (const t of targets) {
      let segment = 'General';
      if (t.daysSinceContact > 90) segment = 'Dormidos >90 días';
      else if (t.daysSinceContact > 60) segment = 'Dormidos 60-90 días';
      else segment = 'Dormidos 30-60 días';

      if (!segments[segment]) segments[segment] = { count: 0, value: 0 };
      segments[segment].count += 1;
      segments[segment].value += t.estimatedValue;
    }

    return Object.entries(segments).map(([segment, data]) => ({
      segment,
      count: data.count,
      approach: segment.includes('>90')
        ? 'Nuevo approach necesario: caso de éxito + oferta especial.'
        : segment.includes('60-90')
          ? 'Re-engagement con valor: estudio técnico o demo personalizada.'
          : 'Seguimiento directo — mantener conversación activa.',
      expectedConversion: segment.includes('>90') ? '5-8%' : segment.includes('60-90') ? '10-15%' : '15-25%',
    }));
  }

  // ═══════════════════════════════════════════════════════════
  // AGENT 5: POST-SALE INTELLIGENCE — Client lifecycle & expansion
  // ═══════════════════════════════════════════════════════════

  async getPostSaleBriefing() {
    this.logger.log('🧠 Post-Sale Agent: Generating lifecycle briefing...');

    const [dashboard, insights, expansion, reactivation, churnData, referralROI] = await Promise.all([
      this.lifecycle.getLifecycleDashboard(),
      this.lifecycle.getStrategicInsights(),
      this.lifecycle.getExpansionOpportunities(),
      this.lifecycle.getReactivationCandidates(),
      this.lifecycle.getChurnAnalysis(),
      this.lifecycle.getReferralROI(),
    ]);

    const kpis = dashboard.kpis;

    // Build executive narrative
    const narrativeParts: string[] = [];
    narrativeParts.push(`Hay ${kpis.totalClients} clientes activos con LTV total de $${(kpis.totalLTV / 1000).toFixed(0)}k.`);

    if (kpis.highChurnRisk > 0) {
      narrativeParts.push(`⚠️ ${kpis.highChurnRisk} clientes en alto riesgo de churn con $${(churnData.atRiskLTV / 1000).toFixed(0)}k en LTV en riesgo.`);
    }
    if (expansion.length > 0) {
      const expansionValue = expansion.reduce((s, e) => s + e.estimatedExpansionValue, 0);
      narrativeParts.push(`📈 ${expansion.length} oportunidades de expansion detectadas por $${(expansionValue / 1000).toFixed(0)}k.`);
    }
    if (reactivation.totalCandidates > 0) {
      narrativeParts.push(`🔄 ${reactivation.totalCandidates} candidatos de reactivacion identificados.`);
    }
    if (kpis.avgSatisfaction) {
      narrativeParts.push(`⭐ Satisfaccion promedio: ${kpis.avgSatisfaction}/10.`);
    }

    return {
      agent: 'post_sale',
      title: 'Briefing Post-Venta & Expansion',
      generatedAt: new Date().toISOString(),
      narrative: narrativeParts.join(' '),
      kpis: [
        { label: 'Clientes Totales', value: String(kpis.totalClients), interpretation: 'Base de clientes activa' },
        { label: 'LTV Total', value: `$${(kpis.totalLTV / 1000).toFixed(0)}k`, interpretation: 'Valor de vida acumulado' },
        { label: 'LTV Promedio', value: `$${(kpis.avgLTV / 1000).toFixed(0)}k`, interpretation: 'Valor promedio por cliente' },
        { label: 'Satisfaccion', value: kpis.avgSatisfaction ? `${kpis.avgSatisfaction}/10` : 'N/A', interpretation: kpis.avgSatisfaction && kpis.avgSatisfaction >= 8 ? 'Saludable' : 'Necesita atencion' },
        { label: 'Churn Alto', value: String(kpis.highChurnRisk), interpretation: kpis.highChurnRisk > 0 ? `$${(churnData.atRiskLTV / 1000).toFixed(0)}k en riesgo` : 'Sin riesgo critico' },
        { label: 'Expansion Prom.', value: `${kpis.avgExpansionScore}%`, interpretation: kpis.avgExpansionScore >= 60 ? 'Alto potencial' : 'Potencial moderado' },
        { label: 'Referidos', value: String(kpis.totalReferrals), interpretation: `${referralROI.conversionRate}% conversion` },
        { label: 'Rev. Referidos', value: `$${(kpis.totalReferralRevenue / 1000).toFixed(0)}k`, interpretation: 'Revenue generado por referidos' },
      ],
      criticalActions: [
        ...(kpis.highChurnRisk > 0 ? [{
          priority: 1,
          action: `Intervenir con ${kpis.highChurnRisk} clientes en riesgo de churn`,
          impact: `Proteger $${(churnData.atRiskLTV / 1000).toFixed(0)}k en LTV`,
          category: 'retention',
        }] : []),
        ...(expansion.length > 0 ? [{
          priority: 2,
          action: `Contactar ${Math.min(5, expansion.length)} clientes con mayor score de expansion`,
          impact: `Pipeline potencial de $${(expansion.reduce((s, e) => s + e.estimatedExpansionValue, 0) / 1000).toFixed(0)}k`,
          category: 'expansion',
        }] : []),
        ...(reactivation.totalCandidates > 0 ? [{
          priority: 3,
          action: `Lanzar campana de reactivacion para ${reactivation.totalCandidates} candidatos`,
          impact: 'Recuperar relaciones y revenue dormido',
          category: 'reactivation',
        }] : []),
      ],
      insights: insights.insights.slice(0, 5),
      expansion: {
        totalOpportunities: expansion.length,
        topOpportunities: expansion.slice(0, 5).map((e) => ({
          company: e.companyName,
          contact: e.contactName,
          score: e.expansionScore,
          type: e.expansionType,
          estimatedValue: e.estimatedExpansionValue,
        })),
      },
      reactivation: {
        inactiveClients: reactivation.inactiveClients.length,
        lostDeals: reactivation.lostDeals.length,
        futureContacts: reactivation.futureContacts.length,
        total: reactivation.totalCandidates,
      },
      churn: {
        highRisk: churnData.highRiskCount,
        mediumRisk: churnData.mediumRiskCount,
        atRiskLTV: churnData.atRiskLTV,
        topRiskClients: churnData.highRiskClients.slice(0, 5).map((c) => ({
          company: c.companyName,
          risk: c.churnRisk,
          ltv: c.lifetimeValue,
          daysSinceContact: c.daysSinceContact,
        })),
      },
      referrals: {
        total: referralROI.totalReferrals,
        converted: referralROI.converted,
        conversionRate: referralROI.conversionRate,
        revenue: referralROI.totalRevenue,
      },
    };
  }
}
