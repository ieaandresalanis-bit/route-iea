import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface CampaignLeaderboardEntry {
  campaignName: string;
  campaignGroup: string;
  channel: string;
  sourceType: string;
  leads: number;
  deals: number;
  clientsClosed: number;
  revenue: number;
  avgTicket: number;
  totalCost: number;
  costPerLead: number;
  costPerDeal: number;
  costPerClient: number;
  roi: number; // (revenue - cost) / cost
  conversionLeadToDeal: number;
  conversionDealToClose: number;
  conversionLeadToClose: number;
}

export interface FunnelStage {
  stage: string;
  label: string;
  count: number;
  pct: number; // % of total leads entering funnel
  dropOff: number; // % dropped from previous stage
}

export interface CampaignFunnel {
  campaignName: string;
  stages: FunnelStage[];
  leadToContact: number;
  contactToMeeting: number;
  meetingToQuote: number;
  quoteToClose: number;
  overallConversion: number;
}

export interface LeadQualityMetrics {
  campaignName: string;
  totalLeads: number;
  reachedQuote: number;
  pctReachedQuote: number;
  reachedClose: number;
  pctReachedClose: number;
  qualityScore: number; // 0-100
  avgDaysToContact: number | null;
  junkPct: number;
}

export interface TimeToCloseEntry {
  campaignName: string;
  channel: string;
  avgDaysToClose: number;
  medianDaysToClose: number;
  minDays: number;
  maxDays: number;
  sampleSize: number;
}

export interface BreakdownEntry {
  dimension: string;
  label: string;
  leads: number;
  deals: number;
  won: number;
  revenue: number;
  avgTicket: number;
  conversion: number;
  cost: number;
  roi: number;
}

export interface WeeklyPerformance {
  week: string; // "2025-W14"
  leads: number;
  deals: number;
  won: number;
  revenue: number;
  cost: number;
}

export interface MonthlyPerformance {
  month: string; // "2025-03"
  leads: number;
  deals: number;
  won: number;
  revenue: number;
  cost: number;
  roi: number;
}

export interface HeatmapCell {
  row: string;
  col: string;
  value: number;
  label: string;
}

export interface FullIntelligence {
  generatedAt: string;
  leaderboard: CampaignLeaderboardEntry[];
  funnels: CampaignFunnel[];
  leadQuality: LeadQualityMetrics[];
  timeToClose: TimeToCloseEntry[];
  weeklyTrend: WeeklyPerformance[];
  monthlyTrend: MonthlyPerformance[];
  byCenter: BreakdownEntry[];
  byIndustry: BreakdownEntry[];
  byAdvisor: BreakdownEntry[];
  byTicketRange: BreakdownEntry[];
  heatmapChannelZone: HeatmapCell[];
  heatmapCampaignMonth: HeatmapCell[];
  summary: IntelligenceSummary;
}

export interface IntelligenceSummary {
  totalLeads: number;
  totalDeals: number;
  totalWon: number;
  totalRevenue: number;
  totalCost: number;
  overallROI: number;
  overallConversion: number;
  bestCampaignByROI: string;
  bestCampaignByVolume: string;
  bestChannelByConversion: string;
  worstCampaign: string;
  avgDaysToClose: number;
  topInsights: string[];
}

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

/** Default cost estimates per channel when no campaign cost is set */
const DEFAULT_COST_PER_LEAD: Record<string, number> = {
  Meta: 180,
  Google: 250,
  TikTok: 120,
  Referral: 0,
  Outbound: 50,
  Organic: 0,
  Wiki: 0,
  WhatsApp: 0,
  Database: 10,
  Events: 300,
  Unknown: 0,
};

