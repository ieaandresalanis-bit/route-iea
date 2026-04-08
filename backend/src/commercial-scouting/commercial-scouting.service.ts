import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface DataInventory {
  localDb: {
    leads: number;
    campaignAttributions: number;
    campaigns: number;
    salesAlerts: number;
    followupSequences: number;
    clientProfiles: number;
  };
  attributionMethods: { method: string; count: number; avgConfidence: number }[];
  dealStageDistribution: { stage: string; count: number; totalRevenue: number }[];
  dataQualityScore: number;
  narrative: string;
}

export interface YearlyAnalysis {
  year: number;
  won: number;
  lost: number;
  revenue: number;
  avgTicket: number;
  winRate: number;
  topSource: string;
  topSourceRevenue: number;
  monthlyBreakdown: { month: number; won: number; revenue: number; lost: number }[];
}

export interface ZoneAnalysis {
  zone: string;
  leads: number;
  won: number;
  lost: number;
  revenue: number;
  avgTicket: number;
  winRate: number;
  topSource: string;
  topIndustry: string;
}

export interface IndustryAnalysis {
  industry: string;
  leads: number;
  won: number;
  lost: number;
  revenue: number;
  avgTicket: number;
  winRate: number;
  topSource: string;
  growthTrend: string; // 'growing' | 'stable' | 'declining'
}

export interface AdvisorAnalysis {
  advisor: string;
  totalDeals: number;
  won: number;
  lost: number;
  revenue: number;
  avgTicket: number;
  winRate: number;
  topSource: string;
  topZone: string;
  yearlyPerformance: { year: number; won: number; revenue: number }[];
}

export interface FunnelAnalysis {
  totalEntered: number;
  stages: { stage: string; count: number; pct: number; dropOff: number; revenue: number }[];
  avgConversionRate: number;
  bottleneckStage: string;
  narrative: string;
}

export interface LostOpportunityAnalysis {
  totalLost: number;
  totalLostRevenue: number;
  byReason: { reason: string; count: number; revenue: number }[];
  bySource: { source: string; count: number; revenue: number; lossRate: number }[];
  byAdvisor: { advisor: string; count: number; revenue: number; lossRate: number }[];
  yearlyTrend: { year: number; lost: number; revenue: number }[];
  narrative: string;
}

export interface CampaignCrossIntel {
  topCampaigns: { name: string; won: number; revenue: number; roi: number; winRate: number }[];
  channelPerformance: { channel: string; leads: number; won: number; revenue: number; winRate: number; avgTicket: number }[];
  sourceEvolution: { source: string; yearly: { year: number; won: number; revenue: number }[] }[];
  narrative: string;
}

export interface TicketAnalysis {
  overallAvg: number;
  overallMedian: number;
  byYear: { year: number; avg: number; median: number; min: number; max: number }[];
  bySource: { source: string; avg: number; count: number }[];
  byAdvisor: { advisor: string; avg: number; count: number }[];
  ranges: { range: string; count: number; revenue: number; pct: number }[];
  narrative: string;
}

export interface DataQuality {
  totalRecords: number;
  missingFields: { field: string; missingCount: number; pct: number }[];
  duplicatesSuspected: number;
  orphanedRecords: number;
  recommendations: string[];
  narrative: string;
}

export interface StrategicRecommendation {
  category: string;
  priority: 'ALTA' | 'MEDIA' | 'BAJA';
  title: string;
  insight: string;
  action: string;
  expectedImpact: string;
}

export interface ScoutingReport {
  generatedAt: string;
  dataInventory: DataInventory;
  historicalByYear: YearlyAnalysis[];
  zoneAnalysis: ZoneAnalysis[];
  industryAnalysis: IndustryAnalysis[];
  advisorAnalysis: AdvisorAnalysis[];
  funnelAnalysis: FunnelAnalysis;
  lostOpportunities: LostOpportunityAnalysis;
  campaignCrossIntel: CampaignCrossIntel;
  ticketAnalysis: TicketAnalysis;
  dataQuality: DataQuality;
  strategicRecommendations: StrategicRecommendation[];
  executiveSummary: string;
}

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

