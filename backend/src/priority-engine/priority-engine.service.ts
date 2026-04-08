import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// ─── Constants ─────────────────────────────────────────────────

const TERMINAL_STATUSES = ['CERRADO_GANADO', 'CERRADO_PERDIDO', 'LEAD_BASURA', 'CONTACTAR_FUTURO'];

/** Funnel stage weights — deeper in funnel = closer to revenue */
const STAGE_WEIGHT: Record<string, number> = {
  PENDIENTE_CONTACTAR: 0,
  INTENTANDO_CONTACTAR: 1,
  EN_PROSPECCION: 3,
  AGENDAR_CITA: 5,
  ESPERANDO_COTIZACION: 7,
  COTIZACION_ENTREGADA: 9,
  ESPERANDO_CONTRATO: 11,
  PENDIENTE_PAGO: 12,
};

/** Base probability by stage — empirical solar sales funnel conversion */
const STAGE_PROBABILITY: Record<string, number> = {
  PENDIENTE_CONTACTAR: 0.05,
  INTENTANDO_CONTACTAR: 0.08,
  EN_PROSPECCION: 0.15,
  AGENDAR_CITA: 0.25,
  ESPERANDO_COTIZACION: 0.40,
  COTIZACION_ENTREGADA: 0.55,
  ESPERANDO_CONTRATO: 0.75,
  PENDIENTE_PAGO: 0.90,
};

/** Source quality multiplier — some sources convert better */
const SOURCE_MULTIPLIER: Record<string, number> = {
  REFERRAL: 1.4,
  ZOHO_CRM: 1.2,
  TRADE_SHOW: 1.15,
  WEBSITE: 1.1,
  COLD_CALL: 0.8,
  MANUAL: 0.9,
  OTHER: 1.0,
};

/** Ideal contact intervals by stage (days) — urgency reference */
const IDEAL_CONTACT_DAYS: Record<string, number> = {
  PENDIENTE_CONTACTAR: 1,
  INTENTANDO_CONTACTAR: 2,
  EN_PROSPECCION: 5,
  AGENDAR_CITA: 3,
  ESPERANDO_COTIZACION: 4,
  COTIZACION_ENTREGADA: 3,
  ESPERANDO_CONTRATO: 2,
  PENDIENTE_PAGO: 1,
};

// ─── Types ─────────────────────────────────────────────────────

export interface LeadInput {
  id: string;
  companyName: string;
  contactName: string;
  contactPhone?: string | null;
  zone: string;
  status: string;
  source?: string | null;
  estimatedValue?: number | null;
  lastContactedAt?: Date | string | null;
  createdAt?: Date | string | null;
  assignedTo?: { id: string; firstName: string; lastName: string } | null;
}

export interface ScoredLead extends LeadInput {
  score: number;
  probability: number;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  daysSinceContact: number | null;
  leadAge: number | null;
  breakdown: ScoreBreakdown;
}

export interface ScoreBreakdown {
  stage: number;
  value: number;
  recency: number;
  source: number;
  aging: number;
  total: number;
}

export interface AdvisorPriorityList {
  advisorId: string;
  advisorName: string;
  topLeads: ScoredLead[];
  topDeals: ScoredLead[];
  urgentCount: number;
  totalScore: number;
  pipelineWeighted: number;
}

// ─── Service ───────────────────────────────────────────────────

@Injectable()
export class PriorityEngineService {
  constructor(private prisma: PrismaService) {}

  // ── Core scoring ─────────────────────────────────────

  /**
   * Score a single lead across all dimensions.
   * Returns total score (0–20), probability (0–1), urgency level, and full breakdown.
   */
  scoreLead(lead: LeadInput): ScoredLead {
    const daysSinceContact = this.daysSince(lead.lastContactedAt);
    const leadAge = this.daysSince(lead.createdAt);
    const breakdown = this.computeBreakdown(lead, daysSinceContact, leadAge);

    const probability = this.computeProbability(lead, daysSinceContact);
    const urgency = this.computeUrgency(lead, daysSinceContact);

    return {
      ...lead,
      score: breakdown.total,
      probability,
      urgency,
      daysSinceContact,
      leadAge,
      breakdown,
    };
  }