/** Map Zoho deal stages to simplified funnel stages */
const DEAL_STAGE_TO_FUNNEL: Record<string, string> = {
  // Zoho deal stages
  'Prospección': 'contact',
  'Calificado': 'contact',
  'Cita Agendada': 'meeting',
  'Cita Realizada': 'meeting',
  'Análisis de necesidades': 'meeting',
  'Propuesta de valor': 'quote',
  'Cotización Enviada': 'quote',
  'Cotización Entregada': 'quote',
  'En Negociación': 'negotiation',
  'Negociación': 'negotiation',
  'Esperando Contrato': 'negotiation',
  'Pendiente de Pago': 'negotiation',
  'Cerrado Ganado': 'closed_won',
  'Cerrado Anticipo Pagado': 'closed_won',
  'Vendida': 'closed_won',
  '1er Pago Ingresado': 'closed_won',
  '2do Pago ingresado': 'closed_won',
  'Cerrado Perdido': 'closed_lost',
  'Perdido': 'closed_lost',
  // Local LeadStatus mappings
  'PENDIENTE_CONTACTAR': 'lead',
  'INTENTANDO_CONTACTAR': 'lead',
  'EN_PROSPECCION': 'contact',
  'AGENDAR_CITA': 'meeting',
  'ESPERANDO_COTIZACION': 'quote',
  'COTIZACION_ENTREGADA': 'quote',
  'ESPERANDO_CONTRATO': 'negotiation',
  'PENDIENTE_PAGO': 'negotiation',
  'CERRADO_GANADO': 'closed_won',
  'CERRADO_PERDIDO': 'closed_lost',
  'CONTACTAR_FUTURO': 'lead',
  'LEAD_BASURA': 'junk',
};

const FUNNEL_ORDER = ['lead', 'contact', 'meeting', 'quote', 'negotiation', 'closed_won'];
const FUNNEL_LABELS: Record<string, string> = {
  lead: 'Lead',
  contact: 'Contacto',
  meeting: 'Cita',
  quote: 'Cotizacion',
  negotiation: 'Negociacion',
  closed_won: 'Cerrado',
};

const TICKET_RANGES = [
  { key: 'micro', label: '< $50K', min: 0, max: 50000 },
  { key: 'small', label: '$50K–$200K', min: 50000, max: 200000 },
  { key: 'medium', label: '$200K–$500K', min: 200000, max: 500000 },
  { key: 'large', label: '$500K–$2M', min: 500000, max: 2000000 },
  { key: 'enterprise', label: '> $2M', min: 2000000, max: Infinity },
];

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

@Injectable()
export class CampaignIntelligenceService {
  private readonly logger = new Logger(CampaignIntelligenceService.name);

