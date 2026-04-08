import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const TERMINAL = ['CERRADO_GANADO', 'CERRADO_PERDIDO', 'LEAD_BASURA', 'CONTACTAR_FUTURO'];
const LATE_STAGES = ['COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO'];
const MID_STAGES = ['AGENDAR_CITA', 'ESPERANDO_COTIZACION'];

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

const STAGE_ORDER: Record<string, number> = {
  PENDIENTE_CONTACTAR: 1, INTENTANDO_CONTACTAR: 2,
  EN_PROSPECCION: 3, AGENDAR_CITA: 4,
  ESPERANDO_COTIZACION: 5, COTIZACION_ENTREGADA: 6,
  ESPERANDO_CONTRATO: 7, PENDIENTE_PAGO: 8,
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  no_followup: 'Sin Seguimiento',
  stalled_deal: 'Deal Estancado',
  low_activity_advisor: 'Asesor Baja Actividad',
  low_conversion: 'Baja Conversion',
  zone_opportunity: 'Zona Oportunidad Desatendida',
  weekly_target_risk: 'Meta Semanal en Riesgo',
  high_value_no_contact: 'Alto Valor Sin Contacto',
  final_stage_stuck: 'Etapa Final Sin Movimiento',
  inactive_48h: 'Inactivo 48h',
  inactive_72h: 'Inactivo 72h',
  inactive_7d: 'Inactivo 7d',
  deal_stuck: 'Deal Estancado',
  reactivation: 'Reactivacion',
  low_activity: 'Baja Actividad',
  high_value_unattended: 'Alto Valor Sin Atencion',
};

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface EnrichedAlert {
  id: string;
  type: string;
  typeLabel: string;
  severity: string;
  priorityScore: number;
  title: string;
  message: string;
  suggestion: string | null;
  status: string;
  leadId: string | null;
  advisorId: string | null;
  assignedToId: string | null;
  zone: string | null;
  estimatedValue: number | null;
  daysSinceActivity: number | null;
  stageDuration: number | null;
  riskOfLoss: number | null;
  recommendedAction: string | null;
  actionTaken: string | null;
  triggerAction: string | null;
  triggerSentAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNotes: string | null;
  acknowledgedAt: string | null;
  escalatedTo: string | null;
  metadata: any;
  createdAt: string;
  // Enriched
  leadName: string | null;
  leadContact: string | null;
  leadPhone: string | null;
  leadStatus: string | null;
  advisorName: string | null;
  assignedToName: string | null;
  resolutionTimeHours: number | null;
}

export interface AlertCenterView {
  kpis: AlertKpis;
  critical: EnrichedAlert[];
  high: EnrichedAlert[];
  medium: EnrichedAlert[];
  low: EnrichedAlert[];
  recentlyResolved: EnrichedAlert[];
  byType: Array<{ type: string; label: string; count: number; critical: number }>;
  byAdvisor: Array<{ advisorId: string; name: string; open: number; critical: number; resolved: number; avgResolutionHours: number }>;
  byZone: Array<{ zone: string; open: number; critical: number; pipelineAtRisk: number; opportunityScore: number }>;
}

export interface AlertKpis {
  totalOpen: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  escalated: number;
  resolvedToday: number;
  avgResolutionHours: number;
  pipelineAtRisk: number;
  triggersActive: number;
}

export interface AdvisorView {
  advisorId: string;
  advisorName: string;
  openAlerts: EnrichedAlert[];
  pendingTasks: any[];
  kpis: {
    openAlerts: number;
    criticalAlerts: number;
    pendingTasks: number;
    leadsNoFollowup: number;
    dealsStuck: number;
    avgResponseTime: number;
  };
}

export interface SupervisorView {
  advisors: Array<{
    id: string;
    name: string;
    openAlerts: number;
    criticalAlerts: number;
    resolvedToday: number;
    avgResolutionHours: number;
    leadsAssigned: number;
    visitsThisWeek: number;
    performanceScore: number;
  }>;
  teamKpis: {
    totalOpenAlerts: number;
    totalCritical: number;
    totalResolvedToday: number;
    teamAvgResolutionHours: number;
    worstPerformer: string;
    bestPerformer: string;
  };
  escalatedAlerts: EnrichedAlert[];
  teamAlerts: EnrichedAlert[];
}

export interface DirectorView {
  strategicAlerts: EnrichedAlert[];
  zones: Array<{
    zone: string;
    openAlerts: number;
    pipelineAtRisk: number;
    opportunityUnattended: number;
    conversionRate: number;
    riskScore: number;
  }>;
  systemHealth: {
    totalActiveLeads: number;
    totalOpenAlerts: number;
    alertsPerLead: number;
    resolutionRate: number;
    criticalUnresolved: number;
    avgDaysToResolve: number;
  };
  weeklyTrend: Array<{ week: string; created: number; resolved: number; critical: number }>;
}

export interface ZoneView {
  zone: string;
  alerts: EnrichedAlert[];
  kpis: {
    openAlerts: number;
    critical: number;
    pipelineValue: number;
    pipelineAtRisk: number;
    leadsTotal: number;
    leadsUnattended: number;
    conversionRate: number;
    opportunityScore: number;
  };
}

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

@Injectable()
export class AlertIntelligenceService {
  private readonly logger = new Logger(AlertIntelligenceService.name);

