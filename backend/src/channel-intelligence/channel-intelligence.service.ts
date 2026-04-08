import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const DEAL_STAGES = [
  'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO',
  'CERRADO_GANADO', 'CERRADO_PERDIDO',
];

const ACTIVE_STAGES = [
  'PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR', 'EN_PROSPECCION',
  'AGENDAR_CITA', 'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO',
];

const COTIZACION_STAGES = [
  'COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO',
  'CERRADO_GANADO',
];

const ALL_STAGES = [
  'PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR', 'EN_PROSPECCION',
  'AGENDAR_CITA', 'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO', 'CERRADO_GANADO', 'CERRADO_PERDIDO',
];

const SOURCE_LABELS: Record<string, string> = {
  META_ADS: 'Meta Ads',
  TIKTOK: 'TikTok',
  ORGANIC: 'Organico',
  GOOGLE_ADS: 'Google Ads',
  REFERRAL: 'Referido',
  WEBSITE: 'Sitio Web',
  COLD_CALL: 'Llamada Fria',
  TRADE_SHOW: 'Expo/Feria',
  ZOHO_CRM: 'Zoho CRM',
  MANUAL: 'Manual',
  OTHER: 'Otro',
};

const STAGE_LABELS: Record<string, string> = {
  PENDIENTE_CONTACTAR: 'Pendiente',
  INTENTANDO_CONTACTAR: 'Contactando',
  EN_PROSPECCION: 'Prospeccion',
  AGENDAR_CITA: 'Agendar Cita',
  ESPERANDO_COTIZACION: 'Espera Cotizacion',
  COTIZACION_ENTREGADA: 'Cotizacion Entregada',
  ESPERANDO_CONTRATO: 'Espera Contrato',
  PENDIENTE_PAGO: 'Pendiente Pago',
  CERRADO_GANADO: 'Cerrado Ganado',
  CERRADO_PERDIDO: 'Cerrado Perdido',
};

const ZONE_LABELS: Record<string, string> = {
  BAJIO: 'Bajio',
  OCCIDENTE: 'Occidente',
  CENTRO: 'Centro',
  NORTE: 'Norte',
  OTROS: 'Otros',
};

const AMOUNT_BUCKETS = [
  { key: '0-100K', min: 0, max: 100_000 },
  { key: '100K-500K', min: 100_000, max: 500_000 },
  { key: '500K-1M', min: 500_000, max: 1_000_000 },
  { key: '1M+', min: 1_000_000, max: Infinity },
];

// ═══════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════

export interface ChannelFilters {
  source?: string;
  zone?: string;
  industry?: string;
  advisorId?: string;
  billRange?: string;
  minAmount?: number;
  maxAmount?: number;
  stage?: string;
  dateFrom?: string;
  dateTo?: string;
}

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

@Injectable()
export class ChannelIntelligenceService {
  constructor(private prisma: PrismaService) {}

  // ─── DASHBOARD ──────────────────────────────────────────