  constructor(private prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────
  // MAIN: Full Intelligence Dashboard
  // ─────────────────────────────────────────────────────────

  async getFullIntelligence(): Promise<FullIntelligence> {
    const [attrs, campaigns, localLeads] = await Promise.all([
      this.prisma.campaignAttribution.findMany(),
      this.prisma.campaign.findMany(),
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false },
        select: {
          id: true, companyName: true, status: true, zone: true,
          industry: true, estimatedValue: true, source: true,
          assignedToId: true, createdAt: true, convertedAt: true,
          lastContactedAt: true,
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    ]);

    const campaignCostMap = new Map(campaigns.map(c => [c.name, c.totalCost || c.monthlyCost || 0]));

    // Build enriched records
    const records = attrs.map(a => {
      const localLead = localLeads.find(l => l.id === a.leadId);
      const campaignCost = campaignCostMap.get(a.campaignName || '') || 0;
      const estimatedCostPerLead = campaignCost > 0
        ? 0 // Will be calculated from total
        : (DEFAULT_COST_PER_LEAD[a.channel || 'Unknown'] || 0);

      // Determine funnel stage
      let funnelStage = 'lead';
      if (a.dealStage) {
        funnelStage = DEAL_STAGE_TO_FUNNEL[a.dealStage] || 'contact';
      } else if (localLead) {
        funnelStage = DEAL_STAGE_TO_FUNNEL[localLead.status as string] || 'lead';
      }

      return {
        ...a,
        localLead,
        funnelStage,
        estimatedCostPerLead,
        zone: localLead?.zone || this.inferZone(a),
        industry: localLead?.industry || null,
        advisorId: localLead?.assignedToId || null,
        advisorName: localLead?.assignedTo
          ? `${localLead.assignedTo.firstName} ${localLead.assignedTo.lastName}`
          : null,
        dealValue: a.dealAmount || localLead?.estimatedValue || 0,
        createdDate: a.createdAt,
      };
    });

    const leaderboard = this.buildLeaderboard(records, campaignCostMap);
    const funnels = this.buildFunnels(records);
    const leadQuality = this.buildLeadQuality(records);
    const timeToClose = this.buildTimeToClose(records, localLeads);
    const weeklyTrend = this.buildWeeklyTrend(records);
    const monthlyTrend = this.buildMonthlyTrend(records, campaignCostMap);
    const byCenter = this.buildBreakdown(records, 'zone', campaignCostMap);
    const byIndustry = this.buildBreakdown(records, 'industry', campaignCostMap);
    const byAdvisor = this.buildBreakdown(records, 'advisorName', campaignCostMap);
    const byTicketRange = this.buildTicketRangeBreakdown(records, campaignCostMap);
    const heatmapChannelZone = this.buildHeatmap(records, 'channel', 'zone');
    const heatmapCampaignMonth = this.buildCampaignMonthHeatmap(records);
    const summary = this.buildSummary(leaderboard, records, timeToClose);

    return {
      generatedAt: new Date().toISOString(),
      leaderboard,
      funnels,
      leadQuality,
      timeToClose,
      weeklyTrend,
      monthlyTrend,
      byCenter,
      byIndustry,
      byAdvisor,
      byTicketRange,
      heatmapChannelZone,
      heatmapCampaignMonth,
      summary,
    };
  }

  // ─────────────────────────────────────────────────────────
  // LEADERBOARD
  // ─────────────────────────────────────────────────────────

  private buildLeaderboard(records: any[], costMap: Map<string, number>): CampaignLeaderboardEntry[] {
    const map: Record<string, { leads: number; deals: number; won: number; revenue: number; channel: string; group: string; sourceType: string; estimatedCosts: number }> = {};

    records.forEach(r => {
      const key = r.campaignName || 'Sin Campana';
      if (!map[key]) map[key] = {
        leads: 0, deals: 0, won: 0, revenue: 0,
        channel: r.channel || 'Unknown',
        group: r.campaignGroup || 'Sin Grupo',
        sourceType: r.sourceType || 'unknown',
        estimatedCosts: 0,
      };
      map[key].leads++;
      if (r.dealStage || r.dealAmount) map[key].deals++;
      if (r.isWon) { map[key].won++; map[key].revenue += r.revenueAttributed || 0; }
      map[key].estimatedCosts += r.estimatedCostPerLead;
    });

    return Object.entries(map).map(([name, v]) => {
      const totalCost = costMap.get(name) || v.estimatedCosts;
      const avgTicket = v.won > 0 ? v.revenue / v.won : 0;
      return {
        campaignName: name,
        campaignGroup: v.group,
        channel: v.channel,
        sourceType: v.sourceType,
        leads: v.leads,
        deals: v.deals,
        clientsClosed: v.won,
        revenue: v.revenue,
        avgTicket,
        totalCost,
        costPerLead: v.leads > 0 ? totalCost / v.leads : 0,
        costPerDeal: v.deals > 0 ? totalCost / v.deals : 0,
        costPerClient: v.won > 0 ? totalCost / v.won : 0,
        roi: totalCost > 0 ? ((v.revenue - totalCost) / totalCost) * 100 : (v.revenue > 0 ? 999 : 0),
        conversionLeadToDeal: v.leads > 0 ? Math.round((v.deals / v.leads) * 100) : 0,
        conversionDealToClose: v.deals > 0 ? Math.round((v.won / v.deals) * 100) : 0,
        conversionLeadToClose: v.leads > 0 ? Math.round((v.won / v.leads) * 100) : 0,
      };
    }).sort((a, b) => b.leads - a.leads);
  }

  // ─────────────────────────────────────────────────────────
  // FUNNEL ANALYSIS
  // ─────────────────────────────────────────────────────────

  private buildFunnels(records: any[]): CampaignFunnel[] {
    // Group by campaign
    const byCampaign: Record<string, any[]> = {};
    records.forEach(r => {
      const key = r.campaignName || 'Sin Campana';
      if (!byCampaign[key]) byCampaign[key] = [];
      byCampaign[key].push(r);
    });

    // Build funnel for top campaigns (by volume)
    const topCampaigns = Object.entries(byCampaign)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 15);

    return topCampaigns.map(([name, recs]) => {
      const total = recs.length;
      const stageCounts: Record<string, number> = {};

      // Count records at each stage or beyond
      recs.forEach(r => {
        const stageIdx = FUNNEL_ORDER.indexOf(r.funnelStage);
        if (stageIdx < 0 && r.funnelStage === 'junk') return; // Exclude junk
        if (stageIdx < 0 && r.funnelStage === 'closed_lost') {
          // Lost deals at least reached contact
          stageCounts['lead'] = (stageCounts['lead'] || 0) + 1;
          stageCounts['contact'] = (stageCounts['contact'] || 0) + 1;
          return;
        }
        // All stages up to current
        for (let i = 0; i <= Math.max(stageIdx, 0); i++) {
          stageCounts[FUNNEL_ORDER[i]] = (stageCounts[FUNNEL_ORDER[i]] || 0) + 1;
        }
      });

      // Ensure lead includes everyone
      stageCounts['lead'] = total;

      const stages: FunnelStage[] = FUNNEL_ORDER.map((stage, idx) => {
        const count = stageCounts[stage] || 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const prev = idx > 0 ? (stageCounts[FUNNEL_ORDER[idx - 1]] || 0) : total;
        const dropOff = prev > 0 ? Math.round(((prev - count) / prev) * 100) : 0;
        return { stage, label: FUNNEL_LABELS[stage] || stage, count, pct, dropOff };
      });

      const getRate = (from: string, to: string) => {
        const fromCount = stageCounts[from] || 0;
        const toCount = stageCounts[to] || 0;
        return fromCount > 0 ? Math.round((toCount / fromCount) * 100) : 0;
      };

      return {
        campaignName: name,
        stages,
        leadToContact: getRate('lead', 'contact'),
        contactToMeeting: getRate('contact', 'meeting'),
        meetingToQuote: getRate('meeting', 'quote'),
        quoteToClose: getRate('quote', 'closed_won'),
        overallConversion: getRate('lead', 'closed_won'),
      };
    });
  }