  constructor(private prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────
  // GENERATE ALL ALERTS
  // ─────────────────────────────────────────────────────────

  async generateAlerts(): Promise<{ created: number; types: Record<string, number> }> {
    const results = await Promise.all([
      this.alertNoFollowup(),
      this.alertStalledDeals(),
      this.alertLowActivityAdvisors(),
      this.alertLowConversion(),
      this.alertZoneOpportunity(),
      this.alertWeeklyTargetRisk(),
      this.alertHighValueNoContact(),
      this.alertFinalStageStuck(),
    ]);

    const types: Record<string, number> = {};
    let total = 0;
    const typeNames = ['no_followup', 'stalled_deal', 'low_activity_advisor', 'low_conversion', 'zone_opportunity', 'weekly_target_risk', 'high_value_no_contact', 'final_stage_stuck'];
    results.forEach((count, i) => {
      types[typeNames[i]] = count;
      total += count;
    });

    return { created: total, types };
  }

  // ─────────────────────────────────────────────────────────
  // 1. Leads without follow-up
  // ─────────────────────────────────────────────────────────

  private async alertNoFollowup(): Promise<number> {
    const leads = await this.prisma.lead.findMany({
      where: { deletedAt: null, isHistorical: false, status: { notIn: TERMINAL as any } },
      select: {
        id: true, companyName: true, contactName: true, contactPhone: true,
        zone: true, status: true, estimatedValue: true,
        lastContactedAt: true, createdAt: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    let created = 0;
    const now = Date.now();

    for (const lead of leads) {
      const lastActivity = lead.lastContactedAt || lead.createdAt;
      const daysSince = Math.floor((now - new Date(lastActivity).getTime()) / 86400000);

      if (daysSince < 3) continue;

      const existing = await this.prisma.salesAlert.findFirst({
        where: { leadId: lead.id, type: 'no_followup', status: { in: ['open', 'acknowledged'] } },
      });
      if (existing) continue;

      const isHighValue = (lead.estimatedValue || 0) >= 300000;
      const isLateStage = LATE_STAGES.includes(lead.status as string);
      const severity = daysSince >= 14 ? 'critical' : daysSince >= 7 ? 'high' : isHighValue || isLateStage ? 'high' : 'medium';

      // Priority score: base on days, value, stage
      let priority = Math.min(100, daysSince * 5);
      if (isHighValue) priority = Math.min(100, priority + 20);
      if (isLateStage) priority = Math.min(100, priority + 15);

      // Risk of loss
      const risk = Math.min(100, Math.round(daysSince * 3 + (isLateStage ? 20 : 0) + (isHighValue ? 10 : 0)));

      const action = isLateStage ? 'call' : daysSince >= 7 ? 'escalate' : 'message';

      await this.prisma.salesAlert.create({
        data: {
          type: 'no_followup',
          severity,
          priorityScore: priority,
          leadId: lead.id,
          advisorId: lead.assignedTo?.id || null,
          title: `Sin seguimiento: ${lead.companyName} (${daysSince}d)`,
          message: `${lead.companyName} (${lead.contactName}) lleva ${daysSince} dias sin seguimiento. Etapa: ${STATUS_LABELS[lead.status as string] || lead.status}.${isHighValue ? ` Valor: $${(lead.estimatedValue || 0).toLocaleString('es-MX')}.` : ''}`,
          suggestion: this.buildSuggestion(lead, action, daysSince),
          daysSinceActivity: daysSince,
          stageDuration: this.daysSince(lead.createdAt),
          riskOfLoss: risk,
          recommendedAction: action,
          estimatedValue: lead.estimatedValue,
          zone: lead.zone as string,
          metadata: { contactName: lead.contactName, contactPhone: lead.contactPhone, status: lead.status },
        },
      });
      created++;
    }
    return created;
  }

  // ─────────────────────────────────────────────────────────
  // 2. Stalled deals
  // ─────────────────────────────────────────────────────────

  private async alertStalledDeals(): Promise<number> {
    const deals = await this.prisma.lead.findMany({
      where: { deletedAt: null, isHistorical: false, status: { in: [...LATE_STAGES, ...MID_STAGES] as any } },
      select: {
        id: true, companyName: true, contactName: true, contactPhone: true,
        zone: true, status: true, estimatedValue: true,
        lastContactedAt: true, createdAt: true, updatedAt: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    let created = 0;

    for (const deal of deals) {
      const daysSince = this.daysSince(deal.lastContactedAt) ?? this.daysSince(deal.createdAt) ?? 0;
      const daysSinceUpdate = this.daysSince(deal.updatedAt) ?? 0;
      const stalledDays = Math.max(daysSince, daysSinceUpdate);

      const isLate = LATE_STAGES.includes(deal.status as string);
      const threshold = isLate ? 3 : 5;
      if (stalledDays < threshold) continue;

      const existing = await this.prisma.salesAlert.findFirst({
        where: { leadId: deal.id, type: 'stalled_deal', status: { in: ['open', 'acknowledged'] } },
      });
      if (existing) continue;

      const severity = stalledDays >= 10 ? 'critical' : stalledDays >= 5 ? 'high' : 'medium';
      const priority = Math.min(100, stalledDays * 6 + (isLate ? 25 : 0) + Math.min(30, (deal.estimatedValue || 0) / 50000));
      const risk = Math.min(100, stalledDays * 4 + (isLate ? 30 : 10));

      await this.prisma.salesAlert.create({
        data: {
          type: 'stalled_deal',
          severity,
          priorityScore: Math.round(priority),
          leadId: deal.id,
          advisorId: deal.assignedTo?.id || null,
          title: `Deal estancado: ${deal.companyName} (${stalledDays}d en ${STATUS_LABELS[deal.status as string] || deal.status})`,
          message: `${deal.companyName} lleva ${stalledDays} dias sin movimiento en "${STATUS_LABELS[deal.status as string]}". Valor: $${(deal.estimatedValue || 0).toLocaleString('es-MX')}.`,
          suggestion: this.buildClosingSuggestion(deal),
          daysSinceActivity: stalledDays,
          stageDuration: stalledDays,
          riskOfLoss: Math.round(risk),
          recommendedAction: isLate ? 'call' : 'message',
          estimatedValue: deal.estimatedValue,
          zone: deal.zone as string,
          metadata: { stage: deal.status, contactName: deal.contactName, contactPhone: deal.contactPhone },
        },
      });
      created++;
    }
    return created;
  }

  // ─────────────────────────────────────────────────────────
  // 3. Low-activity advisors
  // ─────────────────────────────────────────────────────────

  private async alertLowActivityAdvisors(): Promise<number> {
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const advisors = await this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true },
      select: {
        id: true, firstName: true, lastName: true,
        _count: { select: { assignedLeads: { where: { deletedAt: null, isHistorical: false, status: { notIn: TERMINAL as any } } } } },
      },
    });

    let created = 0;

    for (const adv of advisors) {
      if (adv._count.assignedLeads < 3) continue;

      const visits = await this.prisma.visit.count({
        where: { visitedById: adv.id, visitDate: { gte: weekAgo } },
      });

      const updatedLeads = await this.prisma.lead.count({
        where: { assignedToId: adv.id, deletedAt: null, lastContactedAt: { gte: weekAgo } },
      });

      const activityScore = visits + updatedLeads;
      const expectedActivity = Math.max(5, adv._count.assignedLeads * 0.5);

      if (activityScore >= expectedActivity * 0.5) continue;

      const existing = await this.prisma.salesAlert.findFirst({
        where: { advisorId: adv.id, type: 'low_activity_advisor', status: { in: ['open', 'acknowledged'] } },
      });
      if (existing) continue;

      const severity = activityScore === 0 ? 'critical' : activityScore < 2 ? 'high' : 'medium';
      const priority = Math.round(Math.max(0, 80 - activityScore * 10));

      await this.prisma.salesAlert.create({
        data: {
          type: 'low_activity_advisor',
          severity,
          priorityScore: priority,
          advisorId: adv.id,
          title: `Baja actividad: ${adv.firstName} ${adv.lastName}`,
          message: `${adv.firstName} ${adv.lastName}: ${visits} visitas y ${updatedLeads} leads contactados en 7 dias, con ${adv._count.assignedLeads} leads asignados. Actividad ${Math.round((activityScore / expectedActivity) * 100)}% del esperado.`,
          recommendedAction: 'escalate',
          metadata: { visits, updatedLeads, assignedLeads: adv._count.assignedLeads, activityPct: Math.round((activityScore / expectedActivity) * 100) },
        },
      });
      created++;
    }
    return created;
  }

  // ─────────────────────────────────────────────────────────
  // 4. Low conversion alert
  // ─────────────────────────────────────────────────────────

  private async alertLowConversion(): Promise<number> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    const advisors = await this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, firstName: true, lastName: true },
    });

    let created = 0;

    for (const adv of advisors) {
      const totalLeads = await this.prisma.lead.count({
        where: { assignedToId: adv.id, deletedAt: null, isHistorical: false, createdAt: { gte: thirtyDaysAgo } },
      });
      if (totalLeads < 5) continue;

      const advanced = await this.prisma.lead.count({
        where: {
          assignedToId: adv.id, deletedAt: null, isHistorical: false, createdAt: { gte: thirtyDaysAgo },
          status: { in: [...LATE_STAGES, 'CERRADO_GANADO'] as any },
        },
      });

      const convRate = Math.round((advanced / totalLeads) * 100);
      if (convRate >= 15) continue; // 15% is minimum acceptable

      const existing = await this.prisma.salesAlert.findFirst({
        where: { advisorId: adv.id, type: 'low_conversion', status: { in: ['open', 'acknowledged'] } },
      });
      if (existing) continue;

      const severity = convRate < 5 ? 'high' : 'medium';

      await this.prisma.salesAlert.create({
        data: {
          type: 'low_conversion',
          severity,
          priorityScore: Math.round(Math.max(0, 70 - convRate * 3)),
          advisorId: adv.id,
          title: `Baja conversion: ${adv.firstName} ${adv.lastName} (${convRate}%)`,
          message: `${adv.firstName} ${adv.lastName} tiene ${convRate}% de conversion (${advanced}/${totalLeads} leads) en los ultimos 30 dias. Requiere revision de proceso y coaching.`,
          recommendedAction: 'escalate',
          metadata: { conversionRate: convRate, totalLeads, advanced },
        },
      });
      created++;
    }
    return created;
  }