@Injectable()
export class CommercialScoutingService {
  private readonly logger = new Logger(CommercialScoutingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── MAIN ENTRY ────────────────────────────────────────
  async getFullScoutingReport(): Promise<ScoutingReport> {
    this.logger.log('Generating full commercial scouting report...');

    const [
      dataInventory,
      historicalByYear,
      zoneAnalysis,
      industryAnalysis,
      advisorAnalysis,
      funnelAnalysis,
      lostOpportunities,
      campaignCrossIntel,
      ticketAnalysis,
      dataQuality,
    ] = await Promise.all([
      this.getDataInventory(),
      this.getHistoricalByYear(),
      this.getZoneAnalysis(),
      this.getIndustryAnalysis(),
      this.getAdvisorAnalysis(),
      this.getFunnelAnalysis(),
      this.getLostOpportunityAnalysis(),
      this.getCampaignCrossIntel(),
      this.getTicketAnalysis(),
      this.getDataQuality(),
    ]);

    const strategicRecommendations = this.generateStrategicRecommendations(
      historicalByYear, zoneAnalysis, industryAnalysis, advisorAnalysis,
      lostOpportunities, campaignCrossIntel, ticketAnalysis,
    );

    const executiveSummary = this.generateExecutiveSummary(
      dataInventory, historicalByYear, zoneAnalysis, advisorAnalysis,
      lostOpportunities, campaignCrossIntel, strategicRecommendations,
    );

    return {
      generatedAt: new Date().toISOString(),
      dataInventory,
      historicalByYear,
      zoneAnalysis,
      industryAnalysis,
      advisorAnalysis,
      funnelAnalysis,
      lostOpportunities,
      campaignCrossIntel,
      ticketAnalysis,
      dataQuality,
      strategicRecommendations,
      executiveSummary,
    };
  }

  // ─── 1. DATA INVENTORY ─────────────────────────────────
  async getDataInventory(): Promise<DataInventory> {
    const [leads, attrs, campaigns, alerts, sequences, clients] = await Promise.all([
      this.prisma.lead.count(),
      this.prisma.campaignAttribution.count(),
      this.prisma.campaign.count(),
      this.prisma.salesAlert.count().catch(() => 0),
      this.prisma.followUpSequence.count().catch(() => 0),
      this.prisma.clientProfile.count().catch(() => 0),
    ]);

    // Attribution methods breakdown
    const methodsRaw = await this.prisma.campaignAttribution.groupBy({
      by: ['attributionMethod'],
      _count: { id: true },
      _avg: { confidence: true },
    });

    const attributionMethods = methodsRaw.map(m => ({
      method: m.attributionMethod,
      count: m._count.id,
      avgConfidence: Math.round((m._avg.confidence || 0) * 100) / 100,
    }));

    // Deal stage distribution
    const stagesRaw = await this.prisma.campaignAttribution.groupBy({
      by: ['dealStage'],
      _count: { id: true },
      _sum: { revenueAttributed: true },
      where: { dealStage: { not: null } },
    });

    const dealStageDistribution = stagesRaw
      .map(s => ({
        stage: s.dealStage || 'Unknown',
        count: s._count.id,
        totalRevenue: s._sum.revenueAttributed || 0,
      }))
      .sort((a: any, b: any) => b.totalRevenue - a.totalRevenue);

    const totalWithRevenue = dealStageDistribution.filter(s => s.totalRevenue > 0).length;
    const dataQualityScore = Math.min(100, Math.round(
      (attrs > 100 ? 25 : attrs / 4) +
      (campaigns > 10 ? 25 : campaigns * 2.5) +
      (totalWithRevenue > 5 ? 25 : totalWithRevenue * 5) +
      (attributionMethods.length > 1 ? 25 : 10)
    ));

    const narrative = `📊 **Inventario de Datos Comerciales IEA**\n\n` +
      `El sistema cuenta con **${attrs} atribuciones** de campañas vinculadas a **${campaigns} campañas** activas. ` +
      `Se tienen **${leads} leads** registrados en la base local. ` +
      `Los métodos de atribución incluyen: ${attributionMethods.map(m => `${m.method} (${m.count} registros, ${(m.avgConfidence * 100).toFixed(0)}% confianza)`).join(', ')}. ` +
      `La calidad general de los datos se evalúa en **${dataQualityScore}/100**.`;

    return {
      localDb: {
        leads,
        campaignAttributions: attrs,
        campaigns,
        salesAlerts: alerts,
        followupSequences: sequences,
        clientProfiles: clients,
      },
      attributionMethods,
      dealStageDistribution,
      dataQualityScore,
      narrative,
    };
  }

  // ─── 2. HISTORICAL BY YEAR ─────────────────────────────
  async getHistoricalByYear(): Promise<YearlyAnalysis[]> {
    const allAttrs = await this.prisma.campaignAttribution.findMany({
      select: {
        dealStage: true,
        dealAmount: true,
        revenueAttributed: true,
        isWon: true,
        campaignName: true,
        sourceType: true,
        createdAt: true,
      },
    });

    const yearMap = new Map<number, {
      won: number; lost: number; revenue: number; amounts: number[];
      sourceRevenue: Map<string, number>;
      months: Map<number, { won: number; revenue: number; lost: number }>;
    }>();

    for (const a of allAttrs) {
      const year = a.createdAt.getFullYear();
      if (year < 2021 || year > 2026) continue;

      if (!yearMap.has(year)) {
        yearMap.set(year, {
          won: 0, lost: 0, revenue: 0, amounts: [],
          sourceRevenue: new Map(),
          months: new Map(),
        });
      }

      const y = yearMap.get(year)!;
      const rev = a.revenueAttributed || a.dealAmount || 0;
      const isLost = a.dealStage?.includes('Perdido') || false;

      if (a.isWon) {
        y.won++;
        y.revenue += rev;
        y.amounts.push(rev);
        const src = a.sourceType || a.campaignName || 'Desconocido';
        y.sourceRevenue.set(src, (y.sourceRevenue.get(src) || 0) + rev);
      } else if (isLost) {
        y.lost++;
      }

      const month = a.createdAt.getMonth() + 1;
      if (!y.months.has(month)) {
        y.months.set(month, { won: 0, revenue: 0, lost: 0 });
      }
      const m = y.months.get(month)!;
      if (a.isWon) { m.won++; m.revenue += rev; }
      if (isLost) { m.lost++; }
    }

    return Array.from(yearMap.entries())
      .map(([year, y]) => {
        const topSourceEntry = Array.from(y.sourceRevenue.entries())
          .sort((a: any, b: any) => b[1] - a[1])[0];

        return {
          year,
          won: y.won,
          lost: y.lost,
          revenue: Math.round(y.revenue),
          avgTicket: y.won > 0 ? Math.round(y.revenue / y.won) : 0,
          winRate: (y.won + y.lost) > 0 ? Math.round((y.won / (y.won + y.lost)) * 100) : 0,
          topSource: topSourceEntry?.[0] || 'N/A',
          topSourceRevenue: topSourceEntry?.[1] || 0,
          monthlyBreakdown: Array.from({ length: 12 }, (_, i) => ({
            month: i + 1,
            ...(y.months.get(i + 1) || { won: 0, revenue: 0, lost: 0 }),
          })),
        };
      })
      .sort((a: any, b: any) => a.year - b.year);
  }

  // ─── 3. ZONE ANALYSIS ──────────────────────────────────
  async getZoneAnalysis(): Promise<ZoneAnalysis[]> {
    const attrs = await this.prisma.campaignAttribution.findMany({
      select: {
        dealStage: true,
        dealAmount: true,
        revenueAttributed: true,
        isWon: true,
        sourceType: true,
        campaignGroup: true,
        channel: true,
      },
    });

    // Also get leads with zones
    const leads = await this.prisma.lead.findMany({
      where: { isHistorical: false },
      select: { zone: true, industry: true, status: true, estimatedValue: true },
    });

    // Since campaign_attributions don't have direct zone, we'll use channel/source as proxy
    // and also aggregate from leads table
    const zoneMap = new Map<string, {
      leads: number; won: number; lost: number; revenue: number; amounts: number[];
      sources: Map<string, number>; industries: Map<string, number>;
    }>();

    // From leads table
    for (const l of leads) {
      const zone = l.zone || 'OTROS';
      if (!zoneMap.has(zone)) {
        zoneMap.set(zone, { leads: 0, won: 0, lost: 0, revenue: 0, amounts: [], sources: new Map(), industries: new Map() });
      }
      const z = zoneMap.get(zone)!;
      z.leads++;
      if (l.industry) {
        z.industries.set(l.industry, (z.industries.get(l.industry) || 0) + 1);
      }
    }

    // From attributions - use campaignGroup as zone proxy where available
    const zoneKeywords: Record<string, string[]> = {
      BAJIO: ['bajio', 'guanajuato', 'queretaro', 'leon', 'aguascalientes', 'slp', 'san luis'],
      OCCIDENTE: ['jalisco', 'guadalajara', 'gdl', 'occidente', 'michoacan', 'colima'],
      CENTRO: ['cdmx', 'mexico', 'puebla', 'morelos', 'centro'],
      NORTE: ['monterrey', 'mty', 'norte', 'coahuila', 'chihuahua', 'nuevo leon'],
    };

    for (const a of attrs) {
      let zone = 'GENERAL';
      const group = (a.campaignGroup || '').toLowerCase();
      for (const [z, keywords] of Object.entries(zoneKeywords)) {
        if (keywords.some(k => group.includes(k))) { zone = z; break; }
      }

      if (!zoneMap.has(zone)) {
        zoneMap.set(zone, { leads: 0, won: 0, lost: 0, revenue: 0, amounts: [], sources: new Map(), industries: new Map() });
      }
      const z = zoneMap.get(zone)!;
      const rev = a.revenueAttributed || a.dealAmount || 0;
      const src = a.sourceType || a.channel || 'Desconocido';

      if (a.isWon) {
        z.won++;
        z.revenue += rev;
        z.amounts.push(rev);
        z.sources.set(src, (z.sources.get(src) || 0) + rev);
      }
      if (a.dealStage?.includes('Perdido')) z.lost++;
    }

    return Array.from(zoneMap.entries())
      .map(([zone, z]) => {
        const topSource = Array.from(z.sources.entries()).sort((a: any, b: any) => b[1] - a[1])[0];
        const topIndustry = Array.from(z.industries.entries()).sort((a: any, b: any) => b[1] - a[1])[0];
        return {
          zone,
          leads: z.leads,
          won: z.won,
          lost: z.lost,
          revenue: Math.round(z.revenue),
          avgTicket: z.won > 0 ? Math.round(z.revenue / z.won) : 0,
          winRate: (z.won + z.lost) > 0 ? Math.round((z.won / (z.won + z.lost)) * 100) : 0,
          topSource: topSource?.[0] || 'N/A',
          topIndustry: topIndustry?.[0] || 'N/A',
        };
      })
      .sort((a: any, b: any) => b.revenue - a.revenue);
  }

  // ─── 4. INDUSTRY ANALYSIS ──────────────────────────────
  async getIndustryAnalysis(): Promise<IndustryAnalysis[]> {
    // From campaign_attributions grouped by campaignGroup as industry proxy
    const attrs = await this.prisma.campaignAttribution.findMany({
      select: {
        campaignGroup: true,
        campaignType: true,
        sourceType: true,
        isWon: true,
        dealStage: true,
        dealAmount: true,
        revenueAttributed: true,
        createdAt: true,
      },
    });

    const industryMap = new Map<string, {
      leads: number; won: number; lost: number; revenue: number;
      sources: Map<string, number>;
      yearlyWon: Map<number, number>;
    }>();

    for (const a of attrs) {
      const industry = a.campaignGroup || a.campaignType || 'General';
      if (!industryMap.has(industry)) {
        industryMap.set(industry, { leads: 0, won: 0, lost: 0, revenue: 0, sources: new Map(), yearlyWon: new Map() });
      }
      const ind = industryMap.get(industry)!;
      ind.leads++;
      const rev = a.revenueAttributed || a.dealAmount || 0;
      const src = a.sourceType || 'Desconocido';

      if (a.isWon) {
        ind.won++;
        ind.revenue += rev;
        ind.sources.set(src, (ind.sources.get(src) || 0) + rev);
        const yr = a.createdAt.getFullYear();
        ind.yearlyWon.set(yr, (ind.yearlyWon.get(yr) || 0) + 1);
      }
      if (a.dealStage?.includes('Perdido')) ind.lost++;
    }

    return Array.from(industryMap.entries())
      .map(([industry, ind]) => {
        const topSource = Array.from(ind.sources.entries()).sort((a: any, b: any) => b[1] - a[1])[0];
        // Determine growth trend
        const years = Array.from(ind.yearlyWon.entries()).sort((a: any, b: any) => a[0] - b[0]);
        let growthTrend: string = 'stable';
        if (years.length >= 2) {
          const recent = years[years.length - 1][1];
          const prev = years[years.length - 2][1];
          if (recent > prev * 1.2) growthTrend = 'growing';
          else if (recent < prev * 0.8) growthTrend = 'declining';
        }

        return {
          industry,
          leads: ind.leads,
          won: ind.won,
          lost: ind.lost,
          revenue: Math.round(ind.revenue),
          avgTicket: ind.won > 0 ? Math.round(ind.revenue / ind.won) : 0,
          winRate: (ind.won + ind.lost) > 0 ? Math.round((ind.won / (ind.won + ind.lost)) * 100) : 0,
          topSource: topSource?.[0] || 'N/A',
          growthTrend,
        };
      })
      .sort((a: any, b: any) => b.revenue - a.revenue);
  }

  // ─── 5. ADVISOR ANALYSIS ───────────────────────────────
  async getAdvisorAnalysis(): Promise<AdvisorAnalysis[]> {
    // Attribution data doesn't directly have advisor, but we can get from leads
    const leads = await this.prisma.lead.findMany({
      include: { assignedTo: { select: { firstName: true, lastName: true } } },
      where: { assignedToId: { not: null }, isHistorical: false },
    });

    // Also use campaign data for broader view
    const attrs = await this.prisma.campaignAttribution.findMany({
      select: {
        isWon: true,
        dealStage: true,
        dealAmount: true,
        revenueAttributed: true,
        sourceType: true,
        createdAt: true,
        campaignName: true,
      },
    });

    // Since attributions lack advisor info, build from whatever we have
    // Use campaignName patterns that might indicate advisor ownership
    const advisorMap = new Map<string, {
      totalDeals: number; won: number; lost: number; revenue: number;
      sources: Map<string, number>; zones: Map<string, number>;
      yearly: Map<number, { won: number; revenue: number }>;
    }>();

    // From leads with assigned advisors
    for (const l of leads) {
      if (!l.assignedTo) continue;
      const name = `${l.assignedTo.firstName} ${l.assignedTo.lastName}`;
      if (!advisorMap.has(name)) {
        advisorMap.set(name, { totalDeals: 0, won: 0, lost: 0, revenue: 0, sources: new Map(), zones: new Map(), yearly: new Map() });
      }
      const adv = advisorMap.get(name)!;
      adv.totalDeals++;
      adv.zones.set(l.zone, (adv.zones.get(l.zone) || 0) + 1);
      if (l.source) adv.sources.set(l.source, (adv.sources.get(l.source) || 0) + 1);
      if (l.status === 'CERRADO_GANADO') {
        adv.won++;
        adv.revenue += l.estimatedValue || 0;
      }
      if (l.status === 'CERRADO_PERDIDO') adv.lost++;
    }

    // If no advisor data from leads, build aggregate view from attributions
    if (advisorMap.size === 0) {
      // Build a "Team" aggregate by source type
      const sourceGroups = new Map<string, typeof attrs>();
      for (const a of attrs) {
        const src = a.sourceType || 'General';
        if (!sourceGroups.has(src)) sourceGroups.set(src, []);
        sourceGroups.get(src)!.push(a);
      }

      for (const [src, group] of sourceGroups) {
        const data = {
          totalDeals: group.length,
          won: 0, lost: 0, revenue: 0,
          sources: new Map<string, number>(),
          zones: new Map<string, number>(),
          yearly: new Map<number, { won: number; revenue: number }>(),
        };

        for (const a of group) {
          const rev = a.revenueAttributed || a.dealAmount || 0;
          if (a.isWon) {
            data.won++;
            data.revenue += rev;
            const yr = a.createdAt.getFullYear();
            if (!data.yearly.has(yr)) data.yearly.set(yr, { won: 0, revenue: 0 });
            const y = data.yearly.get(yr)!;
            y.won++;
            y.revenue += rev;
          }
          if (a.dealStage?.includes('Perdido')) data.lost++;
        }

        advisorMap.set(`Equipo ${src}`, data);
      }
    }

    return Array.from(advisorMap.entries())
      .map(([advisor, adv]) => {
        const topSource = Array.from(adv.sources.entries()).sort((a: any, b: any) => b[1] - a[1])[0];
        const topZone = Array.from(adv.zones.entries()).sort((a: any, b: any) => b[1] - a[1])[0];
        return {
          advisor,
          totalDeals: adv.totalDeals,
          won: adv.won,
          lost: adv.lost,
          revenue: Math.round(adv.revenue),
          avgTicket: adv.won > 0 ? Math.round(adv.revenue / adv.won) : 0,
          winRate: (adv.won + adv.lost) > 0 ? Math.round((adv.won / (adv.won + adv.lost)) * 100) : 0,
          topSource: topSource?.[0] || 'N/A',
          topZone: topZone?.[0] || 'N/A',
          yearlyPerformance: Array.from(adv.yearly.entries())
            .map(([year, y]) => ({ year, won: y.won, revenue: Math.round(y.revenue) }))
            .sort((a: any, b: any) => a.year - b.year),
        };
      })
      .sort((a: any, b: any) => b.revenue - a.revenue);
  }

  // ─── 6. FUNNEL ANALYSIS ────────────────────────────────
  async getFunnelAnalysis(): Promise<FunnelAnalysis> {
    const stageOrder = [
      'Pendiente de Contactar',
      'Intentando Contactar',
      'En prospección',
      'Agendar Cita',
      'Cita Agendada',
      'Esperando realizar Cotización',
      'Cotización Entregada',
      'Esperando Contrato y Factura',
      'Pendiente de Pago',
      'Cerrado Ganado',
    ];

    const attrs = await this.prisma.campaignAttribution.groupBy({
      by: ['dealStage'],
      _count: { id: true },
      _sum: { revenueAttributed: true },
      where: { dealStage: { not: null } },
    });

    const stageMap = new Map(attrs.map(a => [a.dealStage!, { count: a._count.id, revenue: a._sum.revenueAttributed || 0 }]));

    const totalEntered = attrs.reduce((sum, a) => sum + a._count.id, 0);

    // Build cumulative funnel (each stage = those who reached at least that stage)
    // For simplicity, we use the raw counts per stage
    let prevCount = totalEntered;
    const stages = stageOrder
      .filter(s => stageMap.has(s))
      .map(stage => {
        const data = stageMap.get(stage)!;
        const pct = totalEntered > 0 ? Math.round((data.count / totalEntered) * 100) : 0;
        const dropOff = prevCount > 0 ? Math.round(((prevCount - data.count) / prevCount) * 100) : 0;
        prevCount = data.count;
        return { stage, count: data.count, pct, dropOff, revenue: Math.round(data.revenue) };
      });

    // Add stages not in our ordered list
    for (const a of attrs) {
      if (!stageOrder.includes(a.dealStage!) && a.dealStage) {
        stages.push({
          stage: a.dealStage!,
          count: a._count.id,
          pct: totalEntered > 0 ? Math.round((a._count.id / totalEntered) * 100) : 0,
          dropOff: 0,
          revenue: Math.round(a._sum.revenueAttributed || 0),
        });
      }
    }

    const wonStage = stageMap.get('Cerrado Ganado');
    const avgConversionRate = wonStage && totalEntered > 0
      ? Math.round((wonStage.count / totalEntered) * 100)
      : 0;

    // Find bottleneck: stage with highest drop-off
    const orderedStages = stages.filter(s => stageOrder.includes(s.stage));
    const bottleneck = orderedStages.sort((a: any, b: any) => b.dropOff - a.dropOff)[0];

    const narrative = `🔄 **Análisis de Funnel Comercial**\n\n` +
      `De **${totalEntered} oportunidades** totales en el sistema, **${wonStage?.count || 0}** llegaron a cierre ganado ` +
      `(tasa de conversión general: **${avgConversionRate}%**). ` +
      `El cuello de botella principal está en la etapa "${bottleneck?.stage || 'N/A'}" con un **${bottleneck?.dropOff || 0}% de caída**. ` +
      `Esto sugiere que el equipo necesita reforzar su estrategia en esa fase del proceso comercial.`;

    return {
      totalEntered,
      stages: stages.sort((a: any, b: any) => {
        const ia = stageOrder.indexOf(a.stage);
        const ib = stageOrder.indexOf(b.stage);
        if (ia >= 0 && ib >= 0) return ia - ib;
        if (ia >= 0) return -1;
        if (ib >= 0) return 1;
        return b.count - a.count;
      }),
      avgConversionRate,
      bottleneckStage: bottleneck?.stage || 'N/A',
      narrative,
    };
  }

  // ─── 7. LOST OPPORTUNITY ANALYSIS ──────────────────────
  async getLostOpportunityAnalysis(): Promise<LostOpportunityAnalysis> {
    const lostAttrs = await this.prisma.campaignAttribution.findMany({
      where: {
        OR: [
          { dealStage: { contains: 'Perdido' } },
          { dealStage: { contains: 'Basura' } },
        ],
      },
      select: {
        dealStage: true,
        dealAmount: true,
        revenueAttributed: true,
        sourceType: true,
        campaignName: true,
        createdAt: true,
      },
    });

    const allAttrs = await this.prisma.campaignAttribution.findMany({
      select: { sourceType: true, isWon: true, dealStage: true },
    });

    const totalLost = lostAttrs.length;
    const totalLostRevenue = lostAttrs.reduce((sum, a) => sum + (a.dealAmount || a.revenueAttributed || 0), 0);

    // By reason (dealStage)
    const reasonMap = new Map<string, { count: number; revenue: number }>();
    for (const a of lostAttrs) {
      const reason = a.dealStage || 'Sin razón';
      if (!reasonMap.has(reason)) reasonMap.set(reason, { count: 0, revenue: 0 });
      const r = reasonMap.get(reason)!;
      r.count++;
      r.revenue += a.dealAmount || a.revenueAttributed || 0;
    }

    // By source with loss rate
    const sourceStats = new Map<string, { total: number; won: number; lost: number; lostRevenue: number }>();
    for (const a of allAttrs) {
      const src = a.sourceType || 'Desconocido';
      if (!sourceStats.has(src)) sourceStats.set(src, { total: 0, won: 0, lost: 0, lostRevenue: 0 });
      const s = sourceStats.get(src)!;
      s.total++;
      if (a.isWon) s.won++;
      if (a.dealStage?.includes('Perdido') || a.dealStage?.includes('Basura')) s.lost++;
    }
    for (const a of lostAttrs) {
      const src = a.sourceType || 'Desconocido';
      const s = sourceStats.get(src);
      if (s) s.lostRevenue += a.dealAmount || a.revenueAttributed || 0;
    }

    // Yearly trend
    const yearlyMap = new Map<number, { lost: number; revenue: number }>();
    for (const a of lostAttrs) {
      const yr = a.createdAt.getFullYear();
      if (!yearlyMap.has(yr)) yearlyMap.set(yr, { lost: 0, revenue: 0 });
      const y = yearlyMap.get(yr)!;
      y.lost++;
      y.revenue += a.dealAmount || a.revenueAttributed || 0;
    }

    const narrative = `⚠️ **Análisis de Oportunidades Perdidas**\n\n` +
      `Se identificaron **${totalLost} oportunidades perdidas** con un valor total estimado de **$${(totalLostRevenue / 1_000_000).toFixed(1)}M MXN**. ` +
      `Las principales razones de pérdida son: ${Array.from(reasonMap.entries()).sort((a: any, b: any) => b[1].count - a[1].count).slice(0, 3).map(([r, d]) => `"${r}" (${d.count})`).join(', ')}. ` +
      `Las fuentes con mayor tasa de pérdida requieren revisión inmediata de calidad de leads.`;

    return {
      totalLost,
      totalLostRevenue: Math.round(totalLostRevenue),
      byReason: Array.from(reasonMap.entries())
        .map(([reason, d]) => ({ reason, count: d.count, revenue: Math.round(d.revenue) }))
        .sort((a: any, b: any) => b.count - a.count),
      bySource: Array.from(sourceStats.entries())
        .filter(([, s]) => s.lost > 0)
        .map(([source, s]) => ({
          source,
          count: s.lost,
          revenue: Math.round(s.lostRevenue),
          lossRate: s.total > 0 ? Math.round((s.lost / s.total) * 100) : 0,
        }))
        .sort((a: any, b: any) => b.count - a.count),
      byAdvisor: [], // No advisor data in attributions
      yearlyTrend: Array.from(yearlyMap.entries())
        .map(([year, y]) => ({ year, lost: y.lost, revenue: Math.round(y.revenue) }))
        .sort((a: any, b: any) => a.year - b.year),
      narrative,
    };
  }

  // ─── 8. CAMPAIGN CROSS INTELLIGENCE ────────────────────
  async getCampaignCrossIntel(): Promise<CampaignCrossIntel> {
    const attrs = await this.prisma.campaignAttribution.findMany({
      select: {
        campaignName: true,
        channel: true,
        sourceType: true,
        isWon: true,
        dealAmount: true,
        revenueAttributed: true,
        createdAt: true,
      },
    });

    const campaigns = await this.prisma.campaign.findMany({
      select: { name: true, totalCost: true, monthlyCost: true },
    });
    const costMap = new Map(campaigns.map(c => [c.name, c.totalCost || (c.monthlyCost || 0) * 12]));

    // Top campaigns
    const campMap = new Map<string, { won: number; revenue: number; total: number }>();
    for (const a of attrs) {
      const name = a.campaignName || 'Sin campaña';
      if (!campMap.has(name)) campMap.set(name, { won: 0, revenue: 0, total: 0 });
      const c = campMap.get(name)!;
      c.total++;
      if (a.isWon) {
        c.won++;
        c.revenue += a.revenueAttributed || a.dealAmount || 0;
      }
    }

    const topCampaigns = Array.from(campMap.entries())
      .map(([name, c]) => {
        const cost = costMap.get(name) || 0;
        return {
          name,
          won: c.won,
          revenue: Math.round(c.revenue),
          roi: cost > 0 ? Math.round(((c.revenue - cost) / cost) * 100) : 0,
          winRate: c.total > 0 ? Math.round((c.won / c.total) * 100) : 0,
        };
      })
      .sort((a: any, b: any) => b.revenue - a.revenue)
      .slice(0, 20);

    // Channel performance
    const channelMap = new Map<string, { leads: number; won: number; revenue: number; amounts: number[] }>();
    for (const a of attrs) {
      const ch = a.channel || a.sourceType || 'Desconocido';
      if (!channelMap.has(ch)) channelMap.set(ch, { leads: 0, won: 0, revenue: 0, amounts: [] });
      const c = channelMap.get(ch)!;
      c.leads++;
      if (a.isWon) {
        const rev = a.revenueAttributed || a.dealAmount || 0;
        c.won++;
        c.revenue += rev;
        c.amounts.push(rev);
      }
    }

    const channelPerformance = Array.from(channelMap.entries())
      .map(([channel, c]) => ({
        channel,
        leads: c.leads,
        won: c.won,
        revenue: Math.round(c.revenue),
        winRate: c.leads > 0 ? Math.round((c.won / c.leads) * 100) : 0,
        avgTicket: c.won > 0 ? Math.round(c.revenue / c.won) : 0,
      }))
      .sort((a: any, b: any) => b.revenue - a.revenue);

    // Source evolution by year
    const sourceYearMap = new Map<string, Map<number, { won: number; revenue: number }>>();
    for (const a of attrs) {
      if (!a.isWon) continue;
      const src = a.sourceType || a.channel || 'Desconocido';
      const yr = a.createdAt.getFullYear();
      if (!sourceYearMap.has(src)) sourceYearMap.set(src, new Map());
      const ym = sourceYearMap.get(src)!;
      if (!ym.has(yr)) ym.set(yr, { won: 0, revenue: 0 });
      const y = ym.get(yr)!;
      y.won++;
      y.revenue += a.revenueAttributed || a.dealAmount || 0;
    }

    const sourceEvolution = Array.from(sourceYearMap.entries())
      .map(([source, ym]) => ({
        source,
        yearly: Array.from(ym.entries())
          .map(([year, y]) => ({ year, won: y.won, revenue: Math.round(y.revenue) }))
          .sort((a: any, b: any) => a.year - b.year),
      }))
      .sort((a: any, b: any) => {
        const aRev = a.yearly.reduce((s: any, y: any) => s + y.revenue, 0);
        const bRev = b.yearly.reduce((s: any, y: any) => s + y.revenue, 0);
        return bRev - aRev;
      })
      .slice(0, 10);

    const bestChannel = channelPerformance[0];
    const narrative = `📢 **Inteligencia Cruzada de Campañas**\n\n` +
      `El canal más rentable es **${bestChannel?.channel || 'N/A'}** con **$${((bestChannel?.revenue || 0) / 1_000_000).toFixed(1)}M** en ingresos ` +
      `y una tasa de cierre de **${bestChannel?.winRate || 0}%**. ` +
      `Las top 3 campañas por ingresos son: ${topCampaigns.slice(0, 3).map(c => `"${c.name}" ($${(c.revenue / 1_000_000).toFixed(1)}M)`).join(', ')}. ` +
      `Se recomienda concentrar presupuesto en los canales con mayor ROI y ticket promedio.`;

    return { topCampaigns, channelPerformance, sourceEvolution, narrative };
  }

  // ─── 9. TICKET ANALYSIS ────────────────────────────────
  async getTicketAnalysis(): Promise<TicketAnalysis> {
    const wonAttrs = await this.prisma.campaignAttribution.findMany({
      where: { isWon: true },
      select: {
        dealAmount: true,
        revenueAttributed: true,
        sourceType: true,
        createdAt: true,
      },
    });

    const amounts = wonAttrs
      .map(a => a.revenueAttributed || a.dealAmount || 0)
      .filter(a => a > 0)
      .sort((a: any, b: any) => a - b);

    const overallAvg = amounts.length > 0 ? Math.round(amounts.reduce((s, a) => s + a, 0) / amounts.length) : 0;
    const overallMedian = amounts.length > 0 ? amounts[Math.floor(amounts.length / 2)] : 0;

    // By year
    const yearMap = new Map<number, number[]>();
    for (const a of wonAttrs) {
      const rev = a.revenueAttributed || a.dealAmount || 0;
      if (rev <= 0) continue;
      const yr = a.createdAt.getFullYear();
      if (!yearMap.has(yr)) yearMap.set(yr, []);
      yearMap.get(yr)!.push(rev);
    }

    const byYear = Array.from(yearMap.entries())
      .map(([year, amts]) => {
        amts.sort((a: any, b: any) => a - b);
        return {
          year,
          avg: Math.round(amts.reduce((s, a) => s + a, 0) / amts.length),
          median: amts[Math.floor(amts.length / 2)],
          min: amts[0],
          max: amts[amts.length - 1],
        };
      })
      .sort((a: any, b: any) => a.year - b.year);

    // By source
    const srcMap = new Map<string, number[]>();
    for (const a of wonAttrs) {
      const rev = a.revenueAttributed || a.dealAmount || 0;
      if (rev <= 0) continue;
      const src = a.sourceType || 'Desconocido';
      if (!srcMap.has(src)) srcMap.set(src, []);
      srcMap.get(src)!.push(rev);
    }

    const bySource = Array.from(srcMap.entries())
      .map(([source, amts]) => ({
        source,
        avg: Math.round(amts.reduce((s, a) => s + a, 0) / amts.length),
        count: amts.length,
      }))
      .sort((a: any, b: any) => b.avg - a.avg);

    // Ticket ranges
    const ranges = [
      { label: '< $50K', min: 0, max: 50000 },
      { label: '$50K - $100K', min: 50000, max: 100000 },
      { label: '$100K - $250K', min: 100000, max: 250000 },
      { label: '$250K - $500K', min: 250000, max: 500000 },
      { label: '$500K - $1M', min: 500000, max: 1000000 },
      { label: '> $1M', min: 1000000, max: Infinity },
    ];

    const rangeData = ranges.map(r => {
      const inRange = amounts.filter(a => a >= r.min && a < r.max);
      return {
        range: r.label,
        count: inRange.length,
        revenue: Math.round(inRange.reduce((s, a) => s + a, 0)),
        pct: amounts.length > 0 ? Math.round((inRange.length / amounts.length) * 100) : 0,
      };
    });

    const narrative = `💰 **Análisis de Ticket Promedio**\n\n` +
      `El ticket promedio general es de **$${(overallAvg / 1000).toFixed(0)}K MXN** (mediana: $${(overallMedian / 1000).toFixed(0)}K). ` +
      `${byYear.length > 1 ? `La evolución muestra ${byYear[byYear.length - 1].avg > byYear[0].avg ? 'un crecimiento' : 'una disminución'} ` +
      `del ticket de $${(byYear[0].avg / 1000).toFixed(0)}K (${byYear[0].year}) a $${(byYear[byYear.length - 1].avg / 1000).toFixed(0)}K (${byYear[byYear.length - 1].year}). ` : ''}` +
      `La fuente con mejor ticket promedio es **${bySource[0]?.source || 'N/A'}** con **$${((bySource[0]?.avg || 0) / 1000).toFixed(0)}K**.`;

    return {
      overallAvg,
      overallMedian: Math.round(overallMedian),
      byYear,
      bySource,
      byAdvisor: [], // Built from advisor analysis
      ranges: rangeData,
      narrative,
    };
  }

  // ─── 10. DATA QUALITY ──────────────────────────────────
  async getDataQuality(): Promise<DataQuality> {
    const totalAttrs = await this.prisma.campaignAttribution.count();

    const missingChecks = [
      { field: 'campaignName', where: { campaignName: null } },
      { field: 'channel', where: { channel: null } },
      { field: 'sourceType', where: { sourceType: null } },
      { field: 'dealStage', where: { dealStage: null } },
      { field: 'dealAmount', where: { dealAmount: null } },
      { field: 'revenueAttributed', where: { revenueAttributed: null } },
      { field: 'campaignId', where: { campaignId: null } },
    ];

    const missingFields = await Promise.all(
      missingChecks.map(async (check) => {
        const count = await this.prisma.campaignAttribution.count({ where: check.where as any });
        return {
          field: check.field,
          missingCount: count,
          pct: totalAttrs > 0 ? Math.round((count / totalAttrs) * 100) : 0,
        };
      }),
    );

    // Check for duplicate lead IDs
    const leadIds = await this.prisma.campaignAttribution.groupBy({
      by: ['leadId'],
      _count: { id: true },
      having: { id: { _count: { gt: 1 } } },
    });
    const duplicatesSuspected = leadIds.length;

    // Orphaned: attributions without matching campaign
    const orphaned = await this.prisma.campaignAttribution.count({
      where: { campaignId: null, campaignName: { not: null } },
    });

    const recommendations: string[] = [];
    for (const f of missingFields) {
      if (f.pct > 20) {
        recommendations.push(`⚠️ Campo "${f.field}" tiene ${f.pct}% de registros vacíos — priorizar llenado`);
      }
    }
    if (duplicatesSuspected > 10) {
      recommendations.push(`🔍 ${duplicatesSuspected} leads con múltiples atribuciones — revisar duplicados`);
    }
    if (orphaned > 50) {
      recommendations.push(`🔗 ${orphaned} atribuciones sin campaña vinculada — corregir mapeo`);
    }

    const narrative = `🔧 **Auditoría de Calidad de Datos**\n\n` +
      `De **${totalAttrs} registros** de atribución analizados:\n` +
      missingFields.filter(f => f.pct > 0).map(f => `• "${f.field}": ${f.pct}% vacío (${f.missingCount} registros)`).join('\n') +
      `\n\n${duplicatesSuspected > 0 ? `Se detectaron **${duplicatesSuspected} posibles duplicados**. ` : ''}` +
      `${orphaned > 0 ? `Hay **${orphaned} atribuciones** sin campaña vinculada que necesitan mapeo. ` : ''}` +
      `${recommendations.length > 0 ? '\n\n**Acciones recomendadas:**\n' + recommendations.join('\n') : 'La calidad general de los datos es aceptable.'}`;

    return {
      totalRecords: totalAttrs,
      missingFields: missingFields.sort((a: any, b: any) => b.pct - a.pct),
      duplicatesSuspected,
      orphanedRecords: orphaned,
      recommendations,
      narrative,
    };
  }

  // ─── 11. STRATEGIC RECOMMENDATIONS ─────────────────────
  private generateStrategicRecommendations(
    yearly: YearlyAnalysis[],
    zones: ZoneAnalysis[],
    industries: IndustryAnalysis[],
    advisors: AdvisorAnalysis[],
    lost: LostOpportunityAnalysis,
    campaigns: CampaignCrossIntel,
    tickets: TicketAnalysis,
  ): StrategicRecommendation[] {
    const recs: StrategicRecommendation[] = [];

    // Revenue growth trend
    if (yearly.length >= 2) {
      const recent = yearly[yearly.length - 1];
      const prev = yearly[yearly.length - 2];
      if (recent.revenue < prev.revenue * 0.9) {
        recs.push({
          category: 'Crecimiento',
          priority: 'ALTA',
          title: 'Desaceleración de ingresos detectada',
          insight: `Los ingresos cayeron de $${(prev.revenue / 1_000_000).toFixed(1)}M (${prev.year}) a $${(recent.revenue / 1_000_000).toFixed(1)}M (${recent.year})`,
          action: 'Revisar mezcla de fuentes de leads y aumentar inversión en canales de mayor conversión',
          expectedImpact: `Recuperar ritmo de $${(prev.revenue / 1_000_000).toFixed(1)}M+ anuales`,
        });
      } else if (recent.revenue > prev.revenue * 1.2) {
        recs.push({
          category: 'Crecimiento',
          priority: 'MEDIA',
          title: 'Momentum positivo — capitalizar',
          insight: `Crecimiento del ${Math.round(((recent.revenue - prev.revenue) / prev.revenue) * 100)}% año sobre año`,
          action: 'Escalar los canales y estrategias que están impulsando el crecimiento',
          expectedImpact: 'Mantener o acelerar la trayectoria de crecimiento',
        });
      }
    }

    // Lost opportunities
    if (lost.totalLost > 20) {
      const topLostSource = lost.bySource[0];
      recs.push({
        category: 'Recuperación',
        priority: 'ALTA',
        title: `Recuperar oportunidades perdidas ($${(lost.totalLostRevenue / 1_000_000).toFixed(1)}M)`,
        insight: `${lost.totalLost} oportunidades perdidas. Fuente con más pérdidas: ${topLostSource?.source || 'N/A'} (${topLostSource?.count || 0})`,
        action: 'Implementar campaña de reactivación para oportunidades perdidas en últimos 6 meses',
        expectedImpact: `Recuperar 10-15% = $${((lost.totalLostRevenue * 0.12) / 1_000_000).toFixed(1)}M`,
      });
    }

    // Channel optimization
    const topChannel = campaigns.channelPerformance[0];
    const lowChannels = campaigns.channelPerformance.filter(c => c.winRate < 10 && c.leads > 10);
    if (lowChannels.length > 0) {
      recs.push({
        category: 'Canales',
        priority: 'MEDIA',
        title: 'Optimizar canales de baja conversión',
        insight: `${lowChannels.length} canales con <10% conversión: ${lowChannels.map(c => c.channel).join(', ')}`,
        action: 'Reducir inversión en canales de baja conversión y reasignar a canales probados',
        expectedImpact: 'Mejorar ROI general en 15-25%',
      });
    }

    if (topChannel) {
      recs.push({
        category: 'Canales',
        priority: 'MEDIA',
        title: `Escalar canal estrella: ${topChannel.channel}`,
        insight: `${topChannel.channel} genera $${(topChannel.revenue / 1_000_000).toFixed(1)}M con ${topChannel.winRate}% conversión`,
        action: `Aumentar inversión en ${topChannel.channel} en 20-30%`,
        expectedImpact: `Incremento potencial de $${((topChannel.revenue * 0.25) / 1_000_000).toFixed(1)}M`,
      });
    }

    // Ticket optimization
    if (tickets.bySource.length > 1) {
      const highTicket = tickets.bySource[0];
      recs.push({
        category: 'Ticket',
        priority: 'MEDIA',
        title: `Aumentar ticket promedio vía ${highTicket.source}`,
        insight: `${highTicket.source} tiene el mejor ticket ($${(highTicket.avg / 1000).toFixed(0)}K) vs promedio de $${(tickets.overallAvg / 1000).toFixed(0)}K`,
        action: `Enfocar esfuerzos de venta en segmentos de ${highTicket.source} para subir ticket general`,
        expectedImpact: 'Incremento de 10-20% en ticket promedio',
      });
    }

    // Zone expansion
    const topZone = zones[0];
    const underservedZones = zones.filter(z => z.leads > 5 && z.won === 0);
    if (underservedZones.length > 0) {
      recs.push({
        category: 'Expansión',
        priority: 'BAJA',
        title: 'Zonas con potencial sin explotar',
        insight: `${underservedZones.map(z => z.zone).join(', ')} tienen leads pero cero cierres`,
        action: 'Asignar asesores dedicados y diseñar estrategia de penetración por zona',
        expectedImpact: 'Abrir nuevos mercados geográficos',
      });
    }

    // Industry diversification
    const growingIndustries = industries.filter(i => i.growthTrend === 'growing' && i.won > 3);
    if (growingIndustries.length > 0) {
      recs.push({
        category: 'Industria',
        priority: 'MEDIA',
        title: 'Capitalizar industrias en crecimiento',
        insight: `Industrias creciendo: ${growingIndustries.map(i => i.industry).slice(0, 3).join(', ')}`,
        action: 'Desarrollar propuestas verticales y contenido especializado para estos segmentos',
        expectedImpact: 'Posicionamiento como experto vertical, mayor ticket',
      });
    }

    return recs.sort((a: any, b: any) => {
      const pri: Record<string, number> = { ALTA: 0, MEDIA: 1, BAJA: 2 };
      return pri[a.priority] - pri[b.priority];
    });
  }

  // ─── 12. EXECUTIVE SUMMARY ─────────────────────────────
  private generateExecutiveSummary(
    inventory: DataInventory,
    yearly: YearlyAnalysis[],
    zones: ZoneAnalysis[],
    advisors: AdvisorAnalysis[],
    lost: LostOpportunityAnalysis,
    campaigns: CampaignCrossIntel,
    recommendations: StrategicRecommendation[],
  ): string {
    const totalRevenue = yearly.reduce((s, y) => s + y.revenue, 0);
    const totalWon = yearly.reduce((s, y) => s + y.won, 0);
    const totalLost = yearly.reduce((s, y) => s + y.lost, 0);
    const latestYear = yearly[yearly.length - 1];
    const prevYear = yearly.length >= 2 ? yearly[yearly.length - 2] : null;

    const topZone = zones[0];
    const topChannel = campaigns.channelPerformance[0];
    const highPriorityRecs = recommendations.filter(r => r.priority === 'ALTA');

    let summary = `# 📊 Reporte Ejecutivo de Inteligencia Comercial — IEA\n\n`;
    summary += `**Generado:** ${new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}\n\n`;

    summary += `## Panorama General\n\n`;
    summary += `IEA ha procesado **${inventory.localDb.campaignAttributions} oportunidades comerciales** a través de **${inventory.localDb.campaigns} campañas**, `;
    summary += `generando **$${(totalRevenue / 1_000_000).toFixed(1)}M MXN** en ingresos totales con **${totalWon} cierres ganados**.\n\n`;

    if (latestYear && prevYear) {
      const growth = ((latestYear.revenue - prevYear.revenue) / prevYear.revenue * 100);
      summary += `## Tendencia\n\n`;
      summary += `El año ${latestYear.year} ${growth > 0 ? 'muestra crecimiento' : 'presenta una contracción'} `;
      summary += `del **${Math.abs(growth).toFixed(0)}%** vs ${prevYear.year} `;
      summary += `($${(latestYear.revenue / 1_000_000).toFixed(1)}M vs $${(prevYear.revenue / 1_000_000).toFixed(1)}M). `;
      summary += `Win rate: **${latestYear.winRate}%**.\n\n`;
    }

    summary += `## Hallazgos Clave\n\n`;
    summary += `- **Canal líder:** ${topChannel?.channel || 'N/A'} ($${((topChannel?.revenue || 0) / 1_000_000).toFixed(1)}M, ${topChannel?.winRate || 0}% conversión)\n`;
    summary += `- **Zona principal:** ${topZone?.zone || 'N/A'} ($${((topZone?.revenue || 0) / 1_000_000).toFixed(1)}M)\n`;
    summary += `- **Oportunidades perdidas:** ${lost.totalLost} deals ($${(lost.totalLostRevenue / 1_000_000).toFixed(1)}M en valor)\n`;
    summary += `- **Win rate general:** ${totalWon + totalLost > 0 ? Math.round((totalWon / (totalWon + totalLost)) * 100) : 0}%\n\n`;

    if (highPriorityRecs.length > 0) {
      summary += `## 🚨 Acciones Prioritarias\n\n`;
      for (const rec of highPriorityRecs) {
        summary += `- **${rec.title}**: ${rec.action} (impacto esperado: ${rec.expectedImpact})\n`;
      }
    }

    return summary;
  }
}