  // ─────────────────────────────────────────────────────────
  // LEAD QUALITY
  // ─────────────────────────────────────────────────────────

  private buildLeadQuality(records: any[]): LeadQualityMetrics[] {
    const byCampaign: Record<string, any[]> = {};
    records.forEach(r => {
      const key = r.campaignName || 'Sin Campana';
      if (!byCampaign[key]) byCampaign[key] = [];
      byCampaign[key].push(r);
    });

    return Object.entries(byCampaign)
      .filter(([, recs]) => recs.length >= 3)
      .map(([name, recs]) => {
        const total = recs.length;
        const quoteStages = ['quote', 'negotiation', 'closed_won'];
        const closeStages = ['closed_won'];
        const junkStages = ['junk'];

        const reachedQuote = recs.filter(r => quoteStages.includes(r.funnelStage)).length;
        const reachedClose = recs.filter(r => closeStages.includes(r.funnelStage)).length;
        const junk = recs.filter(r => junkStages.includes(r.funnelStage)).length;

        // Quality score: weighted combination
        const pctQuote = total > 0 ? (reachedQuote / total) * 100 : 0;
        const pctClose = total > 0 ? (reachedClose / total) * 100 : 0;
        const junkPct = total > 0 ? (junk / total) * 100 : 0;

        // Score: 40% quote rate + 40% close rate + 20% (100 - junk rate)
        const qualityScore = Math.round(
          (pctQuote * 0.4) + (pctClose * 2 * 0.4) + ((100 - junkPct) * 0.2)
        );

        // Average days to first contact
        const withContactDays = recs
          .filter(r => r.localLead?.lastContactedAt && r.localLead?.createdAt)
          .map(r => {
            const created = new Date(r.localLead.createdAt).getTime();
            const contacted = new Date(r.localLead.lastContactedAt).getTime();
            return Math.max(0, Math.round((contacted - created) / (1000 * 60 * 60 * 24)));
          });
        const avgDaysToContact = withContactDays.length > 0
          ? Math.round(withContactDays.reduce((s, d) => s + d, 0) / withContactDays.length)
          : null;

        return {
          campaignName: name,
          totalLeads: total,
          reachedQuote,
          pctReachedQuote: Math.round(pctQuote),
          reachedClose,
          pctReachedClose: Math.round(pctClose),
          qualityScore: Math.min(100, Math.max(0, qualityScore)),
          avgDaysToContact,
          junkPct: Math.round(junkPct),
        };
      })
      .sort((a, b) => b.qualityScore - a.qualityScore);
  }