  // ─────────────────────────────────────────────────────────
  // 5. Zone with high opportunity and low attention
  // ─────────────────────────────────────────────────────────

  private async alertZoneOpportunity(): Promise<number> {
    const zones = ['BAJIO', 'OCCIDENTE', 'CENTRO', 'NORTE', 'OTROS'];
    let created = 0;

    for (const zone of zones) {
      const leads = await this.prisma.lead.findMany({
        where: { zone: zone as any, deletedAt: null, isHistorical: false, status: { notIn: TERMINAL as any } },
        select: { id: true, estimatedValue: true, lastContactedAt: true, createdAt: true },
      });

      if (leads.length < 3) continue;

      const pipelineValue = leads.reduce((s, l) => s + (l.estimatedValue || 0), 0);
      const unattended = leads.filter(l => {
        const days = this.daysSince(l.lastContactedAt) ?? this.daysSince(l.createdAt) ?? 0;
        return days >= 7;
      }).length;

      const unattendedPct = Math.round((unattended / leads.length) * 100);
      if (unattendedPct < 40) continue;

      const existing = await this.prisma.salesAlert.findFirst({
        where: { zone, type: 'zone_opportunity', status: { in: ['open', 'acknowledged'] } },
      });
      if (existing) continue;

      const severity = unattendedPct >= 70 ? 'critical' : unattendedPct >= 50 ? 'high' : 'medium';

      await this.prisma.salesAlert.create({
        data: {
          type: 'zone_opportunity',
          severity,
          priorityScore: Math.min(100, unattendedPct + Math.round(pipelineValue / 500000)),
          title: `Zona ${zone}: ${unattendedPct}% leads sin atencion`,
          message: `Zona ${zone}: ${unattended} de ${leads.length} leads sin atencion (${unattendedPct}%). Pipeline total: $${pipelineValue.toLocaleString('es-MX')}. Oportunidad de captura significativa.`,
          recommendedAction: 'escalate',
          estimatedValue: pipelineValue,
          zone,
          metadata: { totalLeads: leads.length, unattended, pipelineValue, unattendedPct },
        },
      });
      created++;
    }
    return created;
  }

