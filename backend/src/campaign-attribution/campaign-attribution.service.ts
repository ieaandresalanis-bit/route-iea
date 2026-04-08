import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// ═══════════════════════════════════════════════════════════
// MAPPING TABLES — Source of truth for normalization
// ═══════════════════════════════════════════════════════════

/** Zoho Lead_Source → channel */
const SOURCE_TO_CHANNEL: Record<string, string> = {
  'Facebook Ads': 'Meta',
  'Meta Ads': 'Meta',
  'Instagram Ads': 'Meta',
  'Google Ads': 'Google',
  'Google AdWords': 'Google',
  'TikTok Ads': 'TikTok',
  'Recomendación': 'Referral',
  'External Referral': 'Referral',
  'Partner': 'Referral',
  'Prospección': 'Outbound',
  'Cambaceo': 'Outbound',
  'Cold Call': 'Outbound',
  'Sitio Web': 'Organic',
  'Web Research': 'Organic',
  'Web Download': 'Organic',
  'Chat': 'Organic',
  'Zoho Bookings': 'Organic',
  'WIKI': 'Wiki',
  'Wiki': 'Wiki',
  'WhatsApp - IEA Digital': 'WhatsApp',
  'WhatsApp - Woztell': 'WhatsApp',
  'BD TT Vasco': 'Database',
  'BD 19 Hermanos': 'Database',
  'BD CFE': 'Database',
  'BD Celulares Asesores': 'Database',
  'Internal Seminar': 'Events',
  'Seminar Partner': 'Events',
  'Trade Show': 'Events',
  'Public Relations': 'PR',
  'Sales Email Alias': 'Organic',
  'Twitter': 'Social',
  'Facebook': 'Meta',
  'Google+': 'Google',
};

/** Channel → source type */
const CHANNEL_TO_SOURCE_TYPE: Record<string, string> = {
  'Meta': 'paid',
  'Google': 'paid',
  'TikTok': 'paid',
  'Referral': 'referral',
  'Outbound': 'outbound',
  'Organic': 'organic',
  'Wiki': 'organic',
  'WhatsApp': 'organic',
  'Database': 'database',
  'Events': 'organic',
  'PR': 'organic',
  'Social': 'organic',
};

/** Zoho Ad_Campaign → normalized name + group + type */
interface CampaignNorm {
  name: string;
  group: string;
  type: string;
  targetProduct?: string;
  targetZone?: string;
}

const CAMPAIGN_NORMALIZATIONS: Record<string, CampaignNorm> = {
  'IND ARRENDAMIENTO ANDRES': {
    name: 'Industrial Arrendamiento Andres',
    group: 'Arrendamiento',
    type: 'performance',
    targetProduct: 'arrendamiento',
  },
  'IND ARRENDAMIENTO NEW VID': {
    name: 'Industrial Arrendamiento Video',
    group: 'Arrendamiento',
    type: 'performance',
    targetProduct: 'arrendamiento',
  },
  'CAMPAÑA POR CENTROS DE UTILIDAD': {
    name: 'Centros de Utilidad',
    group: 'Centros de Utilidad',
    type: 'performance',
    targetProduct: 'solar_commercial',
  },
  'PANELES SOLARES NEGOCIOS 3 SEGMENTADA': {
    name: 'Paneles Negocios Segmentada',
    group: 'Solar Negocios',
    type: 'performance',
    targetProduct: 'solar_commercial',
  },
  'NEGOCIOS PANELES': {
    name: 'Negocios Paneles',
    group: 'Solar Negocios',
    type: 'performance',
    targetProduct: 'solar_commercial',
  },
  'INDUSTRIALES': {
    name: 'Industriales General',
    group: 'Industrial',
    type: 'performance',
    targetProduct: 'industrial',
  },
  'BAJIO MAYO FORMULARIO': {
    name: 'Formulario Bajio Mayo',
    group: 'Regional Formularios',
    type: 'performance',
    targetZone: 'BAJIO',
  },
  'MAYO FORMULARIO QUERETARO': {
    name: 'Formulario Queretaro Mayo',
    group: 'Regional Formularios',
    type: 'performance',
    targetZone: 'BAJIO',
  },
  'ASESORES': {
    name: 'Asesores Internos',
    group: 'Interno',
    type: 'internal',
  },
  'INSTAGRAM MARZO (1)': {
    name: 'Instagram Marzo',
    group: 'Social Ads',
    type: 'performance',
  },
};