  // ─────────────────────────────────────────────────────────
  // TIME TO CLOSE
  // ─────────────────────────────────────────────────────────

  private buildTimeToClose(records: any[], localLeads: any[]): TimeToCloseEntry[] {
    const byCampaign: Record<string, number[]> = {};

    // For local leads with convertedAt
    records.forEach(r => {
      if (!r.isWon) return;
      const lead = r.localLead;
      if (!lead?.convertedAt || !lead?.createdAt) {
        // Estimate from attribution createdAt
        const days = Math.round(
          (Date.now() - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24)
        );
        if (days > 0 && days < 365) {
          const key = r.campaignName || 'Sin Campana';
          if (!byCampaign[key]) byCampaign[key] = [];
          byCampaign[key].push(days);
        }
        return;
      }
      const days = Math.round(
        (new Date(lead.convertedAt).getTime() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (days >= 0 && days < 730) {
        const key = r.campaignName || 'Sin Campana';
        if (!byCampaign[key]) byCampaign[key] = [];
        byCampaign[key].push(days);
      }
    });

    // Also build channel-level mapping
    const channelMap: Record<string, string> = {};
    records.forEach(r => {
      if (r.campaignName) channelMap[r.campaignName] = r.channel || 'Unknown';
    });

    return Object.entries(byCampaign)
      .filter(([, days]) => days.length >= 1)
      .map(([name, days]) => {
        const sorted = [...days].sort((a, b) => a - b);
        return {
          campaignName: name,
          channel: channelMap[name] || 'Unknown',
          avgDaysToClose: Math.round(days.reduce((s, d) => s + d, 0) / days.length),
          medianDaysToClose: sorted[Math.floor(sorted.length / 2)],
          minDays: sorted[0],
          maxDays: sorted[sorted.length - 1],
          sampleSize: days.length,
        };
      })
      .sort((a, b) => a.avgDaysToClose - b.avgDaysToClose);
  }

  // ─────────────────────────────────────────────────────────
  // WEEKLY TREND
  // ─────────────────────────────────────────────────────────

  private buildWeeklyTrend(records: any[]): WeeklyPerformance[] {
    const weeks: Record<string, WeeklyPerformance> = {};

    records.forEach(r => {
      const d = new Date(r.createdAt);
      const year = d.getFullYear();
      const weekNum = this.getWeekNumber(d);
      const key = `${year}-W${String(weekNum).padStart(2, '0')}`;

      if (!weeks[key]) weeks[key] = { week: key, leads: 0, deals: 0, won: 0, revenue: 0, cost: 0 };
      weeks[key].leads++;
      if (r.dealStage || r.dealAmount) weeks[key].deals++;
      if (r.isWon) { weeks[key].won++; weeks[key].revenue += r.revenueAttributed || 0; }
      weeks[key].cost += r.estimatedCostPerLead;
    });

    return Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week)).slice(-12);
  }

  // ─────────────────────────────────────────────────────────
  // MONTHLY TREND
  // ─────────────────────────────────────────────────────────