  // ─────────────────────────────────────────────────────────
  // 6. Weekly target at risk
  // ─────────────────────────────────────────────────────────

  private async alertWeeklyTargetRisk(): Promise<number> {
    const weekAgo = new Date(Date.now() - 7 * 86400000);

    const newLeads = await this.prisma.lead.count({
      where: { createdAt: { gte: weekAgo }, deletedAt: null, isHistorical: false },
    });

    const visits = await this.prisma.visit.count({
      where: { visitDate: { gte: weekAgo } },
    });

    const deals = await this.prisma.lead.count({
      where: { status: 'CERRADO_GANADO' as any, isHistorical: false, convertedAt: { gte: weekAgo } },
    });

    // Thresholds (configurable targets)
    const targets = { leads: 10, visits: 5, deals: 1 };
    const issues: string[] = [];

    if (newLeads < targets.leads * 0.5) issues.push(`Solo ${newLeads} leads nuevos (meta: ${targets.leads})`);
    if (visits < targets.visits * 0.5) issues.push(`Solo ${visits} visitas (meta: ${targets.visits})`);
    if (deals < targets.deals) issues.push(`${deals} cierre${deals !== 1 ? 's' : ''} (meta: ${targets.deals})`);

    if (issues.length === 0) return 0;

    const existing = await this.prisma.salesAlert.findFirst({
      where: { type: 'weekly_target_risk', status: { in: ['open', 'acknowledged'] }, createdAt: { gte: weekAgo } },
    });
    if (existing) return 0;

    await this.prisma.salesAlert.create({
      data: {
        type: 'weekly_target_risk',
        severity: issues.length >= 3 ? 'critical' : issues.length >= 2 ? 'high' : 'medium',
        priorityScore: Math.min(100, issues.length * 30),
        title: `Meta semanal en riesgo (${issues.length} indicadores)`,
        message: issues.join('. ') + '.',
        recommendedAction: 'escalate',
        metadata: { newLeads, visits, deals, targets, issues },
      },
    });
    return 1;
  }

  // ─────────────────────────────────────────────────────────
  // 7. High-value leads without recent contact
  // ─────────────────────────────────────────────────────────

  private async alertHighValueNoContact(): Promise<number> {
    const leads = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        isHistorical: false,
        status: { notIn: TERMINAL as any },
        estimatedValue: { gte: 200000 },
      },
      select: {
        id: true, companyName: true, contactName: true, contactPhone: true,
        zone: true, status: true, estimatedValue: true,
        lastContactedAt: true, createdAt: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    let created = 0;

    for (const lead of leads) {
      const days = this.daysSince(lead.lastContactedAt) ?? this.daysSince(lead.createdAt) ?? 0;
      if (days < 5) continue;

      const existing = await this.prisma.salesAlert.findFirst({
        where: { leadId: lead.id, type: 'high_value_no_contact', status: { in: ['open', 'acknowledged'] } },
      });
      if (existing) continue;

      const severity = (lead.estimatedValue || 0) >= 1000000 ? 'critical' : days >= 10 ? 'critical' : 'high';
      const priority = Math.min(100, days * 4 + Math.round((lead.estimatedValue || 0) / 100000));
      const risk = Math.min(100, days * 5 + (LATE_STAGES.includes(lead.status as string) ? 25 : 0));

      await this.prisma.salesAlert.create({
        data: {
          type: 'high_value_no_contact',
          severity,
          priorityScore: Math.round(priority),
          leadId: lead.id,
          advisorId: lead.assignedTo?.id || null,
          title: `Alto valor sin contacto: ${lead.companyName} ($${((lead.estimatedValue || 0) / 1000).toFixed(0)}K)`,
          message: `${lead.companyName} — $${(lead.estimatedValue || 0).toLocaleString('es-MX')} — ${days} dias sin contacto. Riesgo de perdida: ${risk}%.`,
          suggestion: this.buildSuggestion(lead, 'call', days),
          daysSinceActivity: days,
          riskOfLoss: Math.round(risk),
          recommendedAction: 'call',
          estimatedValue: lead.estimatedValue,
          zone: lead.zone as string,
          metadata: { contactName: lead.contactName, contactPhone: lead.contactPhone, status: lead.status },
        },
      });
      created++;
    }
    return created;
  }

  // ─────────────────────────────────────────────────────────
  // 8. Final-stage deals without movement
  // ─────────────────────────────────────────────────────────

  private async alertFinalStageStuck(): Promise<number> {
    const deals = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        isHistorical: false,
        status: { in: ['ESPERANDO_CONTRATO', 'PENDIENTE_PAGO'] as any },
      },
      select: {
        id: true, companyName: true, contactName: true, contactPhone: true,
        zone: true, status: true, estimatedValue: true,
        lastContactedAt: true, createdAt: true, updatedAt: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    let created = 0;

    for (const deal of deals) {
      const daysSince = this.daysSince(deal.lastContactedAt) ?? this.daysSince(deal.updatedAt) ?? 0;
      if (daysSince < 2) continue;

      const existing = await this.prisma.salesAlert.findFirst({
        where: { leadId: deal.id, type: 'final_stage_stuck', status: { in: ['open', 'acknowledged'] } },
      });
      if (existing) continue;

      const severity = daysSince >= 7 ? 'critical' : daysSince >= 4 ? 'high' : 'medium';
      const risk = Math.min(100, daysSince * 8 + 30);

      await this.prisma.salesAlert.create({
        data: {
          type: 'final_stage_stuck',
          severity,
          priorityScore: Math.min(100, daysSince * 8 + 40),
          leadId: deal.id,
          advisorId: deal.assignedTo?.id || null,
          title: `Etapa final sin movimiento: ${deal.companyName}`,
          message: `${deal.companyName} en "${STATUS_LABELS[deal.status as string]}" desde hace ${daysSince} dias. Valor: $${(deal.estimatedValue || 0).toLocaleString('es-MX')}. Riesgo: ${risk}%.`,
          suggestion: this.buildClosingSuggestion(deal),
          daysSinceActivity: daysSince,
          stageDuration: daysSince,
          riskOfLoss: Math.round(risk),
          recommendedAction: 'call',
          estimatedValue: deal.estimatedValue,
          zone: deal.zone as string,
          metadata: { stage: deal.status, contactName: deal.contactName, contactPhone: deal.contactPhone },
        },
      });
      created++;
    }
    return created;
  }