/** Infer channel from Ad_Campaign name when Lead_Source is missing */
function inferChannelFromCampaign(campaignName: string): string | null {
  const upper = (campaignName || '').toUpperCase();
  if (upper.includes('FACEBOOK') || upper.includes('META') || upper.includes('INSTAGRAM') || upper.includes('FB')) return 'Meta';
  if (upper.includes('GOOGLE') || upper.includes('ADWORDS')) return 'Google';
  if (upper.includes('TIKTOK') || upper.includes('TT')) return 'TikTok';
  return null;
}

/** Infer campaign type from name patterns when not in lookup table */
function inferCampaignNorm(campaignName: string): CampaignNorm {
  const upper = (campaignName || '').toUpperCase();

  let group = 'Otros';
  let type = 'performance';
  let targetProduct: string | undefined;
  let targetZone: string | undefined;

  if (upper.includes('ARRENDAMIENTO')) { group = 'Arrendamiento'; targetProduct = 'arrendamiento'; }
  else if (upper.includes('CENTROS') || upper.includes('UTILIDAD')) { group = 'Centros de Utilidad'; targetProduct = 'solar_commercial'; }
  else if (upper.includes('PANELES') || upper.includes('SOLAR') || upper.includes('NEGOCIOS')) { group = 'Solar Negocios'; targetProduct = 'solar_commercial'; }
  else if (upper.includes('INDUSTRIAL')) { group = 'Industrial'; targetProduct = 'industrial'; }
  else if (upper.includes('FORMULARIO')) { group = 'Regional Formularios'; }
  else if (upper.includes('ASESOR')) { group = 'Interno'; type = 'internal'; }
  else if (upper.includes('INSTAGRAM') || upper.includes('FACEBOOK') || upper.includes('META')) { group = 'Social Ads'; }
  else if (upper.includes('RESIDENCIAL') || upper.includes('HOGAR')) { group = 'Residencial'; targetProduct = 'solar_residential'; }
  else if (upper.includes('BRANDING') || upper.includes('MARCA')) { group = 'Branding'; type = 'branding'; }

  // Infer zone from name
  if (upper.includes('BAJIO') || upper.includes('GTO') || upper.includes('QUERETARO') || upper.includes('QRO') || upper.includes('AGS') || upper.includes('SLP')) targetZone = 'BAJIO';
  else if (upper.includes('GDL') || upper.includes('JALISCO') || upper.includes('OCCIDENTE')) targetZone = 'OCCIDENTE';
  else if (upper.includes('CDMX') || upper.includes('CENTRO') || upper.includes('PUEBLA')) targetZone = 'CENTRO';
  else if (upper.includes('MONTERREY') || upper.includes('MTY') || upper.includes('NORTE')) targetZone = 'NORTE';

  // Normalize name
  const name = campaignName
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  return { name, group, type, targetProduct, targetZone };
}

// ═══════════════════════════════════════════════════════════
// EXPORT TYPES
// ═══════════════════════════════════════════════════════════

export interface AttributionResult {
  leadId: string;
  campaignName: string | null;
  campaignGroup: string | null;
  campaignType: string | null;
  channel: string | null;
  sourceType: string | null;
  attributionMethod: string;
  confidence: number;
}

export interface AttributionStats {
  totalLeads: number;
  leadsWithCampaign: number;
  leadsWithChannel: number;
  dealsWithCampaign: number;
  dealsTotal: number;
  revenueAttributed: number;
  revenueTotal: number;
  pctLeadsCampaign: number;
  pctLeadsChannel: number;
  pctDealsCampaign: number;
  pctRevenueAttributed: number;
  byCampaign: Array<{ campaign: string; leads: number; deals: number; won: number; revenue: number }>;
  byChannel: Array<{ channel: string; leads: number; deals: number; won: number; revenue: number; sourceType: string }>;
  byGroup: Array<{ group: string; leads: number; deals: number; won: number; revenue: number }>;
  byType: Array<{ type: string; leads: number; deals: number; won: number; revenue: number }>;
  unattributed: Array<{ leadId: string; companyName: string; reason: string }>;
}

export interface SyncResult {
  campaignsCreated: number;
  campaignsUpdated: number;
  attributionsCreated: number;
  attributionsUpdated: number;
  errors: string[];
}

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

@Injectable()
export class CampaignAttributionService {
  private readonly logger = new Logger(CampaignAttributionService.name);