  private buildMonthlyTrend(records: any[], costMap: Map<string, number>): MonthlyPerformance[] {
    const months: Record<string, MonthlyPerformance> = {};

    records.forEach(r => {
      const d = new Date(r.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      if (!months[key]) months[key] = { month: key, leads: 0, deals: 0, won: 0, revenue: 0, cost: 0, roi: 0 };
      months[key].leads++;
      if (r.dealStage || r.dealAmount) months[key].deals++;
      if (r.isWon) { months[key].won++; months[key].revenue += r.revenueAttributed || 0; }
      months[key].cost += r.estimatedCostPerLead;
    });

    return Object.values(months)
      .map(m => ({
        ...m,
        roi: m.cost > 0 ? Math.round(((m.revenue - m.cost) / m.cost) * 100) : (m.revenue > 0 ? 999 : 0),
      }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12);
  }

  // ─────────────────────────────────────────────────────────
  // BREAKDOWNS
  // ─────────────────────────────────────────────────────────

  private buildBreakdown(records: any[], dimension: string, costMap: Map<string, number>): BreakdownEntry[] {
    const groups: Record<string, { leads: number; deals: number; won: number; revenue: number; costs: number }> = {};

    records.forEach(r => {
      const key = r[dimension] || 'Sin Asignar';
      if (!groups[key]) groups[key] = { leads: 0, deals: 0, won: 0, revenue: 0, costs: 0 };
      groups[key].leads++;
      if (r.dealStage || r.dealAmount) groups[key].deals++;
      if (r.isWon) { groups[key].won++; groups[key].revenue += r.revenueAttributed || 0; }
      groups[key].costs += r.estimatedCostPerLead;
    });

    return Object.entries(groups)
      .map(([label, v]) => ({
        dimension,
        label,
        leads: v.leads,
        deals: v.deals,
        won: v.won,
        revenue: v.revenue,
        avgTicket: v.won > 0 ? Math.round(v.revenue / v.won) : 0,
        conversion: v.leads > 0 ? Math.round((v.won / v.leads) * 100) : 0,
        cost: Math.round(v.costs),
        roi: v.costs > 0 ? Math.round(((v.revenue - v.costs) / v.costs) * 100) : (v.revenue > 0 ? 999 : 0),
      }))
      .sort((a, b) => b.leads - a.leads);
  }

  private buildTicketRangeBreakdown(records: any[], costMap: Map<string, number>): BreakdownEntry[] {
    const groups: Record<string, { leads: number; deals: number; won: number; revenue: number; costs: number }> = {};

    records.forEach(r => {
      const val = r.dealValue || 0;
      const range = TICKET_RANGES.find(t => val >= t.min && val < t.max) || TICKET_RANGES[0];
      const key = range.label;
      if (!groups[key]) groups[key] = { leads: 0, deals: 0, won: 0, revenue: 0, costs: 0 };
      groups[key].leads++;
      if (r.dealStage || r.dealAmount) groups[key].deals++;
      if (r.isWon) { groups[key].won++; groups[key].revenue += r.revenueAttributed || 0; }
      groups[key].costs += r.estimatedCostPerLead;
    });

    return TICKET_RANGES.map(range => {
      const v = groups[range.label] || { leads: 0, deals: 0, won: 0, revenue: 0, costs: 0 };
      return {
        dimension: 'ticketRange',
        label: range.label,
        leads: v.leads,
        deals: v.deals,
        won: v.won,
        revenue: v.revenue,
        avgTicket: v.won > 0 ? Math.round(v.revenue / v.won) : 0,
        conversion: v.leads > 0 ? Math.round((v.won / v.leads) * 100) : 0,
        cost: Math.round(v.costs),
        roi: v.costs > 0 ? Math.round(((v.revenue - v.costs) / v.costs) * 100) : (v.revenue > 0 ? 999 : 0),
      };
    });
  }

  // ─────────────────────────────────────────────────────────
  // HEATMAPS
  // ─────────────────────────────────────────────────────────

  private buildHeatmap(records: any[], rowDim: string, colDim: string): HeatmapCell[] {
    const cells: Record<string, number> = {};
    const rows = new Set<string>();
    const cols = new Set<string>();

    records.forEach(r => {
      const row = r[rowDim] || 'Unknown';
      const col = r[colDim] || 'Unknown';
      rows.add(row);
      cols.add(col);
      const key = `${row}|||${col}`;
      cells[key] = (cells[key] || 0) + 1;
    });

    const result: HeatmapCell[] = [];
    rows.forEach(row => {
      cols.forEach(col => {
        const key = `${row}|||${col}`;
        const value = cells[key] || 0;
        if (value > 0) {
          result.push({ row, col, value, label: `${value} leads` });
        }
      });
    });

    return result.sort((a, b) => b.value - a.value);
  }

  private buildCampaignMonthHeatmap(records: any[]): HeatmapCell[] {
    const cells: Record<string, number> = {};
    const campaigns = new Set<string>();
    const months = new Set<string>();

    // Top 10 campaigns only
    const campaignCounts: Record<string, number> = {};
    records.forEach(r => {
      const c = r.campaignName || 'Sin Campana';
      campaignCounts[c] = (campaignCounts[c] || 0) + 1;
    });
    const topCampaigns = Object.entries(campaignCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]) => name);
    const topSet = new Set(topCampaigns);

    records.forEach(r => {
      const campaign = r.campaignName || 'Sin Campana';
      if (!topSet.has(campaign)) return;
      const d = new Date(r.createdAt);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      campaigns.add(campaign);
      months.add(month);
      const key = `${campaign}|||${month}`;
      cells[key] = (cells[key] || 0) + 1;
    });

    const result: HeatmapCell[] = [];
    campaigns.forEach(campaign => {
      months.forEach(month => {
        const key = `${campaign}|||${month}`;
        const value = cells[key] || 0;
        result.push({ row: campaign, col: month, value, label: `${value}` });
      });
    });

    return result;
  }