  // ─────────────────────────────────────────────────────────
  // ALERT CENTER VIEW
  // ─────────────────────────────────────────────────────────

  async getAlertCenter(filters?: { status?: string; advisorId?: string; zone?: string; type?: string; severity?: string }): Promise<AlertCenterView> {
    const where: any = {};
    if (filters?.status) where.status = filters.status;
    else where.status = { in: ['open', 'acknowledged', 'escalated'] };
    if (filters?.advisorId) where.advisorId = filters.advisorId;
    if (filters?.zone) where.zone = filters.zone;
    if (filters?.type) where.type = filters.type;
    if (filters?.severity) where.severity = filters.severity;

    const alerts = await this.prisma.salesAlert.findMany({
      where,
      orderBy: [{ priorityScore: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });

    const enriched = await this.enrichAlerts(alerts);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const recentlyResolved = await this.prisma.salesAlert.findMany({
      where: { status: 'resolved', resolvedAt: { gte: today } },
      orderBy: { resolvedAt: 'desc' },
      take: 20,
    });

    // By type
    const typeMap: Record<string, { count: number; critical: number }> = {};
    enriched.forEach(a => {
      if (!typeMap[a.type]) typeMap[a.type] = { count: 0, critical: 0 };
      typeMap[a.type].count++;
      if (a.severity === 'critical') typeMap[a.type].critical++;
    });

    // By advisor
    const advisorMap: Record<string, { name: string; open: number; critical: number }> = {};
    enriched.forEach(a => {
      if (!a.advisorId) return;
      if (!advisorMap[a.advisorId]) advisorMap[a.advisorId] = { name: a.advisorName || 'Unknown', open: 0, critical: 0 };
      advisorMap[a.advisorId].open++;
      if (a.severity === 'critical') advisorMap[a.advisorId].critical++;
    });

    // Advisor resolution stats
    const advisorResolutions: Record<string, { resolved: number; totalHours: number }> = {};
    const allResolved = await this.prisma.salesAlert.findMany({
      where: { status: 'resolved', resolvedAt: { not: null } },
      select: { advisorId: true, createdAt: true, resolvedAt: true },
    });
    allResolved.forEach(a => {
      if (!a.advisorId || !a.resolvedAt) return;
      if (!advisorResolutions[a.advisorId]) advisorResolutions[a.advisorId] = { resolved: 0, totalHours: 0 };
      advisorResolutions[a.advisorId].resolved++;
      advisorResolutions[a.advisorId].totalHours += (new Date(a.resolvedAt).getTime() - new Date(a.createdAt).getTime()) / 3600000;
    });

    // By zone
    const zoneMap: Record<string, { open: number; critical: number; pipelineAtRisk: number }> = {};
    enriched.forEach(a => {
      const z = a.zone || 'Sin Zona';
      if (!zoneMap[z]) zoneMap[z] = { open: 0, critical: 0, pipelineAtRisk: 0 };
      zoneMap[z].open++;
      if (a.severity === 'critical') zoneMap[z].critical++;
      if (a.riskOfLoss && a.riskOfLoss >= 50 && a.estimatedValue) zoneMap[z].pipelineAtRisk += a.estimatedValue;
    });

    const critical = enriched.filter(a => a.severity === 'critical');
    const high = enriched.filter(a => a.severity === 'high');
    const medium = enriched.filter(a => a.severity === 'medium');
    const low = enriched.filter(a => a.severity === 'low');

    const pipelineAtRisk = enriched
      .filter(a => a.riskOfLoss && a.riskOfLoss >= 50 && a.estimatedValue)
      .reduce((s, a) => s + (a.estimatedValue || 0), 0);

    const resolved = allResolved.length;
    const totalResHours = allResolved.reduce((s, a) => {
      if (!a.resolvedAt) return s;
      return s + (new Date(a.resolvedAt).getTime() - new Date(a.createdAt).getTime()) / 3600000;
    }, 0);

    const triggers = await this.prisma.salesAlert.count({
      where: { triggerAction: { not: null }, triggerSentAt: { not: null } },
    });

    return {
      kpis: {
        totalOpen: enriched.length,
        critical: critical.length,
        high: high.length,
        medium: medium.length,
        low: low.length,
        escalated: enriched.filter(a => a.status === 'escalated').length,
        resolvedToday: recentlyResolved.length,
        avgResolutionHours: resolved > 0 ? Math.round(totalResHours / resolved) : 0,
        pipelineAtRisk,
        triggersActive: triggers,
      },
      critical,
      high,
      medium,
      low,
      recentlyResolved: await this.enrichAlerts(recentlyResolved),
      byType: Object.entries(typeMap).map(([type, v]) => ({ type, label: ALERT_TYPE_LABELS[type] || type, ...v })).sort((a, b) => b.count - a.count),
      byAdvisor: Object.entries(advisorMap).map(([advisorId, v]) => {
        const res = advisorResolutions[advisorId] || { resolved: 0, totalHours: 0 };
        return {
          advisorId,
          ...v,
          resolved: res.resolved,
          avgResolutionHours: res.resolved > 0 ? Math.round(res.totalHours / res.resolved) : 0,
        };
      }).sort((a, b) => b.critical - a.critical),
      byZone: Object.entries(zoneMap).map(([zone, v]) => ({
        zone,
        ...v,
        opportunityScore: Math.round(v.pipelineAtRisk > 0 ? Math.min(100, v.pipelineAtRisk / 100000 + v.open * 5) : v.open * 5),
      })).sort((a, b) => b.open - a.open),
    };
  }

  // ─────────────────────────────────────────────────────────
  // ADVISOR VIEW
  // ─────────────────────────────────────────────────────────

  async getAdvisorView(advisorId: string): Promise<AdvisorView> {
    const advisor = await this.prisma.user.findUnique({
      where: { id: advisorId },
      select: { id: true, firstName: true, lastName: true },
    });

    const alerts = await this.prisma.salesAlert.findMany({
      where: { advisorId, status: { in: ['open', 'acknowledged'] } },
      orderBy: [{ priorityScore: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });

    const tasks = await this.prisma.salesTask.findMany({
      where: { advisorId, status: { in: ['pending', 'in_progress'] } },
      orderBy: [{ priority: 'asc' }, { dueDate: 'asc' }],
      take: 30,
    });

    const enriched = await this.enrichAlerts(alerts);
    const critical = enriched.filter(a => a.severity === 'critical').length;
    const noFollowup = enriched.filter(a => a.type === 'no_followup').length;
    const dealsStuck = enriched.filter(a => ['stalled_deal', 'final_stage_stuck'].includes(a.type)).length;

    const resolved = await this.prisma.salesAlert.findMany({
      where: { advisorId, status: 'resolved', resolvedAt: { not: null } },
      select: { createdAt: true, resolvedAt: true },
      take: 20,
      orderBy: { resolvedAt: 'desc' },
    });

    const avgRes = resolved.length > 0
      ? Math.round(resolved.reduce((s, r) => s + (new Date(r.resolvedAt!).getTime() - new Date(r.createdAt).getTime()) / 3600000, 0) / resolved.length)
      : 0;

    return {
      advisorId,
      advisorName: advisor ? `${advisor.firstName} ${advisor.lastName}` : 'Unknown',
      openAlerts: enriched,
      pendingTasks: tasks,
      kpis: {
        openAlerts: enriched.length,
        criticalAlerts: critical,
        pendingTasks: tasks.length,
        leadsNoFollowup: noFollowup,
        dealsStuck,
        avgResponseTime: avgRes,
      },
    };
  }

  // ─────────────────────────────────────────────────────────
  // SUPERVISOR VIEW
  // ─────────────────────────────────────────────────────────

  async getSupervisorView(): Promise<SupervisorView> {
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const advisors = await this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true },
      select: {
        id: true, firstName: true, lastName: true,
        _count: { select: { assignedLeads: { where: { deletedAt: null, isHistorical: false } } } },
      },
    });

    const advisorStats = await Promise.all(advisors.map(async adv => {
      const [open, critical, resolvedToday, allResolved, visitsWeek] = await Promise.all([
        this.prisma.salesAlert.count({ where: { advisorId: adv.id, status: { in: ['open', 'acknowledged'] } } }),
        this.prisma.salesAlert.count({ where: { advisorId: adv.id, status: { in: ['open', 'acknowledged'] }, severity: 'critical' } }),
        this.prisma.salesAlert.count({ where: { advisorId: adv.id, status: 'resolved', resolvedAt: { gte: today } } }),
        this.prisma.salesAlert.findMany({
          where: { advisorId: adv.id, status: 'resolved', resolvedAt: { not: null } },
          select: { createdAt: true, resolvedAt: true },
          take: 50,
        }),
        this.prisma.visit.count({ where: { visitedById: adv.id, visitDate: { gte: weekAgo } } }),
      ]);

      const avgHours = allResolved.length > 0
        ? Math.round(allResolved.reduce((s, r) => s + (new Date(r.resolvedAt!).getTime() - new Date(r.createdAt).getTime()) / 3600000, 0) / allResolved.length)
        : 0;

      const perf = Math.max(0, 100 - critical * 15 - open * 3 + resolvedToday * 10 + visitsWeek * 5);

      return {
        id: adv.id,
        name: `${adv.firstName} ${adv.lastName}`,
        openAlerts: open,
        criticalAlerts: critical,
        resolvedToday,
        avgResolutionHours: avgHours,
        leadsAssigned: adv._count.assignedLeads,
        visitsThisWeek: visitsWeek,
        performanceScore: Math.min(100, Math.round(perf)),
      };
    }));

    const escalated = await this.prisma.salesAlert.findMany({
      where: { status: 'escalated' },
      orderBy: { priorityScore: 'desc' },
      take: 20,
    });

    const teamAlerts = await this.prisma.salesAlert.findMany({
      where: { status: { in: ['open', 'acknowledged'] }, severity: { in: ['critical', 'high'] } },
      orderBy: { priorityScore: 'desc' },
      take: 30,
    });

    const active = advisorStats.filter(a => a.leadsAssigned > 0);
    const totalOpen = active.reduce((s, a) => s + a.openAlerts, 0);
    const totalCritical = active.reduce((s, a) => s + a.criticalAlerts, 0);
    const totalResolved = active.reduce((s, a) => s + a.resolvedToday, 0);
    const totalAvgHours = active.length > 0 ? Math.round(active.reduce((s, a) => s + a.avgResolutionHours, 0) / active.length) : 0;

    const sorted = [...active].sort((a, b) => a.performanceScore - b.performanceScore);

    return {
      advisors: active.sort((a, b) => b.criticalAlerts - a.criticalAlerts),
      teamKpis: {
        totalOpenAlerts: totalOpen,
        totalCritical,
        totalResolvedToday: totalResolved,
        teamAvgResolutionHours: totalAvgHours,
        worstPerformer: sorted[0]?.name || 'N/A',
        bestPerformer: sorted[sorted.length - 1]?.name || 'N/A',
      },
      escalatedAlerts: await this.enrichAlerts(escalated),
      teamAlerts: await this.enrichAlerts(teamAlerts),
    };
  }

  // ─────────────────────────────────────────────────────────
  // DIRECTOR VIEW
  // ─────────────────────────────────────────────────────────

  async getDirectorView(): Promise<DirectorView> {
    const strategic = await this.prisma.salesAlert.findMany({
      where: {
        status: { in: ['open', 'acknowledged', 'escalated'] },
        OR: [
          { type: { in: ['zone_opportunity', 'weekly_target_risk', 'low_conversion'] } },
          { severity: 'critical', estimatedValue: { gte: 500000 } },
        ],
      },
      orderBy: { priorityScore: 'desc' },
      take: 20,
    });

    const zones = ['BAJIO', 'OCCIDENTE', 'CENTRO', 'NORTE', 'OTROS'];
    const zoneStats = await Promise.all(zones.map(async zone => {
      const openAlerts = await this.prisma.salesAlert.count({
        where: { zone, status: { in: ['open', 'acknowledged'] } },
      });

      const leads = await this.prisma.lead.findMany({
        where: { zone: zone as any, deletedAt: null, isHistorical: false, status: { notIn: TERMINAL as any } },
        select: { id: true, estimatedValue: true, lastContactedAt: true, status: true },
      });

      const pipelineAtRisk = leads
        .filter(l => { const d = this.daysSince(l.lastContactedAt); return d !== null && d >= 7; })
        .reduce((s, l) => s + (l.estimatedValue || 0), 0);

      const unattended = leads.filter(l => { const d = this.daysSince(l.lastContactedAt); return d === null || d >= 14; }).length;

      const won = await this.prisma.lead.count({
        where: { zone: zone as any, isHistorical: false, status: 'CERRADO_GANADO' as any },
      });
      const total = await this.prisma.lead.count({
        where: { zone: zone as any, deletedAt: null, isHistorical: false },
      });
      const conv = total > 0 ? Math.round((won / total) * 100) : 0;

      return {
        zone,
        openAlerts,
        pipelineAtRisk,
        opportunityUnattended: unattended,
        conversionRate: conv,
        riskScore: Math.min(100, openAlerts * 5 + Math.round(pipelineAtRisk / 200000) + unattended * 3),
      };
    }));

    // System health
    const totalActive = await this.prisma.lead.count({ where: { deletedAt: null, isHistorical: false, status: { notIn: TERMINAL as any } } });
    const totalOpen = await this.prisma.salesAlert.count({ where: { status: { in: ['open', 'acknowledged'] } } });
    const totalResolved = await this.prisma.salesAlert.count({ where: { status: 'resolved' } });
    const totalAll = totalOpen + totalResolved;
    const criticalUnresolved = await this.prisma.salesAlert.count({
      where: { status: { in: ['open', 'acknowledged'] }, severity: 'critical' },
    });

    // Weekly trend (last 4 weeks)
    const fourWeeksAgo = new Date(Date.now() - 28 * 86400000);
    const recentAlerts = await this.prisma.salesAlert.findMany({
      where: { createdAt: { gte: fourWeeksAgo } },
      select: { severity: true, status: true, createdAt: true },
    });

    const weekMap: Record<string, { created: number; resolved: number; critical: number }> = {};
    recentAlerts.forEach(a => {
      const d = new Date(a.createdAt);
      const weekNum = Math.ceil(((d.getTime() - fourWeeksAgo.getTime()) / 86400000) / 7);
      const key = `W${weekNum}`;
      if (!weekMap[key]) weekMap[key] = { created: 0, resolved: 0, critical: 0 };
      weekMap[key].created++;
      if (a.status === 'resolved') weekMap[key].resolved++;
      if (a.severity === 'critical') weekMap[key].critical++;
    });

    return {
      strategicAlerts: await this.enrichAlerts(strategic),
      zones: zoneStats.sort((a, b) => b.riskScore - a.riskScore),
      systemHealth: {
        totalActiveLeads: totalActive,
        totalOpenAlerts: totalOpen,
        alertsPerLead: totalActive > 0 ? Math.round((totalOpen / totalActive) * 100) / 100 : 0,
        resolutionRate: totalAll > 0 ? Math.round((totalResolved / totalAll) * 100) : 0,
        criticalUnresolved,
        avgDaysToResolve: 0,
      },
      weeklyTrend: Object.entries(weekMap).map(([week, v]) => ({ week, ...v })),
    };
  }

  // ─────────────────────────────────────────────────────────
  // ZONE VIEW
  // ─────────────────────────────────────────────────────────

  async getZoneView(zone: string): Promise<ZoneView> {
    const alerts = await this.prisma.salesAlert.findMany({
      where: { zone, status: { in: ['open', 'acknowledged', 'escalated'] } },
      orderBy: { priorityScore: 'desc' },
      take: 50,
    });

    const leads = await this.prisma.lead.findMany({
      where: { zone: zone as any, deletedAt: null, isHistorical: false, status: { notIn: TERMINAL as any } },
      select: { id: true, estimatedValue: true, lastContactedAt: true, status: true },
    });

    const pipelineValue = leads.reduce((s, l) => s + (l.estimatedValue || 0), 0);
    const unattended = leads.filter(l => {
      const d = this.daysSince(l.lastContactedAt);
      return d === null || d >= 7;
    }).length;
    const pipelineAtRisk = leads
      .filter(l => { const d = this.daysSince(l.lastContactedAt); return d !== null && d >= 7; })
      .reduce((s, l) => s + (l.estimatedValue || 0), 0);

    const won = await this.prisma.lead.count({ where: { zone: zone as any, isHistorical: false, status: 'CERRADO_GANADO' as any } });
    const total = await this.prisma.lead.count({ where: { zone: zone as any, deletedAt: null, isHistorical: false } });

    const enriched = await this.enrichAlerts(alerts);

    return {
      zone,
      alerts: enriched,
      kpis: {
        openAlerts: enriched.length,
        critical: enriched.filter(a => a.severity === 'critical').length,
        pipelineValue,
        pipelineAtRisk,
        leadsTotal: leads.length,
        leadsUnattended: unattended,
        conversionRate: total > 0 ? Math.round((won / total) * 100) : 0,
        opportunityScore: Math.min(100, Math.round(pipelineValue / 200000 + (leads.length - unattended) * 3)),
      },
    };
  }

  // ─────────────────────────────────────────────────────────
  // ACTIONS
  // ─────────────────────────────────────────────────────────

  async resolveAlert(id: string, data: { actionTaken: string; resolutionNotes?: string; resolvedBy?: string }) {
    return this.prisma.salesAlert.update({
      where: { id },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: data.resolvedBy,
        actionTaken: data.actionTaken,
        resolutionNotes: data.resolutionNotes,
      },
    });
  }