  constructor(private prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────
  // 1. SEED CAMPAIGN DIMENSION TABLE from known campaigns
  // ─────────────────────────────────────────────────────────

  async seedCampaigns(): Promise<{ created: number; existing: number }> {
    let created = 0;
    let existing = 0;

    // From the normalization table
    for (const [zohoName, norm] of Object.entries(CAMPAIGN_NORMALIZATIONS)) {
      const channel = inferChannelFromCampaign(zohoName) || 'Wiki'; // Most Zoho campaigns come via Wiki
      const sourceType = CHANNEL_TO_SOURCE_TYPE[channel] || 'organic';

      const exists = await this.prisma.campaign.findUnique({ where: { name: norm.name } });
      if (exists) { existing++; continue; }

      await this.prisma.campaign.create({
        data: {
          name: norm.name,
          zohoName,
          campaignGroup: norm.group,
          campaignType: norm.type,
          channel,
          sourceType,
          targetZone: norm.targetZone || null,
          targetProduct: norm.targetProduct || null,
          description: `Auto-generated from Zoho campaign: ${zohoName}`,
        },
      });
      created++;
    }

    // Also create meta-campaigns for each source/channel that has no specific campaign
    const metaCampaigns = [
      { name: 'Referidos Directos', group: 'Referidos', type: 'referral', channel: 'Referral', sourceType: 'referral' },
      { name: 'Prospeccion Outbound', group: 'Outbound', type: 'outbound', channel: 'Outbound', sourceType: 'outbound' },
      { name: 'Trafico Organico Web', group: 'Organico', type: 'organic', channel: 'Organic', sourceType: 'organic' },
      { name: 'WhatsApp Entrante', group: 'WhatsApp', type: 'organic', channel: 'WhatsApp', sourceType: 'organic' },
      { name: 'Base de Datos Externa', group: 'Database', type: 'database', channel: 'Database', sourceType: 'database' },
      { name: 'Eventos y Ferias', group: 'Eventos', type: 'organic', channel: 'Events', sourceType: 'organic' },
      { name: 'Wiki Sin Campana', group: 'Wiki', type: 'organic', channel: 'Wiki', sourceType: 'organic' },
      { name: 'Google Ads General', group: 'Google Ads', type: 'performance', channel: 'Google', sourceType: 'paid' },
      { name: 'Meta Ads General', group: 'Meta Ads', type: 'performance', channel: 'Meta', sourceType: 'paid' },
      { name: 'TikTok Ads General', group: 'TikTok Ads', type: 'performance', channel: 'TikTok', sourceType: 'paid' },
    ];

    for (const mc of metaCampaigns) {
      const exists = await this.prisma.campaign.findUnique({ where: { name: mc.name } });
      if (exists) { existing++; continue; }
      await this.prisma.campaign.create({
        data: {
          name: mc.name,
          campaignGroup: mc.group,
          campaignType: mc.type,
          channel: mc.channel,
          sourceType: mc.sourceType,
          description: `Meta-campaign for ${mc.channel} leads without specific campaign`,
        },
      });
      created++;
    }

    return { created, existing };
  }

  // ─────────────────────────────────────────────────────────
  // 2. ATTRIBUTE — Process a single lead/deal from Zoho data
  // ─────────────────────────────────────────────────────────

  attributeFromZoho(zohoLeadSource: string | null, zohoAdCampaign: string | null, zohoUtmSource?: string | null, zohoUtmMedium?: string | null, zohoUtmCampaign?: string | null): AttributionResult {
    let channel: string | null = null;
    let sourceType: string | null = null;
    let campaignName: string | null = null;
    let campaignGroup: string | null = null;
    let campaignType: string | null = null;
    let method = 'manual';
    let confidence = 0.5;

    // Priority 1: UTM parameters (highest confidence)
    if (zohoUtmSource || zohoUtmCampaign) {
      method = 'utm';
      confidence = 1.0;
      if (zohoUtmSource) {
        const src = zohoUtmSource.toLowerCase();
        if (src.includes('facebook') || src.includes('meta') || src.includes('ig') || src.includes('instagram')) channel = 'Meta';
        else if (src.includes('google')) channel = 'Google';
        else if (src.includes('tiktok')) channel = 'TikTok';
        else channel = zohoUtmSource;
      }
      if (zohoUtmCampaign) campaignName = zohoUtmCampaign;
    }

    // Priority 2: Ad_Campaign field
    if (zohoAdCampaign) {
      const norm = CAMPAIGN_NORMALIZATIONS[zohoAdCampaign] || inferCampaignNorm(zohoAdCampaign);
      campaignName = norm.name;
      campaignGroup = norm.group;
      campaignType = norm.type;
      method = method === 'utm' ? 'utm' : 'zoho_sync';
      confidence = Math.max(confidence, 0.9);

      // If channel not set from UTM, infer from campaign name
      if (!channel) {
        channel = inferChannelFromCampaign(zohoAdCampaign);
      }
    }

    // Priority 3: Lead_Source field
    if (zohoLeadSource) {
      const mappedChannel = SOURCE_TO_CHANNEL[zohoLeadSource];
      if (mappedChannel) {
        if (!channel) channel = mappedChannel;
        sourceType = CHANNEL_TO_SOURCE_TYPE[mappedChannel] || 'organic';
        if (!method || method === 'manual') {
          method = 'inferred_source';
          confidence = Math.max(confidence, 0.8);
        }
      }

      // If no campaign yet, assign meta-campaign based on channel
      if (!campaignName && channel) {
        const metaMap: Record<string, string> = {
          'Referral': 'Referidos Directos',
          'Outbound': 'Prospeccion Outbound',
          'Organic': 'Trafico Organico Web',
          'WhatsApp': 'WhatsApp Entrante',
          'Database': 'Base de Datos Externa',
          'Events': 'Eventos y Ferias',
          'Wiki': 'Wiki Sin Campana',
          'Google': 'Google Ads General',
          'Meta': 'Meta Ads General',
          'TikTok': 'TikTok Ads General',
        };
        campaignName = metaMap[channel] || null;
        if (campaignName) {
          method = 'inferred_source';
        }
      }
    }

    // Final: derive sourceType from channel if still missing
    if (!sourceType && channel) {
      sourceType = CHANNEL_TO_SOURCE_TYPE[channel] || 'organic';
    }

    // Set defaults for unresolved
    if (!channel) { channel = 'Unknown'; sourceType = 'unknown'; confidence = 0.3; method = 'manual'; }

    return {
      leadId: '', // Set by caller
      campaignName,
      campaignGroup: campaignGroup || null,
      campaignType: campaignType || null,
      channel,
      sourceType,
      attributionMethod: method,
      confidence,
    };
  }

  // ─────────────────────────────────────────────────────────
  // 3. SYNC — Pull from Zoho and attribute all leads/deals
  // ─────────────────────────────────────────────────────────

  async syncFromZohoData(zohoLeads: any[], zohoDeals: any[]): Promise<SyncResult> {
    const result: SyncResult = {
      campaignsCreated: 0,
      campaignsUpdated: 0,
      attributionsCreated: 0,
      attributionsUpdated: 0,
      errors: [],
    };

    // Seed campaigns first
    const seedResult = await this.seedCampaigns();
    result.campaignsCreated = seedResult.created;

    // Load all campaigns for lookup
    const allCampaigns = await this.prisma.campaign.findMany();
    const campaignByName = new Map(allCampaigns.map(c => [c.name, c]));

    // Also discover new campaigns from data
    const seenCampaigns = new Set<string>();
    [...zohoLeads, ...zohoDeals].forEach(record => {
      if (record.Ad_Campaign) seenCampaigns.add(record.Ad_Campaign);
    });

    for (const zohoCampaignName of seenCampaigns) {
      const norm = CAMPAIGN_NORMALIZATIONS[zohoCampaignName] || inferCampaignNorm(zohoCampaignName);
      if (!campaignByName.has(norm.name)) {
        try {
          const channel = inferChannelFromCampaign(zohoCampaignName) || 'Wiki';
          const campaign = await this.prisma.campaign.create({
            data: {
              name: norm.name,
              zohoName: zohoCampaignName,
              campaignGroup: norm.group,
              campaignType: norm.type,
              channel,
              sourceType: CHANNEL_TO_SOURCE_TYPE[channel] || 'organic',
              targetZone: norm.targetZone || null,
              targetProduct: norm.targetProduct || null,
              description: `Discovered from Zoho data: ${zohoCampaignName}`,
            },
          });
          campaignByName.set(norm.name, campaign);
          result.campaignsCreated++;
        } catch (e: any) {
          if (!e.message?.includes('Unique constraint')) {
            result.errors.push(`Campaign create error: ${zohoCampaignName} — ${e.message}`);
          }
        }
      }
    }

    // Process all leads — build a map by zohoLeadId
    const leadsByZohoId = new Map<string, string>();
    const localLeads = await this.prisma.lead.findMany({
      where: { zohoLeadId: { not: null } },
      select: { id: true, zohoLeadId: true },
    });
    localLeads.forEach(l => { if (l.zohoLeadId) leadsByZohoId.set(l.zohoLeadId, l.id); });

    // Process deals — create attributions
    const wonStatuses = ['Cerrado Ganado', 'Cerrado Anticipo Pagado', 'Vendida', '1er Pago Ingresado', '2do Pago ingresado'];
    const allRecords = [
      ...zohoLeads.map(r => ({ ...r, _type: 'lead' })),
      ...zohoDeals.map(r => ({ ...r, _type: 'deal' })),
    ];

    for (const record of allRecords) {
      try {
        const zohoId = record.id;
        const leadSource = record.Lead_Source;
        const adCampaign = record.Ad_Campaign;
        const utmSource = record.utm_source;
        const utmMedium = record.utm_medium;
        const utmCampaign = record.utm_campaign;

        // Resolve local lead ID
        let localLeadId = leadsByZohoId.get(zohoId);
        if (!localLeadId && record._type === 'deal') {
          // For deals, we may not have a direct mapping yet — use zoho ID as placeholder
          localLeadId = `zoho_deal_${zohoId}`;
        }
        if (!localLeadId) {
          localLeadId = `zoho_lead_${zohoId}`;
        }

        // Attribute
        const attr = this.attributeFromZoho(leadSource, adCampaign, utmSource, utmMedium, utmCampaign);

        // Find campaign record
        const campaignRecord = attr.campaignName ? campaignByName.get(attr.campaignName) : null;

        // Deal info
        const isWon = record._type === 'deal' && wonStatuses.includes(record.Stage);
        const dealAmount = record.Amount || null;

        // Upsert attribution
        const existing = await this.prisma.campaignAttribution.findUnique({ where: { leadId: localLeadId } });

        const data = {
          campaignId: campaignRecord?.id || null,
          campaignName: attr.campaignName,
          campaignGroup: attr.campaignGroup || campaignRecord?.campaignGroup || null,
          campaignType: attr.campaignType || campaignRecord?.campaignType || null,
          channel: attr.channel,
          sourceType: attr.sourceType,
          zohoLeadSource: leadSource || null,
          zohoAdCampaign: adCampaign || null,
          zohoUtmSource: utmSource || null,
          zohoUtmMedium: utmMedium || null,
          zohoUtmCampaign: utmCampaign || null,
          attributionMethod: attr.attributionMethod,
          confidence: attr.confidence,
          dealStage: record._type === 'deal' ? record.Stage : null,
          dealAmount,
          dealPipeline: record.Pipeline || null,
          isWon,
          revenueAttributed: isWon ? dealAmount : null,
        };

        if (existing) {
          await this.prisma.campaignAttribution.update({ where: { leadId: localLeadId }, data });
          result.attributionsUpdated++;
        } else {
          await this.prisma.campaignAttribution.create({ data: { leadId: localLeadId, ...data } });
          result.attributionsCreated++;
        }
      } catch (e: any) {
        result.errors.push(`Attribution error: ${record.id} — ${e.message}`);
      }
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────
  // 4. BACKFILL — Attribute existing local leads
  // ─────────────────────────────────────────────────────────

  async backfillLocalLeads(): Promise<{ processed: number; attributed: number }> {
    const leads = await this.prisma.lead.findMany({
      where: { deletedAt: null, isHistorical: false },
      select: { id: true, source: true, zone: true, industry: true, estimatedValue: true, status: true },
    });

    const allCampaigns = await this.prisma.campaign.findMany();
    const campaignByName = new Map(allCampaigns.map(c => [c.name, c]));

    // Map local LeadSource enum → Zoho source for attribution
    const localSourceToZoho: Record<string, string> = {
      MANUAL: 'Prospección',
      REFERRAL: 'Recomendación',
      WEBSITE: 'Sitio Web',
      COLD_CALL: 'Cambaceo',
      TRADE_SHOW: 'Trade Show',
      ZOHO_CRM: 'Wiki',
      OTHER: '',
    };

    let attributed = 0;

    for (const lead of leads) {
      const zohoSource = localSourceToZoho[lead.source as string] || '';
      const attr = this.attributeFromZoho(zohoSource, null, null, null, null);
      attr.leadId = lead.id;

      const campaignRecord = attr.campaignName ? campaignByName.get(attr.campaignName) : null;

      const wonStatuses = ['CERRADO_GANADO'];
      const isWon = wonStatuses.includes(lead.status as string);

      const existing = await this.prisma.campaignAttribution.findUnique({ where: { leadId: lead.id } });

      const data = {
        campaignId: campaignRecord?.id || null,
        campaignName: attr.campaignName,
        campaignGroup: attr.campaignGroup || campaignRecord?.campaignGroup || null,
        campaignType: attr.campaignType || campaignRecord?.campaignType || null,
        channel: attr.channel,
        sourceType: attr.sourceType,
        zohoLeadSource: zohoSource || null,
        attributionMethod: 'inferred_source',
        confidence: 0.7,
        isWon,
        revenueAttributed: isWon ? (lead.estimatedValue || 0) : null,
        dealAmount: lead.estimatedValue || null,
      };

      if (existing) {
        await this.prisma.campaignAttribution.update({ where: { leadId: lead.id }, data });
      } else {
        await this.prisma.campaignAttribution.create({ data: { leadId: lead.id, ...data } });
      }
      attributed++;
    }

    return { processed: leads.length, attributed };
  }

  // ─────────────────────────────────────────────────────────
  // 5. VALIDATION STATS — Attribution coverage
  // ─────────────────────────────────────────────────────────

  async getAttributionStats(): Promise<AttributionStats> {
    const allAttrs = await this.prisma.campaignAttribution.findMany();
    const totalLeads = allAttrs.length;

    const leadsWithCampaign = allAttrs.filter(a => a.campaignName && a.campaignName !== 'Unknown').length;
    const leadsWithChannel = allAttrs.filter(a => a.channel && a.channel !== 'Unknown').length;
    const deals = allAttrs.filter(a => a.dealStage || a.dealAmount);
    const dealsWithCampaign = deals.filter(a => a.campaignName && a.campaignName !== 'Unknown').length;
    const wonDeals = allAttrs.filter(a => a.isWon);
    const revenueTotal = allAttrs.reduce((s, a) => s + (a.dealAmount || 0), 0);
    const revenueAttributed = wonDeals.filter(a => a.campaignName).reduce((s, a) => s + (a.revenueAttributed || 0), 0);

    // Group by campaign
    const byCampaignMap: Record<string, { leads: number; deals: number; won: number; revenue: number }> = {};
    allAttrs.forEach(a => {
      const key = a.campaignName || 'Sin Campana';
      if (!byCampaignMap[key]) byCampaignMap[key] = { leads: 0, deals: 0, won: 0, revenue: 0 };
      byCampaignMap[key].leads++;
      if (a.dealStage || a.dealAmount) byCampaignMap[key].deals++;
      if (a.isWon) { byCampaignMap[key].won++; byCampaignMap[key].revenue += a.revenueAttributed || 0; }
    });

    // Group by channel
    const byChannelMap: Record<string, { leads: number; deals: number; won: number; revenue: number; sourceType: string }> = {};
    allAttrs.forEach(a => {
      const key = a.channel || 'Unknown';
      if (!byChannelMap[key]) byChannelMap[key] = { leads: 0, deals: 0, won: 0, revenue: 0, sourceType: a.sourceType || 'unknown' };
      byChannelMap[key].leads++;
      if (a.dealStage || a.dealAmount) byChannelMap[key].deals++;
      if (a.isWon) { byChannelMap[key].won++; byChannelMap[key].revenue += a.revenueAttributed || 0; }
    });

    // Group by campaign group
    const byGroupMap: Record<string, { leads: number; deals: number; won: number; revenue: number }> = {};
    allAttrs.forEach(a => {
      const key = a.campaignGroup || 'Sin Grupo';
      if (!byGroupMap[key]) byGroupMap[key] = { leads: 0, deals: 0, won: 0, revenue: 0 };
      byGroupMap[key].leads++;
      if (a.dealStage || a.dealAmount) byGroupMap[key].deals++;
      if (a.isWon) { byGroupMap[key].won++; byGroupMap[key].revenue += a.revenueAttributed || 0; }
    });

    // Group by type
    const byTypeMap: Record<string, { leads: number; deals: number; won: number; revenue: number }> = {};
    allAttrs.forEach(a => {
      const key = a.campaignType || 'unknown';
      if (!byTypeMap[key]) byTypeMap[key] = { leads: 0, deals: 0, won: 0, revenue: 0 };
      byTypeMap[key].leads++;
      if (a.dealStage || a.dealAmount) byTypeMap[key].deals++;
      if (a.isWon) { byTypeMap[key].won++; byTypeMap[key].revenue += a.revenueAttributed || 0; }
    });

    // Unattributed leads
    const localLeads = await this.prisma.lead.findMany({
      where: { deletedAt: null, isHistorical: false },
      select: { id: true, companyName: true },
    });
    const attributedIds = new Set(allAttrs.map(a => a.leadId));
    const unattributed = localLeads
      .filter(l => !attributedIds.has(l.id))
      .map(l => ({ leadId: l.id, companyName: l.companyName, reason: 'No attribution record' }));

    // Also flag low-confidence attributions
    const lowConf = allAttrs
      .filter(a => a.confidence < 0.5)
      .slice(0, 10)
      .map(a => ({ leadId: a.leadId, companyName: '', reason: `Low confidence (${a.confidence})` }));

    return {
      totalLeads,
      leadsWithCampaign,
      leadsWithChannel,
      dealsWithCampaign,
      dealsTotal: deals.length,
      revenueAttributed,
      revenueTotal,
      pctLeadsCampaign: totalLeads > 0 ? Math.round((leadsWithCampaign / totalLeads) * 100) : 0,
      pctLeadsChannel: totalLeads > 0 ? Math.round((leadsWithChannel / totalLeads) * 100) : 0,
      pctDealsCampaign: deals.length > 0 ? Math.round((dealsWithCampaign / deals.length) * 100) : 0,
      pctRevenueAttributed: revenueTotal > 0 ? Math.round((revenueAttributed / revenueTotal) * 100) : 0,
      byCampaign: Object.entries(byCampaignMap).map(([campaign, v]) => ({ campaign, ...v })).sort((a, b) => b.leads - a.leads),
      byChannel: Object.entries(byChannelMap).map(([channel, v]) => ({ channel, ...v })).sort((a, b) => b.leads - a.leads),
      byGroup: Object.entries(byGroupMap).map(([group, v]) => ({ group, ...v })).sort((a, b) => b.leads - a.leads),
      byType: Object.entries(byTypeMap).map(([type, v]) => ({ type, ...v })).sort((a, b) => b.leads - a.leads),
      unattributed: [...unattributed, ...lowConf],
    };
  }

  // ─────────────────────────────────────────────────────────
  // 6. CAMPAIGN DIMENSION QUERIES
  // ─────────────────────────────────────────────────────────

  async getCampaigns() {
    return this.prisma.campaign.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }

  async getChannels() {
    const campaigns = await this.prisma.campaign.findMany({ where: { isActive: true } });
    const channelMap: Record<string, { channel: string; sourceType: string; campaigns: number }> = {};
    campaigns.forEach(c => {
      if (!channelMap[c.channel]) channelMap[c.channel] = { channel: c.channel, sourceType: c.sourceType, campaigns: 0 };
      channelMap[c.channel].campaigns++;
    });
    return Object.values(channelMap).sort((a, b) => b.campaigns - a.campaigns);
  }

  async getSourceTypes() {
    const campaigns = await this.prisma.campaign.findMany({ where: { isActive: true } });
    const typeMap: Record<string, { sourceType: string; channels: Set<string>; campaigns: number }> = {};
    campaigns.forEach(c => {
      if (!typeMap[c.sourceType]) typeMap[c.sourceType] = { sourceType: c.sourceType, channels: new Set(), campaigns: 0 };
      typeMap[c.sourceType].channels.add(c.channel);
      typeMap[c.sourceType].campaigns++;
    });
    return Object.values(typeMap).map(t => ({
      sourceType: t.sourceType,
      channels: Array.from(t.channels),
      campaigns: t.campaigns,
    }));
  }

  // ─────────────────────────────────────────────────────────
  // 7. FULL ZOHO SYNC — Fetch from Zoho and process
  // ─────────────────────────────────────────────────────────

  /** Callable externally to process pre-fetched Zoho data */
  async processZohoSync(leads: any[], deals: any[]): Promise<SyncResult> {
    this.logger.log(`Processing Zoho sync: ${leads.length} leads, ${deals.length} deals`);
    return this.syncFromZohoData(leads, deals);
  }
}