  // ─────────────────────────────────────────────────────────
  // SUMMARY / INSIGHTS
  // ─────────────────────────────────────────────────────────

  private buildSummary(leaderboard: CampaignLeaderboardEntry[], records: any[], timeToClose: TimeToCloseEntry[]): IntelligenceSummary {
    const totalLeads = records.length;
    const totalDeals = records.filter(r => r.dealStage || r.dealAmount).length;
    const totalWon = records.filter(r => r.isWon).length;
    const totalRevenue = records.filter(r => r.isWon).reduce((s, r) => s + (r.revenueAttributed || 0), 0);
    const totalCost = leaderboard.reduce((s, c) => s + c.totalCost, 0);
    const overallROI = totalCost > 0 ? Math.round(((totalRevenue - totalCost) / totalCost) * 100) : 0;
    const overallConversion = totalLeads > 0 ? Math.round((totalWon / totalLeads) * 100) : 0;

    const withROI = leaderboard.filter(c => c.totalCost > 0 && c.revenue > 0);
    const bestByROI = withROI.sort((a, b) => b.roi - a.roi)[0];
    const bestByVolume = [...leaderboard].sort((a, b) => b.leads - a.leads)[0];
    const worstCampaign = leaderboard.filter(c => c.leads >= 5).sort((a, b) => a.conversionLeadToClose - b.conversionLeadToClose)[0];

    // Best channel by conversion
    const channelConv: Record<string, { leads: number; won: number }> = {};
    records.forEach(r => {
      const ch = r.channel || 'Unknown';
      if (!channelConv[ch]) channelConv[ch] = { leads: 0, won: 0 };
      channelConv[ch].leads++;
      if (r.isWon) channelConv[ch].won++;
    });
    const bestChannel = Object.entries(channelConv)
      .filter(([, v]) => v.leads >= 5)
      .sort((a, b) => (b[1].won / b[1].leads) - (a[1].won / a[1].leads))[0];

    const avgDaysToClose = timeToClose.length > 0
      ? Math.round(timeToClose.reduce((s, t) => s + t.avgDaysToClose * t.sampleSize, 0) / timeToClose.reduce((s, t) => s + t.sampleSize, 0))
      : 0;

    // Generate insights
    const insights: string[] = [];
    if (bestByROI) insights.push(`Mejor ROI: ${bestByROI.campaignName} (${Math.round(bestByROI.roi)}%)`);
    if (bestByVolume) insights.push(`Mayor volumen: ${bestByVolume.campaignName} (${bestByVolume.leads} leads)`);
    if (bestChannel) insights.push(`Canal mas eficiente: ${bestChannel[0]} (${Math.round((bestChannel[1].won / bestChannel[1].leads) * 100)}% conversion)`);
    if (worstCampaign && worstCampaign.conversionLeadToClose === 0) insights.push(`Sin conversiones: ${worstCampaign.campaignName} (${worstCampaign.leads} leads, 0 clientes)`);
    if (avgDaysToClose > 0) insights.push(`Ciclo promedio de cierre: ${avgDaysToClose} dias`);

    const paidLeads = records.filter(r => r.sourceType === 'paid').length;
    const organicLeads = records.filter(r => r.sourceType === 'organic').length;
    if (paidLeads > 0 && organicLeads > 0) {
      const paidPct = Math.round((paidLeads / totalLeads) * 100);
      insights.push(`Mix: ${paidPct}% pagado vs ${100 - paidPct}% organico`);
    }

    return {
      totalLeads,
      totalDeals,
      totalWon,
      totalRevenue,
      totalCost,
      overallROI,
      overallConversion,
      bestCampaignByROI: bestByROI?.campaignName || 'N/A',
      bestCampaignByVolume: bestByVolume?.campaignName || 'N/A',
      bestChannelByConversion: bestChannel?.[0] || 'N/A',
      worstCampaign: worstCampaign?.campaignName || 'N/A',
      avgDaysToClose,
      topInsights: insights,
    };
  }