  async acknowledgeAlert(id: string) {
    return this.prisma.salesAlert.update({
      where: { id },
      data: { status: 'acknowledged', acknowledgedAt: new Date() },
    });
  }

  async escalateAlert(id: string, to: string) {
    return this.prisma.salesAlert.update({
      where: { id },
      data: { status: 'escalated', escalatedTo: to },
    });
  }

  async dismissAlert(id: string, reason?: string) {
    return this.prisma.salesAlert.update({
      where: { id },
      data: { status: 'dismissed', resolvedAt: new Date(), resolutionNotes: reason || 'Dismissed' },
    });
  }

  async assignAlert(id: string, assignedToId: string) {
    return this.prisma.salesAlert.update({
      where: { id },
      data: { assignedToId },
    });
  }

  async triggerAction(id: string, action: string) {
    return this.prisma.salesAlert.update({
      where: { id },
      data: { triggerAction: action, triggerSentAt: new Date() },
    });
  }

  // ─────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────

  private async enrichAlerts(alerts: any[]): Promise<EnrichedAlert[]> {
    const leadIds = alerts.filter(a => a.leadId).map(a => a.leadId);
    const advisorIds = alerts.filter(a => a.advisorId).map(a => a.advisorId);
    const assignedIds = alerts.filter(a => a.assignedToId).map(a => a.assignedToId);

    const [leads, users] = await Promise.all([
      leadIds.length > 0
        ? this.prisma.lead.findMany({
            where: { id: { in: leadIds } },
            select: { id: true, companyName: true, contactName: true, contactPhone: true, status: true },
          })
        : [],
      [...new Set([...advisorIds, ...assignedIds])].length > 0
        ? this.prisma.user.findMany({
            where: { id: { in: [...new Set([...advisorIds, ...assignedIds])] } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [],
    ]);

    const leadMap = new Map(leads.map(l => [l.id, l]));
    const userMap = new Map(users.map(u => [u.id, u]));

    return alerts.map(a => {
      const lead = a.leadId ? leadMap.get(a.leadId) : null;
      const advisor = a.advisorId ? userMap.get(a.advisorId) : null;
      const assigned = a.assignedToId ? userMap.get(a.assignedToId) : null;

      const resHours = a.resolvedAt && a.createdAt
        ? Math.round((new Date(a.resolvedAt).getTime() - new Date(a.createdAt).getTime()) / 3600000)
        : null;

      return {
        id: a.id,
        type: a.type,
        typeLabel: ALERT_TYPE_LABELS[a.type] || a.type,
        severity: a.severity,
        priorityScore: a.priorityScore || 50,
        title: a.title,
        message: a.message,
        suggestion: a.suggestion,
        status: a.status,
        leadId: a.leadId,
        advisorId: a.advisorId,
        assignedToId: a.assignedToId,
        zone: a.zone,
        estimatedValue: a.estimatedValue,
        daysSinceActivity: a.daysSinceActivity,
        stageDuration: a.stageDuration,
        riskOfLoss: a.riskOfLoss,
        recommendedAction: a.recommendedAction,
        actionTaken: a.actionTaken,
        triggerAction: a.triggerAction,
        triggerSentAt: a.triggerSentAt?.toISOString() || null,
        resolvedAt: a.resolvedAt?.toISOString() || null,
        resolvedBy: a.resolvedBy,
        resolutionNotes: a.resolutionNotes,
        acknowledgedAt: a.acknowledgedAt?.toISOString() || null,
        escalatedTo: a.escalatedTo,
        metadata: a.metadata,
        createdAt: a.createdAt.toISOString(),
        leadName: lead?.companyName || null,
        leadContact: lead?.contactName || null,
        leadPhone: lead?.contactPhone || null,
        leadStatus: lead?.status || null,
        advisorName: advisor ? `${advisor.firstName} ${advisor.lastName}` : null,
        assignedToName: assigned ? `${assigned.firstName} ${assigned.lastName}` : null,
        resolutionTimeHours: resHours,
      };
    });
  }

  private daysSince(date: Date | string | null): number | null {
    if (!date) return null;
    return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  }

  private buildSuggestion(lead: any, action: string, days: number): string {
    const name = lead.contactName?.split(' ')[0] || 'estimado cliente';
    if (action === 'call') {
      return `Llamar a ${lead.contactName} (${lead.contactPhone || 'sin tel'}). "${name}, te llamo de Ingenieria Electrica Alanis para dar seguimiento a tu proyecto. ¿Tienes unos minutos?"`;
    }
    if (action === 'escalate') {
      return `Escalar a supervisor. Lead con ${days} dias sin atencion. Reasignar o intervenir directamente.`;
    }
    return `Hola ${name}, te escribo de IEA para dar seguimiento. ¿Tienes disponibilidad esta semana para platicar sobre tu proyecto?`;
  }

  private buildClosingSuggestion(deal: any): string {
    const name = deal.contactName?.split(' ')[0] || 'estimado cliente';
    const stage = deal.status as string;
    if (stage === 'PENDIENTE_PAGO') {
      return `Llamar a ${deal.contactName}: "${name}, ¿pudiste revisar los detalles del pago? Estamos listos para arrancar tu proyecto."`;
    }
    if (stage === 'ESPERANDO_CONTRATO') {
      return `Llamar a ${deal.contactName}: "${name}, ¿revisaste el contrato? Si hay algo que aclarar, puedo agendar una llamada."`;
    }
    return `Contactar a ${deal.contactName}: "${name}, ¿como vas con la decision? Puedo resolver cualquier duda."`;
  }
}