  /**
   * Score and rank a batch of leads. Returns sorted by score desc.
   */
  scoreLeads(leads: LeadInput[]): ScoredLead[] {
    return leads
      .map((l) => this.scoreLead(l))
      .sort((a, b) => b.score - a.score);
  }

  // ── Aggregate queries ────────────────────────────────

  /**
   * Top leads of the day: all active leads, scored and ranked.
   */
  async getTopLeadsOfDay(limit = 15): Promise<ScoredLead[]> {
    const leads = await this.fetchActiveLeads();
    return this.scoreLeads(leads).slice(0, limit);
  }

  /**
   * Top deals to push: mid-to-late pipeline leads, scored.
   */
  async getTopDealsToPush(limit = 10): Promise<ScoredLead[]> {
    const leads = await this.fetchActiveLeads();
    const pushable = leads.filter((l) =>
      ['AGENDAR_CITA', 'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO'].includes(l.status),
    );
    return this.scoreLeads(pushable).slice(0, limit);
  }

  /**
   * Priority list grouped by advisor.
   */
  async getAdvisorPriorityLists(): Promise<AdvisorPriorityList[]> {
    const leads = await this.fetchActiveLeads();
    const scored = this.scoreLeads(leads);

    // Group by advisor
    const byAdvisor = new Map<string, ScoredLead[]>();
    const unassigned: ScoredLead[] = [];

    scored.forEach((s) => {
      if (s.assignedTo) {
        const key = s.assignedTo.id;
        if (!byAdvisor.has(key)) byAdvisor.set(key, []);
        byAdvisor.get(key)!.push(s);
      } else {
        unassigned.push(s);
      }
    });

    const lists: AdvisorPriorityList[] = [];

    byAdvisor.forEach((advisorLeads, advisorId) => {
      const advisor = advisorLeads[0].assignedTo!;
      const deals = advisorLeads.filter((l) =>
        ['AGENDAR_CITA', 'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO'].includes(l.status),
      );

      lists.push({
        advisorId,
        advisorName: `${advisor.firstName} ${advisor.lastName}`,
        topLeads: advisorLeads.slice(0, 10),
        topDeals: deals.slice(0, 5),
        urgentCount: advisorLeads.filter((l) => l.urgency === 'critical' || l.urgency === 'high').length,
        totalScore: advisorLeads.reduce((s, l) => s + l.score, 0),
        pipelineWeighted: advisorLeads.reduce((s, l) => s + (l.estimatedValue || 0) * l.probability, 0),
      });
    });

    // Add unassigned bucket
    if (unassigned.length > 0) {
      lists.push({
        advisorId: '__unassigned',
        advisorName: 'Sin Asignar',
        topLeads: unassigned.slice(0, 10),
        topDeals: unassigned.filter((l) =>
          ['AGENDAR_CITA', 'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO'].includes(l.status),
        ).slice(0, 5),
        urgentCount: unassigned.filter((l) => l.urgency === 'critical' || l.urgency === 'high').length,
        totalScore: unassigned.reduce((s, l) => s + l.score, 0),
        pipelineWeighted: unassigned.reduce((s, l) => s + (l.estimatedValue || 0) * l.probability, 0),
      });
    }

    // Sort advisors: most urgent first, then by pipeline weighted value
    lists.sort((a, b) => b.urgentCount - a.urgentCount || b.pipelineWeighted - a.pipelineWeighted);

    return lists;
  }

  // ── Private: Scoring components ──────────────────────