  // ─────────────────────────────────────────────────────────
  // INDIVIDUAL ENDPOINTS
  // ─────────────────────────────────────────────────────────

  async getLeaderboard(): Promise<CampaignLeaderboardEntry[]> {
    const full = await this.getFullIntelligence();
    return full.leaderboard;
  }

  async getFunnels(): Promise<CampaignFunnel[]> {
    const full = await this.getFullIntelligence();
    return full.funnels;
  }

  async getLeadQuality(): Promise<LeadQualityMetrics[]> {
    const full = await this.getFullIntelligence();
    return full.leadQuality;
  }

  async getTimeToClose(): Promise<TimeToCloseEntry[]> {
    const full = await this.getFullIntelligence();
    return full.timeToClose;
  }

  async getBreakdown(dimension: string): Promise<BreakdownEntry[]> {
    const full = await this.getFullIntelligence();
    switch (dimension) {
      case 'center': return full.byCenter;
      case 'industry': return full.byIndustry;
      case 'advisor': return full.byAdvisor;
      case 'ticket': return full.byTicketRange;
      default: return full.byCenter;
    }
  }

  // ─────────────────────────────────────────────────────────
  // UPDATE CAMPAIGN COSTS
  // ─────────────────────────────────────────────────────────

  async updateCampaignCosts(costs: Array<{ campaignId: string; monthlyCost?: number; totalCost?: number }>): Promise<{ updated: number }> {
    let updated = 0;
    for (const c of costs) {
      await this.prisma.campaign.update({
        where: { id: c.campaignId },
        data: {
          ...(c.monthlyCost !== undefined && { monthlyCost: c.monthlyCost }),
          ...(c.totalCost !== undefined && { totalCost: c.totalCost }),
        },
      });
      updated++;
    }
    return { updated };
  }

  // ─────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────

  private inferZone(attr: any): string | null {
    // Try to infer zone from campaign target or lead ID patterns
    const campaign = attr.campaignName || '';
    if (campaign.includes('Bajio') || campaign.includes('Queretaro')) return 'BAJIO';
    if (campaign.includes('GDL') || campaign.includes('Occidente') || campaign.includes('Jalisco')) return 'OCCIDENTE';
    if (campaign.includes('CDMX') || campaign.includes('Centro') || campaign.includes('Puebla')) return 'CENTRO';
    if (campaign.includes('Monterrey') || campaign.includes('Norte')) return 'NORTE';
    return null;
  }

  private getWeekNumber(d: Date): number {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }
}