  async getDashboard(filters: ChannelFilters) {
    const where = this.buildWhere(filters);
    const [leads, filterOptions] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        select: {
          id: true, source: true, status: true, zone: true,
          industry: true, billRange: true, estimatedValue: true,
          assignedToId: true, createdAt: true,
        },
      }),
      this.getFilterOptions(),
    ]);

    const ll: any[] = leads;

    // Summary
    const totalLeads = ll.length;
    const deals = ll.filter((l: any) => DEAL_STAGES.includes(l.status));
    const totalDeals = deals.length;
    const totalAmount = ll.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0);
    const avgTicket = totalLeads > 0 ? totalAmount / totalLeads : 0;
    const cotizaciones = ll.filter((l: any) => COTIZACION_STAGES.includes(l.status));
    const ganados = ll.filter((l: any) => l.status === 'CERRADO_GANADO');

    const conversionLeadToDeal = totalLeads > 0 ? (totalDeals / totalLeads) * 100 : 0;
    const conversionDealToCotizacion = totalDeals > 0 ? (cotizaciones.length / totalDeals) * 100 : 0;
    const conversionCotizacionToCierre = cotizaciones.length > 0 ? (ganados.length / cotizaciones.length) * 100 : 0;

    const summary = {
      totalLeads,
      totalDeals,
      totalAmount,
      avgTicket,
      conversionLeadToDeal: round2(conversionLeadToDeal),
      conversionDealToCotizacion: round2(conversionDealToCotizacion),
      conversionCotizacionToCierre: round2(conversionCotizacionToCierre),
    };

    // Per-channel breakdown
    const bySource = new Map<string, any[]>();
    ll.forEach((l: any) => {
      const src = l.source || 'OTHER';
      if (!bySource.has(src)) bySource.set(src, []);
      bySource.get(src)!.push(l);
    });

    const channels = Array.from(bySource.entries()).map(([source, items]: any) => {
      const channelLeads = items.length;
      const channelDeals = items.filter((l: any) => DEAL_STAGES.includes(l.status));
      const channelCot = items.filter((l: any) => COTIZACION_STAGES.includes(l.status));
      const channelWon = items.filter((l: any) => l.status === 'CERRADO_GANADO');
      const channelAmount = items.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0);

      // Stage breakdown for this channel
      const stages = ALL_STAGES.map((stage: any) => {
        const inStage = items.filter((l: any) => l.status === stage);
        return {
          stage,
          label: STAGE_LABELS[stage] || stage,
          count: inStage.length,
          amount: inStage.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0),
        };
      }).filter((s: any) => s.count > 0);

      return {
        source,
        label: SOURCE_LABELS[source] || source,
        leads: channelLeads,
        deals: channelDeals.length,
        amount: channelAmount,
        avgTicket: channelLeads > 0 ? round2(channelAmount / channelLeads) : 0,
        conversionLeadToDeal: channelLeads > 0 ? round2((channelDeals.length / channelLeads) * 100) : 0,
        conversionDealToCotizacion: channelDeals.length > 0 ? round2((channelCot.length / channelDeals.length) * 100) : 0,
        conversionCotizacionToCierre: channelCot.length > 0 ? round2((channelWon.length / channelCot.length) * 100) : 0,
        stages,
      };
    }).sort((a: any, b: any) => b.leads - a.leads);

    // Stage analysis (rows = stages, cols = channels)
    const stageAnalysis = ALL_STAGES.map((stage: any) => {
      const byChannel = Array.from(bySource.entries())
        .map(([source, items]: any) => {
          const inStage = items.filter((l: any) => l.status === stage);
          return {
            source,
            label: SOURCE_LABELS[source] || source,
            count: inStage.length,
            amount: inStage.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0),
          };
        })
        .filter((c: any) => c.count > 0)
        .sort((a: any, b: any) => b.count - a.count);

      return {
        stage,
        label: STAGE_LABELS[stage] || stage,
        byChannel,
      };
    }).filter((s: any) => s.byChannel.length > 0);

    return {
      filters: filterOptions,
      summary,
      channels,
      stageAnalysis,
    };
  }

  // ─── SEGMENTATION ───────────────────────────────────────

  async getSegmentation(filters: ChannelFilters) {
    const where = this.buildWhere(filters);
    const leads = await this.prisma.lead.findMany({
      where,
      select: {
        id: true, source: true, status: true, zone: true,
        industry: true, billRange: true, estimatedValue: true,
        assignedToId: true,
      },
    });

    const ll: any[] = leads;

    // By zone
    const zoneMap = new Map<string, any[]>();
    ll.forEach((l: any) => {
      const z = l.zone || 'OTROS';
      if (!zoneMap.has(z)) zoneMap.set(z, []);
      zoneMap.get(z)!.push(l);
    });
    const byZone = Array.from(zoneMap.entries()).map(([zone, items]: any) => {
      return this.buildSegmentRow(items, zone, ZONE_LABELS[zone] || zone);
    }).sort((a: any, b: any) => b.leads - a.leads);

    // By industry
    const industryMap = new Map<string, any[]>();
    ll.forEach((l: any) => {
      const ind = l.industry || 'Sin industria';
      if (!industryMap.has(ind)) industryMap.set(ind, []);
      industryMap.get(ind)!.push(l);
    });
    const byIndustry = Array.from(industryMap.entries()).map(([industry, items]: any) => {
      return this.buildSegmentRow(items, industry, industry);
    }).sort((a: any, b: any) => b.leads - a.leads);

    // By billRange
    const billMap = new Map<string, any[]>();
    ll.forEach((l: any) => {
      const br = l.billRange || 'Sin rango';
      if (!billMap.has(br)) billMap.set(br, []);
      billMap.get(br)!.push(l);
    });
    const byBillRange = Array.from(billMap.entries()).map(([billRange, items]: any) => {
      return this.buildSegmentRow(items, billRange, billRange);
    }).sort((a: any, b: any) => b.leads - a.leads);

    // By amount bucket
    const byAmountBucket = AMOUNT_BUCKETS.map((bucket: any) => {
      const items = ll.filter((l: any) => {
        const v = l.estimatedValue || 0;
        return v >= bucket.min && v < bucket.max;
      });
      const dealItems = items.filter((l: any) => DEAL_STAGES.includes(l.status));
      const amount = items.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0);
      return {
        bucket: bucket.key,
        leads: items.length,
        deals: dealItems.length,
        amount,
        avgTicket: items.length > 0 ? round2(amount / items.length) : 0,
      };
    }).filter((b: any) => b.leads > 0);

    // Cross-tab: source x zone
    const crossMap = new Map<string, any[]>();
    ll.forEach((l: any) => {
      const key = `${l.source || 'OTHER'}::${l.zone || 'OTROS'}`;
      if (!crossMap.has(key)) crossMap.set(key, []);
      crossMap.get(key)!.push(l);
    });
    const crossTab = Array.from(crossMap.entries()).map(([key, items]: any) => {
      const [source, zone] = key.split('::');
      const dealItems = items.filter((l: any) => DEAL_STAGES.includes(l.status));
      const amount = items.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0);
      return {
        source,
        zone,
        leads: items.length,
        deals: dealItems.length,
        amount,
        conversionRate: items.length > 0 ? round2((dealItems.length / items.length) * 100) : 0,
      };
    }).sort((a: any, b: any) => b.leads - a.leads);

    return { byZone, byIndustry, byBillRange, byAmountBucket, crossTab };
  }

  // ─── DECISIONS ──────────────────────────────────────────

  async getDecisions(filters: ChannelFilters) {
    const where = this.buildWhere(filters);
    const leads = await this.prisma.lead.findMany({
      where,
      select: {
        id: true, source: true, status: true, zone: true,
        industry: true, billRange: true, estimatedValue: true,
        assignedToId: true, createdAt: true,
      },
    });

    const ll: any[] = leads;
    const recommendations: any[] = [];
    const topSegments: any[] = [];

    // Channel metrics for analysis
    const bySource = new Map<string, any[]>();
    ll.forEach((l: any) => {
      const src = l.source || 'OTHER';
      if (!bySource.has(src)) bySource.set(src, []);
      bySource.get(src)!.push(l);
    });

    const channelStats = Array.from(bySource.entries()).map(([source, items]: any) => {
      const total = items.length;
      const dealItems = items.filter((l: any) => DEAL_STAGES.includes(l.status));
      const wonItems = items.filter((l: any) => l.status === 'CERRADO_GANADO');
      const amount = items.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0);
      const pendienteContactar = items.filter((l: any) => l.status === 'PENDIENTE_CONTACTAR').length;
      const intentando = items.filter((l: any) => l.status === 'INTENTANDO_CONTACTAR').length;
      const cotEntregada = items.filter((l: any) => l.status === 'COTIZACION_ENTREGADA').length;
      const esperandoContrato = items.filter((l: any) => l.status === 'ESPERANDO_CONTRATO').length;
      return {
        source,
        label: SOURCE_LABELS[source] || source,
        total,
        deals: dealItems.length,
        won: wonItems.length,
        amount,
        avgTicket: total > 0 ? amount / total : 0,
        conversionToDeal: total > 0 ? (dealItems.length / total) * 100 : 0,
        conversionToWon: total > 0 ? (wonItems.length / total) * 100 : 0,
        pendienteContactar,
        intentando,
        cotEntregada,
        esperandoContrato,
      };
    });

    // 1. Best conversion channel
    const byConversion = [...channelStats].filter((c: any) => c.total >= 3).sort((a: any, b: any) => b.conversionToDeal - a.conversionToDeal);
    if (byConversion.length > 0) {
      const best = byConversion[0];
      recommendations.push({
        type: 'opportunity',
        priority: 'high',
        title: `${best.label} tiene la mayor conversion a deal`,
        description: `Canal ${best.label} convierte ${round2(best.conversionToDeal)}% de leads a deals (${best.deals}/${best.total}). Considerar aumentar inversion en este canal.`,
        metric: `${round2(best.conversionToDeal)}% conversion`,
      });
      topSegments.push({
        segment: `Canal: ${best.label}`,
        metric: 'Conversion Lead→Deal',
        value: round2(best.conversionToDeal),
        recommendation: `Aumentar presupuesto en ${best.label} por alta conversion`,
      });
    }

    // 2. Best ticket channel
    const byTicket = [...channelStats].filter((c: any) => c.total >= 3).sort((a: any, b: any) => b.avgTicket - a.avgTicket);
    if (byTicket.length > 0) {
      const best = byTicket[0];
      recommendations.push({
        type: 'opportunity',
        priority: 'high',
        title: `${best.label} genera el ticket promedio mas alto`,
        description: `Canal ${best.label} tiene ticket promedio de $${formatNumber(best.avgTicket)}. Este canal atrae prospectos de mayor valor.`,
        metric: `$${formatNumber(best.avgTicket)} ticket promedio`,
      });
      topSegments.push({
        segment: `Canal: ${best.label}`,
        metric: 'Ticket Promedio',
        value: round2(best.avgTicket),
        recommendation: `Priorizar seguimiento en leads de ${best.label} por alto ticket`,
      });
    }

    // 3. Worst conversion channel (warning)
    if (byConversion.length > 1) {
      const worst = byConversion[byConversion.length - 1];
      if (worst.conversionToDeal < 20) {
        recommendations.push({
          type: 'warning',
          priority: 'medium',
          title: `${worst.label} tiene baja conversion`,
          description: `Canal ${worst.label} solo convierte ${round2(worst.conversionToDeal)}% de leads a deals (${worst.deals}/${worst.total}). Revisar calidad de leads o proceso de seguimiento.`,
          metric: `${round2(worst.conversionToDeal)}% conversion`,
        });
      }
    }

    // 4. Leads sin contactar (action)
    const totalPendiente = channelStats.reduce((s: any, c: any) => s + c.pendienteContactar, 0);
    if (totalPendiente > 0) {
      const topPendiente = [...channelStats].sort((a: any, b: any) => b.pendienteContactar - a.pendienteContactar);
      const topChannel = topPendiente[0];
      recommendations.push({
        type: 'action',
        priority: 'high',
        title: `${totalPendiente} leads pendientes de contactar`,
        description: `Hay ${totalPendiente} leads sin contactar. El canal con mas pendientes es ${topChannel.label} (${topChannel.pendienteContactar}). Asignar capacidad de contacto inmediata.`,
        metric: `${totalPendiente} leads sin contactar`,
      });
    }

    // 5. Cotizaciones entregadas sin avance (action)
    const totalCotEntregada = channelStats.reduce((s: any, c: any) => s + c.cotEntregada, 0);
    if (totalCotEntregada > 0) {
      recommendations.push({
        type: 'action',
        priority: 'high',
        title: `${totalCotEntregada} cotizaciones entregadas esperando avance`,
        description: `Hay ${totalCotEntregada} leads con cotizacion entregada que no han avanzado. Estos son deals calientes que requieren seguimiento urgente.`,
        metric: `${totalCotEntregada} cotizaciones en espera`,
      });
    }

    // 6. Contratos esperando cierre
    const totalEsperandoContrato = channelStats.reduce((s: any, c: any) => s + c.esperandoContrato, 0);
    if (totalEsperandoContrato > 0) {
      recommendations.push({
        type: 'action',
        priority: 'high',
        title: `${totalEsperandoContrato} contratos pendientes de firma`,
        description: `Hay ${totalEsperandoContrato} deals esperando contrato. Estos son los mas cercanos al cierre. Priorizar sobre todo lo demas.`,
        metric: `${totalEsperandoContrato} contratos pendientes`,
      });
    }

    // 7. Zone analysis
    const byZone = new Map<string, any[]>();
    ll.forEach((l: any) => {
      const z = l.zone || 'OTROS';
      if (!byZone.has(z)) byZone.set(z, []);
      byZone.get(z)!.push(l);
    });
    const zoneStats = Array.from(byZone.entries()).map(([zone, items]: any) => {
      const dealItems = items.filter((l: any) => DEAL_STAGES.includes(l.status));
      const wonItems = items.filter((l: any) => l.status === 'CERRADO_GANADO');
      return {
        zone,
        label: ZONE_LABELS[zone] || zone,
        total: items.length,
        deals: dealItems.length,
        won: wonItems.length,
        conversion: items.length > 0 ? (dealItems.length / items.length) * 100 : 0,
      };
    });
    const bestZone = [...zoneStats].filter((z: any) => z.total >= 3).sort((a: any, b: any) => b.conversion - a.conversion)[0];
    if (bestZone) {
      topSegments.push({
        segment: `Zona: ${bestZone.label}`,
        metric: 'Conversion a Deal',
        value: round2(bestZone.conversion),
        recommendation: `Zona ${bestZone.label} muestra mejor conversion — enfocar recursos aqui`,
      });
    }

    // 8. Industry analysis
    const byIndustry = new Map<string, any[]>();
    ll.filter((l: any) => l.industry).forEach((l: any) => {
      if (!byIndustry.has(l.industry)) byIndustry.set(l.industry, []);
      byIndustry.get(l.industry)!.push(l);
    });
    const industryStats = Array.from(byIndustry.entries()).map(([industry, items]: any) => {
      const dealItems = items.filter((l: any) => DEAL_STAGES.includes(l.status));
      const amount = items.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0);
      return {
        industry,
        total: items.length,
        deals: dealItems.length,
        amount,
        conversion: items.length > 0 ? (dealItems.length / items.length) * 100 : 0,
      };
    });
    const bestIndustry = [...industryStats].filter((i: any) => i.total >= 3).sort((a: any, b: any) => b.conversion - a.conversion)[0];
    if (bestIndustry) {
      topSegments.push({
        segment: `Industria: ${bestIndustry.industry}`,
        metric: 'Conversion a Deal',
        value: round2(bestIndustry.conversion),
        recommendation: `Industria ${bestIndustry.industry} convierte mejor — crear campanas especificas`,
      });
    }

    // 9. High-value segment with low conversion (warning)
    const highValueLow = [...industryStats].filter((i: any) => i.total >= 3 && i.amount > 0).sort((a: any, b: any) => b.amount - a.amount);
    if (highValueLow.length > 0) {
      const top = highValueLow[0];
      if (top.conversion < 30) {
        recommendations.push({
          type: 'warning',
          priority: 'medium',
          title: `Industria ${top.industry} tiene alto valor pero baja conversion`,
          description: `Industria ${top.industry} acumula $${formatNumber(top.amount)} en pipeline pero solo convierte ${round2(top.conversion)}%. Revisar proceso de venta para este segmento.`,
          metric: `$${formatNumber(top.amount)} en pipeline, ${round2(top.conversion)}% conversion`,
        });
      }
    }

    // Build dynamic action plan based on pipeline state
    const actionPlan = this.buildActionPlan(channelStats, totalPendiente, totalCotEntregada, totalEsperandoContrato, ll);

    return { recommendations, topSegments, actionPlan };
  }

  // ─── PRIVATE HELPERS ────────────────────────────────────

  private buildWhere(filters: ChannelFilters): any {
    const where: any = { isHistorical: false, deletedAt: null };

    if (filters.source) {
      where.source = { in: filters.source.split(',') } as any;
    }
    if (filters.zone) {
      where.zone = { in: filters.zone.split(',') } as any;
    }
    if (filters.industry) {
      where.industry = { in: filters.industry.split(',') };
    }
    if (filters.advisorId) {
      where.assignedToId = filters.advisorId;
    }
    if (filters.billRange) {
      where.billRange = { in: filters.billRange.split(',') };
    }
    if (filters.stage) {
      where.status = { in: filters.stage.split(',') } as any;
    }
    if (filters.minAmount !== undefined || filters.maxAmount !== undefined) {
      where.estimatedValue = {};
      if (filters.minAmount !== undefined) where.estimatedValue.gte = filters.minAmount;
      if (filters.maxAmount !== undefined) where.estimatedValue.lte = filters.maxAmount;
    }
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }

    return where;
  }

  private async getFilterOptions() {
    const [sources, zones, industries, advisors, billRanges, stages] = await Promise.all([
      (this.prisma.lead.groupBy as any)({
        by: ['source'],
        where: { isHistorical: false, deletedAt: null },
        _count: { id: true },
      }),
      (this.prisma.lead.groupBy as any)({
        by: ['zone'],
        where: { isHistorical: false, deletedAt: null },
        _count: { id: true },
      }),
      (this.prisma.lead.groupBy as any)({
        by: ['industry'],
        where: { isHistorical: false, deletedAt: null, industry: { not: null } },
        _count: { id: true },
      }),
      this.prisma.user.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, firstName: true, lastName: true },
      }),
      (this.prisma.lead.groupBy as any)({
        by: ['billRange'],
        where: { isHistorical: false, deletedAt: null, billRange: { not: null } },
        _count: { id: true },
      }),
      (this.prisma.lead.groupBy as any)({
        by: ['status'],
        where: { isHistorical: false, deletedAt: null },
        _count: { id: true },
      }),
    ]);

    return {
      sources: sources.map((s: any) => ({ value: s.source, label: SOURCE_LABELS[s.source] || s.source, count: s._count.id })),
      zones: zones.map((z: any) => ({ value: z.zone, label: ZONE_LABELS[z.zone] || z.zone, count: z._count.id })),
      industries: industries.map((i: any) => ({ value: i.industry, label: i.industry, count: i._count.id })),
      advisors: advisors.map((a: any) => ({ value: a.id, label: `${a.firstName} ${a.lastName}` })),
      billRanges: billRanges.map((b: any) => ({ value: b.billRange, label: b.billRange, count: b._count.id })),
      stages: stages.map((s: any) => ({ value: s.status, label: STAGE_LABELS[s.status] || s.status, count: s._count.id })),
    };
  }

  private buildSegmentRow(items: any[], key: string, label: string) {
    const dealItems = items.filter((l: any) => DEAL_STAGES.includes(l.status));
    const amount = items.reduce((s: any, l: any) => s + (l.estimatedValue || 0), 0);
    return {
      ...(/^(BAJIO|OCCIDENTE|CENTRO|NORTE|OTROS)$/.test(key) ? { zone: key } : {}),
      ...(/^(0-50K|50K-200K|200K-500K|500K\+)$/.test(key) ? { billRange: key } : {}),
      ...(!(/(BAJIO|OCCIDENTE|CENTRO|NORTE|OTROS|0-50K|50K-200K|200K-500K|500K\+)/.test(key)) ? { industry: key } : {}),
      label,
      leads: items.length,
      deals: dealItems.length,
      amount,
      avgTicket: items.length > 0 ? round2(amount / items.length) : 0,
      conversionRate: items.length > 0 ? round2((dealItems.length / items.length) * 100) : 0,
    };
  }

  private buildActionPlan(
    channelStats: any[],
    totalPendiente: number,
    totalCotEntregada: number,
    totalEsperandoContrato: number,
    leads: any[],
  ) {
    const week1: string[] = [];
    const week2: string[] = [];
    const week3: string[] = [];
    const week4: string[] = [];

    // Week 1: Immediate actions — close what's close, contact what's pending
    if (totalEsperandoContrato > 0) {
      week1.push(`Cerrar ${totalEsperandoContrato} contratos pendientes de firma — prioridad maxima`);
    }
    if (totalCotEntregada > 0) {
      week1.push(`Dar seguimiento a ${totalCotEntregada} cotizaciones entregadas — llamar esta semana`);
    }
    if (totalPendiente > 0) {
      const urgent = Math.min(totalPendiente, 20);
      week1.push(`Contactar al menos ${urgent} de los ${totalPendiente} leads pendientes de primer contacto`);
    }

    const pendientePago = leads.filter((l: any) => l.status === 'PENDIENTE_PAGO').length;
    if (pendientePago > 0) {
      week1.push(`Cobrar ${pendientePago} deals con pago pendiente`);
    }

    if (week1.length === 0) {
      week1.push('Pipeline limpio — enfocarse en prospeccion activa');
    }

    // Week 2: Optimize pipeline and follow-ups
    const enProspeccion = leads.filter((l: any) => l.status === 'EN_PROSPECCION').length;
    const agendarCita = leads.filter((l: any) => l.status === 'AGENDAR_CITA').length;

    if (enProspeccion > 0) {
      week2.push(`Avanzar ${enProspeccion} leads en prospeccion — calificar y agendar citas`);
    }
    if (agendarCita > 0) {
      week2.push(`Confirmar ${agendarCita} citas pendientes de agendar`);
    }

    const topConversion = [...channelStats].filter((c: any) => c.total >= 3).sort((a: any, b: any) => b.conversionToDeal - a.conversionToDeal)[0];
    if (topConversion) {
      week2.push(`Revisar que leads de ${topConversion.label} reciban atencion prioritaria (mejor conversion: ${round2(topConversion.conversionToDeal)}%)`);
    }

    const lowConversion = [...channelStats].filter((c: any) => c.total >= 5 && c.conversionToDeal < 15).sort((a: any, b: any) => a.conversionToDeal - b.conversionToDeal);
    if (lowConversion.length > 0) {
      week2.push(`Analizar por que ${lowConversion[0].label} tiene baja conversion (${round2(lowConversion[0].conversionToDeal)}%) — posible problema de calidad de leads`);
    }

    if (week2.length === 0) {
      week2.push('Mantener ritmo de seguimiento y avanzar pipeline');
    }

    // Week 3: Strategy and optimization
    const bestTicket = [...channelStats].filter((c: any) => c.total >= 3).sort((a: any, b: any) => b.avgTicket - a.avgTicket)[0];
    if (bestTicket) {
      week3.push(`Evaluar aumento de presupuesto en ${bestTicket.label} — mejor ticket promedio ($${formatNumber(bestTicket.avgTicket)})`);
    }

    const totalActive = leads.filter((l: any) => ACTIVE_STAGES.includes(l.status)).length;
    const totalWon = leads.filter((l: any) => l.status === 'CERRADO_GANADO').length;
    const totalLost = leads.filter((l: any) => l.status === 'CERRADO_PERDIDO').length;

    if (totalLost > 0 && totalActive > 0) {
      const lossRate = round2((totalLost / (totalWon + totalLost)) * 100);
      week3.push(`Tasa de perdida: ${lossRate}% — analizar motivos de perdida para mejorar proceso`);
    }

    week3.push('Revisar metricas de conversion por canal y ajustar estrategia de captacion');

    // Week 4: Planning and scaling
    const channelsWithLeads = channelStats.filter((c: any) => c.total > 0).length;
    week4.push(`Preparar reporte mensual de rendimiento por canal (${channelsWithLeads} canales activos)`);

    if (totalActive > 0) {
      week4.push(`Pipeline activo: ${totalActive} leads — definir metas de conversion para proximo mes`);
    }

    const esperandoCot = leads.filter((l: any) => l.status === 'ESPERANDO_COTIZACION').length;
    if (esperandoCot > 0) {
      week4.push(`Reducir tiempo de cotizacion — ${esperandoCot} leads esperando cotizacion`);
    }

    week4.push('Planear campanas y presupuesto del proximo mes basado en rendimiento actual');

    return { week1, week2, week3, week4 };
  }
}

// ─── UTILS ────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}