  private computeBreakdown(
    lead: LeadInput,
    daysSinceContact: number | null,
    leadAge: number | null,
  ): ScoreBreakdown {
    // 1. Stage score (0–12)
    const stage = STAGE_WEIGHT[lead.status] || 0;

    // 2. Value score (0–4) — solar installation thresholds MXN
    const val = lead.estimatedValue || 0;
    let value = 0;
    if (val > 500000) value = 4;
    else if (val > 300000) value = 3;
    else if (val > 150000) value = 2;
    else if (val > 50000) value = 1;

    // 3. Recency score (-3 to +2) — reward recent contact, penalize staleness
    let recency = 0;
    if (daysSinceContact === null) {
      recency = -3; // never contacted
    } else if (daysSinceContact <= 2) {
      recency = 2; // hot — just contacted
    } else if (daysSinceContact <= 7) {
      recency = 1; // warm
    } else if (daysSinceContact <= 14) {
      recency = 0; // cooling
    } else if (daysSinceContact <= 30) {
      recency = -1; // cold
    } else {
      recency = -3; // frozen
    }

    // 4. Source quality bonus (0–2)
    const sourceMultiplier = SOURCE_MULTIPLIER[lead.source || 'OTHER'] || 1.0;
    const source = sourceMultiplier >= 1.3 ? 2 : sourceMultiplier >= 1.1 ? 1 : 0;

    // 5. Lead aging modifier (-2 to +1) — new leads get a boost, stale ones penalized
    let aging = 0;
    if (leadAge !== null) {
      if (leadAge <= 7) aging = 1; // fresh lead
      else if (leadAge <= 30) aging = 0;
      else if (leadAge <= 90) aging = -1;
      else aging = -2; // very old lead
    }

    const total = Math.max(0, stage + value + recency + source + aging);

    return { stage, value, recency, source, aging, total };
  }

  private computeProbability(lead: LeadInput, daysSinceContact: number | null): number {
    let base = STAGE_PROBABILITY[lead.status] || 0.05;

    // Source adjustment
    const sourceMult = SOURCE_MULTIPLIER[lead.source || 'OTHER'] || 1.0;
    base *= sourceMult;

    // Inactivity decay — probability drops if lead is going cold
    if (daysSinceContact === null) {
      base *= 0.6; // never contacted = significantly lower
    } else if (daysSinceContact > 30) {
      base *= 0.5;
    } else if (daysSinceContact > 14) {
      base *= 0.7;
    } else if (daysSinceContact > 7) {
      base *= 0.85;
    }

    // Value confidence — higher deals tend to have longer sales cycles but higher engagement
    const val = lead.estimatedValue || 0;
    if (val > 300000) base *= 1.05;

    return Math.min(Math.round(base * 100) / 100, 0.99);
  }

  private computeUrgency(lead: LeadInput, daysSinceContact: number | null): 'critical' | 'high' | 'medium' | 'low' {
    const idealDays = IDEAL_CONTACT_DAYS[lead.status] || 7;

    // Late-stage + overdue contact = critical
    const isLateStage = ['PENDIENTE_PAGO', 'ESPERANDO_CONTRATO', 'COTIZACION_ENTREGADA'].includes(lead.status);
    const isOverdue = daysSinceContact !== null && daysSinceContact > idealDays;
    const isNeverContacted = daysSinceContact === null;
    const isVeryOverdue = daysSinceContact !== null && daysSinceContact > idealDays * 3;
    const isHighValue = (lead.estimatedValue || 0) > 300000;

    if (isLateStage && (isOverdue || isNeverContacted)) return 'critical';
    if (isHighValue && (isVeryOverdue || isNeverContacted)) return 'critical';
    if (isLateStage) return 'high';
    if (isOverdue && isHighValue) return 'high';
    if (isOverdue || isNeverContacted) return 'medium';
    return 'low';
  }

  // ── Private: Data fetching ───────────────────────────

  private async fetchActiveLeads(): Promise<LeadInput[]> {
    return this.prisma.lead.findMany({
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
  }

  // ── Public helpers (used by consuming services) ──────

  daysSince(date: Date | string | null | undefined): number | null {
    if (!date) return null;
    return Math.floor((Date.now() - new Date(date).getTime()) / (24 * 60 * 60 * 1000));
  }
}
