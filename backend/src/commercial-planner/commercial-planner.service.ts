import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const PIPELINE_STATUSES: any[] = [
  'PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR', 'EN_PROSPECCION', 'AGENDAR_CITA',
  'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO',
];
const WON = 'CERRADO_GANADO' as any;
const LOST = 'CERRADO_PERDIDO' as any;
const TERMINAL: any[] = ['CERRADO_GANADO', 'CERRADO_PERDIDO', 'LEAD_BASURA', 'CONTACTAR_FUTURO'];
const LATE_STAGES: any[] = ['COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO'];

const ZONE_LABELS: Record<string, string> = {
  BAJIO: 'Bajio', OCCIDENTE: 'Occidente', CENTRO: 'Centro', NORTE: 'Norte', OTROS: 'Otros',
};
const STATUS_LABELS: Record<string, string> = {
  PENDIENTE_CONTACTAR: 'Pendiente Contactar', INTENTANDO_CONTACTAR: 'Intentando Contactar',
  EN_PROSPECCION: 'En Prospeccion', AGENDAR_CITA: 'Agendar Cita',
  ESPERANDO_COTIZACION: 'Esperando Cotizacion', COTIZACION_ENTREGADA: 'Cotizacion Entregada',
  ESPERANDO_CONTRATO: 'Esperando Contrato', PENDIENTE_PAGO: 'Pendiente Pago',
  CERRADO_GANADO: 'Ganado', CERRADO_PERDIDO: 'Perdido',
};

const TICKET_RANGES = [
  { key: 'micro', label: 'Micro (<$50K)', min: 0, max: 50000 },
  { key: 'small', label: 'Chico ($50K-$150K)', min: 50000, max: 150000 },
  { key: 'medium', label: 'Mediano ($150K-$500K)', min: 150000, max: 500000 },
  { key: 'large', label: 'Grande ($500K-$1.5M)', min: 500000, max: 1500000 },
  { key: 'enterprise', label: 'Enterprise (>$1.5M)', min: 1500000, max: Infinity },
];

const ZONES = ['BAJIO', 'OCCIDENTE', 'CENTRO', 'NORTE', 'OTROS'];

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface TargetPriority {
  leadId: string;
  companyName: string;
  contactName: string;
  zone: string;
  status: string;
  industry: string | null;
  estimatedValue: number;
  score: number;
  reason: string;
  recommendedAction: string;
  urgency: 'critical' | 'high' | 'medium' | 'low';
}

export interface ZonePriority {
  zone: string;
  label: string;
  priorityScore: number;
  totalLeads: number;
  pipelineLeads: number;
  pipelineValue: number;
  wonLeads: number;
  wonValue: number;
  lostLeads: number;
  conversionRate: number;
  avgTicket: number;
  avgDaysToClose: number;
  hotLeads: number;
  lowAttention: number;
  topIndustry: string | null;
  recommendation: string;
  actions: string[];
}

export interface TicketAnalysis {
  range: string;
  label: string;
  totalLeads: number;
  pipelineLeads: number;
  pipelineValue: number;
  wonLeads: number;
  wonValue: number;
  lostLeads: number;
  conversionRate: number;
  avgDaysToClose: number;
  roi: number; // won value relative to effort
  recommendation: string;
  priority: 'focus' | 'scale' | 'maintain' | 'deprioritize';
}

export interface IndustryConversion {
  industry: string;
  totalLeads: number;
  pipelineLeads: number;
  pipelineValue: number;
  wonLeads: number;
  wonValue: number;
  lostLeads: number;
  conversionRate: number;
  avgTicket: number;
  avgDaysToClose: number;
  topZone: string | null;
  recommendation: string;
  rating: 'star' | 'strong' | 'average' | 'weak' | 'insufficient_data';
}

export interface CampaignRecommendation {
  source: string;
  totalLeads: number;
  pipelineLeads: number;
  wonLeads: number;
  conversionRate: number;
  avgTicket: number;
  totalValue: number;
  costEfficiency: 'excellent' | 'good' | 'average' | 'poor';
  action: 'scale' | 'maintain' | 'adjust' | 'pause';
  reasoning: string;
  suggestions: string[];
}

export interface SegmentMessaging {
  segment: string;
  description: string;
  leadCount: number;
  avgValue: number;
  recommendedTone: string;
  recommendedChannels: string[];
  keyMessages: string[];
  contentAngles: string[];
  avoidMessages: string[];
}

export interface CenterPlan {
  zone: string;
  label: string;
  commercialPriorityScore: number;
  priorityIndustry: { industry: string; reason: string } | null;
  priorityTicketRange: { range: string; reason: string };
  recommendedCampaigns: Array<{ source: string; reason: string }>;
  suggestedContentAngle: string;
  advisorFocus: string;
  topOpportunities: Array<{ leadId: string; company: string; value: number; reason: string }>;
  actions: string[];
  risks: string[];
}

export interface CommercialPlan {
  generatedAt: string;
  summary: string;
  targetPriorities: TargetPriority[];
  zonePriorities: ZonePriority[];
  ticketAnalysis: TicketAnalysis[];
  industryConversions: IndustryConversion[];
  campaignRecommendations: CampaignRecommendation[];
  segmentMessaging: SegmentMessaging[];
  centerPlans: CenterPlan[];
}

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

@Injectable()
export class CommercialPlannerService {
  private readonly logger = new Logger(CommercialPlannerService.name);

  constructor(private prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────
  // 1. TARGET PRIORITIES — Which businesses to target first
  // ─────────────────────────────────────────────────────────

  async getTargetPriorities(limit = 25): Promise<TargetPriority[]> {
    const leads = await this.prisma.lead.findMany({
      where: { deletedAt: null, isHistorical: false, status: { in: PIPELINE_STATUSES } },
      select: {
        id: true, companyName: true, contactName: true, zone: true, status: true,
        industry: true, estimatedValue: true, source: true,
        lastContactedAt: true, createdAt: true,
        assignedTo: { select: { firstName: true, lastName: true } },
        visits: { select: { visitDate: true, outcome: true }, orderBy: { visitDate: 'desc' }, take: 3 },
      },
    });

    const now = Date.now();
    const scored = leads.map(lead => {
      let score = 0;
      const reasons: string[] = [];
      const value = lead.estimatedValue || 0;

      // Value score (0-30)
      if (value >= 1000000) { score += 30; reasons.push('enterprise value'); }
      else if (value >= 500000) { score += 25; reasons.push('high value'); }
      else if (value >= 150000) { score += 18; reasons.push('medium value'); }
      else if (value >= 50000) { score += 10; }

      // Stage score (0-25) — later stages = closer to close
      const stageScores: Record<string, number> = {
        PENDIENTE_PAGO: 25, ESPERANDO_CONTRATO: 22, COTIZACION_ENTREGADA: 18,
        ESPERANDO_COTIZACION: 14, AGENDAR_CITA: 10, EN_PROSPECCION: 6,
        INTENTANDO_CONTACTAR: 3, PENDIENTE_CONTACTAR: 1,
      };
      score += stageScores[lead.status as string] || 0;
      if (LATE_STAGES.includes(lead.status)) reasons.push('near closing');

      // Recency penalty (0 to -15)
      const daysSinceContact = lead.lastContactedAt
        ? Math.floor((now - new Date(lead.lastContactedAt).getTime()) / 86400000)
        : Math.floor((now - new Date(lead.createdAt).getTime()) / 86400000);
      if (daysSinceContact > 14) { score -= 10; reasons.push('stale — needs attention'); }
      else if (daysSinceContact > 7) { score -= 5; reasons.push('cooling off'); }
      else if (daysSinceContact <= 2) { score += 5; reasons.push('recently active'); }

      // Visit bonus (0-10)
      const successfulVisits = lead.visits.filter(v => v.outcome === 'SUCCESSFUL').length;
      score += Math.min(successfulVisits * 5, 10);
      if (successfulVisits > 0) reasons.push(`${successfulVisits} successful visit(s)`);

      // Industry bonus — if industry historically converts well we'll add points
      // (simplified: solar-adjacent industries get a bonus)
      if (lead.industry && ['Manufactura', 'Agroindustria', 'Comercio', 'Industrial'].some(i =>
        (lead.industry || '').toLowerCase().includes(i.toLowerCase())
      )) {
        score += 5;
        reasons.push('high-converting industry');
      }

      // Referral source bonus
      if (lead.source === 'REFERRAL') { score += 5; reasons.push('referral lead'); }
      if (lead.source === 'TRADE_SHOW') { score += 3; }

      // Determine urgency
      let urgency: 'critical' | 'high' | 'medium' | 'low' = 'low';
      if (score >= 50 || (LATE_STAGES.includes(lead.status) && value >= 200000)) urgency = 'critical';
      else if (score >= 35) urgency = 'high';
      else if (score >= 20) urgency = 'medium';

      // Recommended action
      let recommendedAction = 'Enviar WhatsApp de seguimiento';
      if (lead.status === 'PENDIENTE_PAGO') recommendedAction = 'Confirmar deposito y coordinar instalacion';
      else if (lead.status === 'ESPERANDO_CONTRATO') recommendedAction = 'Enviar contrato y agendar firma';
      else if (lead.status === 'COTIZACION_ENTREGADA') recommendedAction = 'Llamar para resolver dudas de cotizacion';
      else if (lead.status === 'ESPERANDO_COTIZACION') recommendedAction = 'Elaborar y enviar cotizacion personalizada';
      else if (lead.status === 'AGENDAR_CITA') recommendedAction = 'Agendar visita tecnica esta semana';
      else if (lead.status === 'EN_PROSPECCION') recommendedAction = 'Calificar necesidades y presentar propuesta';
      else if (daysSinceContact > 7) recommendedAction = 'Recontactar urgente — se esta enfriando';
      else if (lead.status === 'PENDIENTE_CONTACTAR') recommendedAction = 'Primer contacto — llamar o WhatsApp';

      return {
        leadId: lead.id,
        companyName: lead.companyName,
        contactName: lead.contactName,
        zone: lead.zone as string,
        status: lead.status as string,
        industry: lead.industry,
        estimatedValue: value,
        score,
        reason: reasons.join(', '),
        recommendedAction,
        urgency,
      };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // ─────────────────────────────────────────────────────────
  // 2. ZONE PRIORITIES — Which zones to prioritize
  // ─────────────────────────────────────────────────────────

  async getZonePriorities(): Promise<ZonePriority[]> {
    const [allLeads, wonLeads, lostLeads] = await Promise.all([
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false, status: { notIn: ['LEAD_BASURA' as any] } },
        select: {
          zone: true, status: true, estimatedValue: true, industry: true,
          lastContactedAt: true, createdAt: true, convertedAt: true,
        },
      }),
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false, status: WON },
        select: { zone: true, estimatedValue: true, createdAt: true, convertedAt: true },
      }),
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false, status: LOST },
        select: { zone: true, estimatedValue: true },
      }),
    ]);

    const now = Date.now();

    return ZONES.map(zone => {
      const zoneLeads = allLeads.filter(l => l.zone === zone);
      const pipeline = zoneLeads.filter(l => PIPELINE_STATUSES.includes(l.status));
      const won = wonLeads.filter(l => l.zone === zone);
      const lost = lostLeads.filter(l => l.zone === zone);
      const hot = zoneLeads.filter(l => LATE_STAGES.includes(l.status));

      const pipelineValue = pipeline.reduce((s, l) => s + (l.estimatedValue || 0), 0);
      const wonValue = won.reduce((s, l) => s + (l.estimatedValue || 0), 0);
      const totalDecided = won.length + lost.length;
      const conversionRate = totalDecided > 0 ? Math.round((won.length / totalDecided) * 100) : 0;

      // Average ticket
      const allWithValue = zoneLeads.filter(l => l.estimatedValue && l.estimatedValue > 0);
      const avgTicket = allWithValue.length > 0
        ? Math.round(allWithValue.reduce((s, l) => s + (l.estimatedValue || 0), 0) / allWithValue.length)
        : 0;

      // Avg days to close for won
      const daysToClose = won
        .filter(w => w.convertedAt)
        .map(w => Math.floor((new Date(w.convertedAt!).getTime() - new Date(w.createdAt).getTime()) / 86400000));
      const avgDaysToClose = daysToClose.length > 0
        ? Math.round(daysToClose.reduce((a, b) => a + b, 0) / daysToClose.length)
        : 0;

      // Low attention — pipeline leads not contacted in 14+ days
      const lowAttention = pipeline.filter(l => {
        const lastDate = l.lastContactedAt || l.createdAt;
        return (now - new Date(lastDate).getTime()) > 14 * 86400000;
      }).length;

      // Top industry
      const industryCounts: Record<string, number> = {};
      zoneLeads.forEach(l => {
        if (l.industry) industryCounts[l.industry] = (industryCounts[l.industry] || 0) + 1;
      });
      const topIndustry = Object.entries(industryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

      // Priority score
      let priorityScore = 0;
      priorityScore += Math.min(pipelineValue / 100000, 30); // Value weight
      priorityScore += conversionRate * 0.2; // Conversion weight
      priorityScore += hot.length * 3; // Hot leads weight
      priorityScore += Math.min(pipeline.length * 1.5, 15); // Volume weight
      priorityScore -= lowAttention * 2; // Penalty for neglected leads
      if (avgDaysToClose > 0 && avgDaysToClose < 45) priorityScore += 5; // Fast-closing zone bonus

      // Recommendation
      const rec: string[] = [];
      const actions: string[] = [];

      if (hot.length > 0) {
        rec.push(`${hot.length} deals near closing — prioritize closure.`);
        actions.push(`Cerrar ${hot.length} oportunidades avanzadas`);
      }
      if (conversionRate >= 30) {
        rec.push('High conversion — scale prospecting.');
        actions.push('Aumentar prospeccion en esta zona');
      } else if (conversionRate < 15 && totalDecided >= 5) {
        rec.push('Low conversion — review qualifying criteria.');
        actions.push('Revisar criterios de calificacion');
      }
      if (lowAttention > 0) {
        rec.push(`${lowAttention} leads without recent contact.`);
        actions.push(`Recontactar ${lowAttention} prospectos desatendidos`);
      }
      if (pipelineValue > 1000000) {
        actions.push('Asignar asesor senior a zona');
      }
      if (pipeline.length === 0 && won.length > 0) {
        rec.push('Pipeline empty but has past wins — restart prospecting.');
        actions.push('Reactivar prospeccion en zona con historial positivo');
      }

      return {
        zone,
        label: ZONE_LABELS[zone] || zone,
        priorityScore: Math.round(priorityScore),
        totalLeads: zoneLeads.length,
        pipelineLeads: pipeline.length,
        pipelineValue,
        wonLeads: won.length,
        wonValue,
        lostLeads: lost.length,
        conversionRate,
        avgTicket,
        avgDaysToClose,
        hotLeads: hot.length,
        lowAttention,
        topIndustry,
        recommendation: rec.join(' ') || 'Mantener ritmo actual de operacion.',
        actions: actions.length > 0 ? actions : ['Mantener seguimiento regular'],
      };
    }).sort((a, b) => b.priorityScore - a.priorityScore);
  }

  // ─────────────────────────────────────────────────────────
  // 3. TICKET ANALYSIS — Which ranges to focus on
  // ─────────────────────────────────────────────────────────

  async getTicketAnalysis(): Promise<TicketAnalysis[]> {
    const leads = await this.prisma.lead.findMany({
      where: { deletedAt: null, isHistorical: false, status: { notIn: ['LEAD_BASURA' as any] } },
      select: {
        status: true, estimatedValue: true, createdAt: true, convertedAt: true,
      },
    });

    return TICKET_RANGES.map(range => {
      const inRange = leads.filter(l => {
        const v = l.estimatedValue || 0;
        return v >= range.min && v < range.max;
      });
      const pipeline = inRange.filter(l => PIPELINE_STATUSES.includes(l.status));
      const won = inRange.filter(l => l.status === WON);
      const lost = inRange.filter(l => l.status === LOST);
      const totalDecided = won.length + lost.length;
      const conversionRate = totalDecided > 0 ? Math.round((won.length / totalDecided) * 100) : 0;

      const pipelineValue = pipeline.reduce((s, l) => s + (l.estimatedValue || 0), 0);
      const wonValue = won.reduce((s, l) => s + (l.estimatedValue || 0), 0);

      // Avg days to close
      const daysArr = won.filter(w => w.convertedAt).map(w =>
        Math.floor((new Date(w.convertedAt!).getTime() - new Date(w.createdAt).getTime()) / 86400000),
      );
      const avgDaysToClose = daysArr.length > 0
        ? Math.round(daysArr.reduce((a, b) => a + b, 0) / daysArr.length) : 0;

      // ROI proxy: wonValue / number of total leads worked (effort)
      const roi = inRange.length > 0 ? Math.round(wonValue / inRange.length) : 0;

      // Determine priority
      let priority: 'focus' | 'scale' | 'maintain' | 'deprioritize' = 'maintain';
      let recommendation = 'Mantener esfuerzo actual.';

      if (conversionRate >= 25 && wonValue > 0) {
        if (roi > 50000) {
          priority = 'scale';
          recommendation = `Alta conversion (${conversionRate}%) y buen ROI. Escalar prospeccion en este rango.`;
        } else {
          priority = 'focus';
          recommendation = `Buena conversion pero bajo ROI por ticket. Enfocarse en volumen.`;
        }
      } else if (conversionRate >= 15) {
        priority = 'maintain';
        recommendation = `Conversion aceptable (${conversionRate}%). Mantener y optimizar calificacion.`;
      } else if (totalDecided >= 3 && conversionRate < 15) {
        priority = 'deprioritize';
        recommendation = `Baja conversion (${conversionRate}%). Revisar calificacion o deprioritizar.`;
      } else if (pipelineValue > 500000 && pipeline.length > 0) {
        priority = 'focus';
        recommendation = `Pipeline significativo sin suficientes cierres. Enfocarse en mover a cierre.`;
      }

      return {
        range: range.key,
        label: range.label,
        totalLeads: inRange.length,
        pipelineLeads: pipeline.length,
        pipelineValue,
        wonLeads: won.length,
        wonValue,
        lostLeads: lost.length,
        conversionRate,
        avgDaysToClose,
        roi,
        recommendation,
        priority,
      };
    });
  }

  // ─────────────────────────────────────────────────────────
  // 4. INDUSTRY CONVERSIONS — Which industries convert better
  // ─────────────────────────────────────────────────────────

  async getIndustryConversions(): Promise<IndustryConversion[]> {
    const leads = await this.prisma.lead.findMany({
      where: { deletedAt: null, isHistorical: false, status: { notIn: ['LEAD_BASURA' as any] }, industry: { not: null } },
      select: {
        zone: true, status: true, estimatedValue: true, industry: true,
        createdAt: true, convertedAt: true,
      },
    });

    // Group by industry
    const byIndustry: Record<string, typeof leads> = {};
    leads.forEach(l => {
      const ind = l.industry || 'Sin industria';
      if (!byIndustry[ind]) byIndustry[ind] = [];
      byIndustry[ind].push(l);
    });

    return Object.entries(byIndustry).map(([industry, group]) => {
      const pipeline = group.filter(l => PIPELINE_STATUSES.includes(l.status));
      const won = group.filter(l => l.status === WON);
      const lost = group.filter(l => l.status === LOST);
      const totalDecided = won.length + lost.length;
      const conversionRate = totalDecided > 0 ? Math.round((won.length / totalDecided) * 100) : 0;

      const pipelineValue = pipeline.reduce((s, l) => s + (l.estimatedValue || 0), 0);
      const wonValue = won.reduce((s, l) => s + (l.estimatedValue || 0), 0);

      const withValue = group.filter(l => l.estimatedValue && l.estimatedValue > 0);
      const avgTicket = withValue.length > 0
        ? Math.round(withValue.reduce((s, l) => s + (l.estimatedValue || 0), 0) / withValue.length)
        : 0;

      const daysArr = won.filter(w => w.convertedAt).map(w =>
        Math.floor((new Date(w.convertedAt!).getTime() - new Date(w.createdAt).getTime()) / 86400000),
      );
      const avgDaysToClose = daysArr.length > 0
        ? Math.round(daysArr.reduce((a, b) => a + b, 0) / daysArr.length) : 0;

      // Top zone
      const zoneCounts: Record<string, number> = {};
      group.forEach(l => { zoneCounts[l.zone as string] = (zoneCounts[l.zone as string] || 0) + 1; });
      const topZone = Object.entries(zoneCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

      // Rating
      let rating: 'star' | 'strong' | 'average' | 'weak' | 'insufficient_data' = 'insufficient_data';
      let recommendation = 'Datos insuficientes para evaluar — seguir recopilando.';

      if (totalDecided >= 3) {
        if (conversionRate >= 40) {
          rating = 'star';
          recommendation = `Industria estrella (${conversionRate}% conversion). Escalar prospeccion agresivamente.`;
        } else if (conversionRate >= 25) {
          rating = 'strong';
          recommendation = `Buen desempeno (${conversionRate}%). Aumentar esfuerzo y replicar tacticas exitosas.`;
        } else if (conversionRate >= 15) {
          rating = 'average';
          recommendation = `Conversion promedio. Mejorar calificacion y propuesta de valor.`;
        } else {
          rating = 'weak';
          recommendation = `Baja conversion (${conversionRate}%). Evaluar si el producto encaja con esta industria.`;
        }
      } else if (pipeline.length > 0) {
        recommendation = `${pipeline.length} en pipeline — monitorear conversion para evaluar potencial.`;
      }

      return {
        industry,
        totalLeads: group.length,
        pipelineLeads: pipeline.length,
        pipelineValue,
        wonLeads: won.length,
        wonValue,
        lostLeads: lost.length,
        conversionRate,
        avgTicket,
        avgDaysToClose,
        topZone,
        recommendation,
        rating,
      };
    }).sort((a, b) => {
      // Sort: star > strong > average > weak > insufficient, then by conversion
      const ratingOrder = { star: 4, strong: 3, average: 2, weak: 1, insufficient_data: 0 };
      if (ratingOrder[a.rating] !== ratingOrder[b.rating]) return ratingOrder[b.rating] - ratingOrder[a.rating];
      return b.conversionRate - a.conversionRate;
    });
  }

  // ─────────────────────────────────────────────────────────
  // 5. CAMPAIGN RECOMMENDATIONS — Scale, pause, or adjust
  // ─────────────────────────────────────────────────────────

  async getCampaignRecommendations(): Promise<CampaignRecommendation[]> {
    const leads = await this.prisma.lead.findMany({
      where: { deletedAt: null, isHistorical: false, status: { notIn: ['LEAD_BASURA' as any] } },
      select: { source: true, status: true, estimatedValue: true },
    });

    const SOURCE_LABELS: Record<string, string> = {
      MANUAL: 'Captura Manual', REFERRAL: 'Referidos', WEBSITE: 'Sitio Web',
      COLD_CALL: 'Llamada en Frio', TRADE_SHOW: 'Expos/Ferias', ZOHO_CRM: 'Zoho CRM', OTHER: 'Otros',
    };

    const bySource: Record<string, typeof leads> = {};
    leads.forEach(l => {
      const src = l.source as string;
      if (!bySource[src]) bySource[src] = [];
      bySource[src].push(l);
    });

    return Object.entries(bySource).map(([source, group]) => {
      const pipeline = group.filter(l => PIPELINE_STATUSES.includes(l.status));
      const won = group.filter(l => l.status === WON);
      const totalDecided = won.length + group.filter(l => l.status === LOST).length;
      const conversionRate = totalDecided > 0 ? Math.round((won.length / totalDecided) * 100) : 0;
      const totalValue = group.reduce((s, l) => s + (l.estimatedValue || 0), 0);
      const wonValue = won.reduce((s, l) => s + (l.estimatedValue || 0), 0);
      const avgTicket = group.length > 0 ? Math.round(totalValue / group.length) : 0;

      // Efficiency
      let costEfficiency: 'excellent' | 'good' | 'average' | 'poor' = 'average';
      let action: 'scale' | 'maintain' | 'adjust' | 'pause' = 'maintain';
      let reasoning = '';
      const suggestions: string[] = [];

      if (conversionRate >= 30 && won.length >= 2) {
        costEfficiency = 'excellent';
        action = 'scale';
        reasoning = `Alta conversion (${conversionRate}%) con ${won.length} cierres. Fuente muy rentable.`;
        suggestions.push('Aumentar inversion en este canal', 'Replicar tacticas exitosas en otros canales');
      } else if (conversionRate >= 15) {
        costEfficiency = 'good';
        action = 'maintain';
        reasoning = `Conversion aceptable. Canal estable.`;
        suggestions.push('Optimizar calificacion de leads entrantes', 'Mejorar follow-up speed');
      } else if (totalDecided >= 5 && conversionRate < 10) {
        costEfficiency = 'poor';
        action = 'pause';
        reasoning = `Baja conversion (${conversionRate}%) con suficientes datos. Revisar calidad de leads.`;
        suggestions.push('Auditar calidad de leads de este canal', 'Considerar pausar hasta mejorar targeting');
      } else if (group.length > 0 && totalDecided < 3) {
        action = 'adjust';
        reasoning = `Pocos resultados finales. Acelerar pipeline para evaluar mejor.`;
        suggestions.push('Acelerar seguimiento de leads de este canal', 'No incrementar inversion hasta tener mas datos');
      } else {
        costEfficiency = 'average';
        action = 'adjust';
        reasoning = `Resultados mixtos. Mejorar proceso.`;
        suggestions.push('Refinar targeting', 'Mejorar propuesta de valor inicial');
      }

      return {
        source: SOURCE_LABELS[source] || source,
        totalLeads: group.length,
        pipelineLeads: pipeline.length,
        wonLeads: won.length,
        conversionRate,
        avgTicket,
        totalValue,
        costEfficiency,
        action,
        reasoning,
        suggestions,
      };
    }).sort((a, b) => b.conversionRate - a.conversionRate);
  }

  // ─────────────────────────────────────────────────────────
  // 6. SEGMENT MESSAGING — What content by segment
  // ─────────────────────────────────────────────────────────

  async getSegmentMessaging(): Promise<SegmentMessaging[]> {
    const leads = await this.prisma.lead.findMany({
      where: { deletedAt: null, isHistorical: false, status: { in: PIPELINE_STATUSES } },
      select: {
        zone: true, status: true, estimatedValue: true, industry: true, source: true,
      },
    });

    const segments: SegmentMessaging[] = [];

    // Segment 1: High-value enterprise
    const enterprise = leads.filter(l => (l.estimatedValue || 0) >= 500000);
    if (enterprise.length > 0) {
      segments.push({
        segment: 'Enterprise (>$500K)',
        description: 'Prospectos de alto valor. Decision compleja, multiples stakeholders.',
        leadCount: enterprise.length,
        avgValue: Math.round(enterprise.reduce((s, l) => s + (l.estimatedValue || 0), 0) / enterprise.length),
        recommendedTone: 'consultative',
        recommendedChannels: ['email', 'call_script', 'whatsapp'],
        keyMessages: [
          'ROI detallado y caso de negocio personalizado',
          'Casos de exito en empresas similares',
          'Opciones de financiamiento a escala',
          'Visita tecnica sin compromiso con ingenieros senior',
        ],
        contentAngles: [
          'Ahorro energetico como ventaja competitiva',
          'Reduccion de huella de carbono para ESG/sustentabilidad',
          'Independencia energetica y proteccion contra aumentos',
        ],
        avoidMessages: [
          'Mensajes genericos o de volumen',
          'Presion de urgencia — usan decisiones racionales',
          'Comparaciones de precio sin contexto de valor',
        ],
      });
    }

    // Segment 2: Medium value
    const medium = leads.filter(l => {
      const v = l.estimatedValue || 0;
      return v >= 100000 && v < 500000;
    });
    if (medium.length > 0) {
      segments.push({
        segment: 'Mediano ($100K-$500K)',
        description: 'PyMEs con consumo significativo. Decision de 1-2 personas.',
        leadCount: medium.length,
        avgValue: Math.round(medium.reduce((s, l) => s + (l.estimatedValue || 0), 0) / medium.length),
        recommendedTone: 'professional',
        recommendedChannels: ['whatsapp', 'call_script', 'email'],
        keyMessages: [
          'Ahorro mensual concreto en pesos',
          'Retorno de inversion en 3-4 anos',
          'Financiamiento accesible ($0 enganche)',
          'Testimonios de empresas similares en la zona',
        ],
        contentAngles: [
          'Ahorro inmediato en recibos de luz',
          'Inversion inteligente vs gasto mensual',
          'Facilidad de implementacion con minima disrupcion',
        ],
        avoidMessages: [
          'Demasiada informacion tecnica al inicio',
          'Hablar de sustentabilidad sin hablar de dinero',
        ],
      });
    }

    // Segment 3: Small value / residential
    const small = leads.filter(l => (l.estimatedValue || 0) > 0 && (l.estimatedValue || 0) < 100000);
    if (small.length > 0) {
      segments.push({
        segment: 'Chico (<$100K)',
        description: 'Negocios pequenos o residencial alto. Decision rapida.',
        leadCount: small.length,
        avgValue: Math.round(small.reduce((s, l) => s + (l.estimatedValue || 0), 0) / small.length),
        recommendedTone: 'warm',
        recommendedChannels: ['whatsapp', 'sms'],
        keyMessages: [
          'Ahorro visible en primer recibo',
          'Instalacion rapida (1-2 dias)',
          'Garantia de 25 anos en paneles',
          'Opciones desde $0 de enganche',
        ],
        contentAngles: [
          'Dejar de pagar a CFE',
          'Inversion que se paga sola',
          'Vecinos y conocidos que ya ahorraron',
        ],
        avoidMessages: [
          'Propuestas formales extensas',
          'Jerga tecnica (kWh, kWp, etc.)',
        ],
      });
    }

    // Segment 4: By zone — high-potential zones
    for (const zone of ZONES) {
      const zoneLeads = leads.filter(l => l.zone === zone);
      if (zoneLeads.length < 3) continue;

      const avgVal = Math.round(zoneLeads.reduce((s, l) => s + (l.estimatedValue || 0), 0) / zoneLeads.length);
      const topIndustries: Record<string, number> = {};
      zoneLeads.forEach(l => { if (l.industry) topIndustries[l.industry] = (topIndustries[l.industry] || 0) + 1; });
      const topInd = Object.entries(topIndustries).sort((a, b) => b[1] - a[1])[0]?.[0];

      segments.push({
        segment: `Zona ${ZONE_LABELS[zone]}`,
        description: `Prospectos en ${ZONE_LABELS[zone]}${topInd ? ` — industria principal: ${topInd}` : ''}.`,
        leadCount: zoneLeads.length,
        avgValue: avgVal,
        recommendedTone: avgVal > 300000 ? 'consultative' : 'professional',
        recommendedChannels: ['whatsapp', 'call_script'],
        keyMessages: [
          `Experiencia local en ${ZONE_LABELS[zone]} con clientes existentes`,
          'Visita tecnica sin costo — estamos en la zona',
          topInd ? `Soluciones especializadas para ${topInd}` : 'Soluciones para su industria',
          'Equipo tecnico local para servicio y mantenimiento',
        ],
        contentAngles: [
          `Casos de exito locales en ${ZONE_LABELS[zone]}`,
          'Proximidad = servicio mas rapido',
          'Conocimiento del mercado local',
        ],
        avoidMessages: [
          'Mensajes que no reflejen presencia local',
          'Asumir condiciones climaticas/regulatorias de otras zonas',
        ],
      });
    }

    // Segment 5: Referral leads
    const referrals = leads.filter(l => l.source === 'REFERRAL');
    if (referrals.length > 0) {
      segments.push({
        segment: 'Referidos',
        description: 'Leads por recomendacion. Alta confianza inicial.',
        leadCount: referrals.length,
        avgValue: Math.round(referrals.reduce((s, l) => s + (l.estimatedValue || 0), 0) / referrals.length),
        recommendedTone: 'warm',
        recommendedChannels: ['whatsapp', 'call_script'],
        keyMessages: [
          'Mencionar al referente por nombre',
          '[Referente] quedo muy contento y nos recomendo',
          'Le ofrecemos las mismas condiciones especiales',
          'Agendar visita esta semana — prioridad por recomendacion',
        ],
        contentAngles: [
          'Confianza heredada del referente',
          'Atencion VIP por venir recomendado',
          'Rapidez en respuesta',
        ],
        avoidMessages: [
          'Mensajes genericos que no mencionen la referencia',
          'Tratar como lead frio',
        ],
      });
    }

    return segments;
  }

  // ─────────────────────────────────────────────────────────
  // 7. CENTER PLANS — Per-zone comprehensive plan
  // ─────────────────────────────────────────────────────────

  async getCenterPlans(): Promise<CenterPlan[]> {
    const [zonePriorities, ticketAnalysis, industryConversions, campaigns] = await Promise.all([
      this.getZonePriorities(),
      this.getTicketAnalysis(),
      this.getIndustryConversions(),
      this.getCampaignRecommendations(),
    ]);

    // Get leads for top opportunities per zone
    const leads = await this.prisma.lead.findMany({
      where: { deletedAt: null, isHistorical: false, status: { in: PIPELINE_STATUSES } },
      select: {
        id: true, companyName: true, zone: true, estimatedValue: true, status: true,
        industry: true, lastContactedAt: true, createdAt: true,
      },
      orderBy: { estimatedValue: 'desc' },
    });

    // Get per-zone industry data
    const allLeads = await this.prisma.lead.findMany({
      where: { deletedAt: null, isHistorical: false, status: { notIn: ['LEAD_BASURA' as any] }, industry: { not: null } },
      select: { zone: true, industry: true, status: true, estimatedValue: true, source: true },
    });

    const now = Date.now();

    return zonePriorities.map(zp => {
      const zoneLeads = leads.filter(l => l.zone === zp.zone);
      const zoneAllLeads = allLeads.filter(l => l.zone === zp.zone);

      // Priority industry for this zone
      const indConversion: Record<string, { won: number; total: number; value: number }> = {};
      zoneAllLeads.forEach(l => {
        const ind = l.industry || 'Otro';
        if (!indConversion[ind]) indConversion[ind] = { won: 0, total: 0, value: 0 };
        indConversion[ind].total++;
        indConversion[ind].value += l.estimatedValue || 0;
        if (l.status === WON) indConversion[ind].won++;
      });

      const bestIndustry = Object.entries(indConversion)
        .filter(([, v]) => v.total >= 2)
        .sort((a, b) => {
          // Sort by conversion rate then value
          const aRate = a[1].total > 0 ? a[1].won / a[1].total : 0;
          const bRate = b[1].total > 0 ? b[1].won / b[1].total : 0;
          if (bRate !== aRate) return bRate - aRate;
          return b[1].value - a[1].value;
        })[0];

      const priorityIndustry = bestIndustry
        ? { industry: bestIndustry[0], reason: `${bestIndustry[1].won}/${bestIndustry[1].total} conversion, $${Math.round(bestIndustry[1].value).toLocaleString()} valor total` }
        : null;

      // Best ticket range for zone
      const rangePerf: Record<string, { won: number; total: number }> = {};
      zoneAllLeads.forEach(l => {
        const v = l.estimatedValue || 0;
        const range = TICKET_RANGES.find(r => v >= r.min && v < r.max);
        if (range) {
          if (!rangePerf[range.key]) rangePerf[range.key] = { won: 0, total: 0 };
          rangePerf[range.key].total++;
          if (l.status === WON) rangePerf[range.key].won++;
        }
      });

      const bestRange = Object.entries(rangePerf)
        .sort((a, b) => {
          const aRate = a[1].total > 0 ? a[1].won / a[1].total : 0;
          const bRate = b[1].total > 0 ? b[1].won / b[1].total : 0;
          return bRate - aRate;
        })[0];

      const ticketRange = TICKET_RANGES.find(r => r.key === bestRange?.[0]);
      const priorityTicketRange = {
        range: ticketRange?.label || 'Sin datos',
        reason: bestRange
          ? `${bestRange[1].won}/${bestRange[1].total} conversion en este rango`
          : 'Sin datos de conversion por rango',
      };

      // Best campaigns for zone
      const sourceCounts: Record<string, { won: number; total: number }> = {};
      zoneAllLeads.forEach(l => {
        const src = l.source as string;
        if (!sourceCounts[src]) sourceCounts[src] = { won: 0, total: 0 };
        sourceCounts[src].total++;
        if (l.status === WON) sourceCounts[src].won++;
      });

      const SOURCE_LABELS: Record<string, string> = {
        MANUAL: 'Captura Manual', REFERRAL: 'Referidos', WEBSITE: 'Sitio Web',
        COLD_CALL: 'Llamada en Frio', TRADE_SHOW: 'Expos/Ferias', ZOHO_CRM: 'Zoho CRM', OTHER: 'Otros',
      };

      const recommendedCampaigns = Object.entries(sourceCounts)
        .filter(([, v]) => v.total >= 1)
        .sort((a, b) => {
          const aRate = a[1].total > 0 ? a[1].won / a[1].total : 0;
          const bRate = b[1].total > 0 ? b[1].won / b[1].total : 0;
          return bRate - aRate;
        })
        .slice(0, 3)
        .map(([src, v]) => ({
          source: SOURCE_LABELS[src] || src,
          reason: `${v.won}/${v.total} conversion`,
        }));

      // Content angle
      const avgVal = zp.avgTicket;
      let suggestedContentAngle = 'Ahorro energetico y retorno de inversion';
      if (avgVal >= 500000) suggestedContentAngle = 'ROI empresarial, sustentabilidad corporativa y reduccion de costos operativos';
      else if (avgVal >= 150000) suggestedContentAngle = 'Ahorro mensual inmediato, financiamiento accesible y casos de exito locales';
      else if (avgVal > 0) suggestedContentAngle = 'Ahorro en recibos de luz, instalacion rapida y facilidades de pago';

      // Advisor focus
      let advisorFocus = 'Seguimiento regular y calificacion de pipeline';
      if (zp.hotLeads > 0) advisorFocus = `Prioridad: cerrar ${zp.hotLeads} oportunidades avanzadas`;
      else if (zp.lowAttention > 0) advisorFocus = `Urgente: recontactar ${zp.lowAttention} prospectos desatendidos`;
      else if (zp.pipelineLeads === 0) advisorFocus = 'Prospeccion activa — pipeline vacio';

      // Top opportunities
      const topOpps = zoneLeads.slice(0, 5).map(l => {
        const daysSince = l.lastContactedAt
          ? Math.floor((now - new Date(l.lastContactedAt).getTime()) / 86400000)
          : Math.floor((now - new Date(l.createdAt).getTime()) / 86400000);
        let reason = STATUS_LABELS[l.status as string] || l.status as string;
        if (daysSince > 7) reason += ` — ${daysSince}d sin contacto`;
        return {
          leadId: l.id,
          company: l.companyName,
          value: l.estimatedValue || 0,
          reason,
        };
      });

      // Risks
      const risks: string[] = [];
      if (zp.lowAttention > 2) risks.push(`${zp.lowAttention} prospectos sin atencion — riesgo de perdida`);
      if (zp.conversionRate < 15 && zp.lostLeads > 3) risks.push(`Baja conversion (${zp.conversionRate}%) — revisar propuesta`);
      if (zp.pipelineLeads === 0 && zp.wonLeads > 0) risks.push('Pipeline vacio en zona con historial positivo');
      if (zp.hotLeads > 0 && zp.lowAttention > 0) risks.push('Oportunidades calientes combinadas con leads frios — riesgo de prioridades');

      return {
        zone: zp.zone,
        label: zp.label,
        commercialPriorityScore: zp.priorityScore,
        priorityIndustry,
        priorityTicketRange,
        recommendedCampaigns,
        suggestedContentAngle,
        advisorFocus,
        topOpportunities: topOpps,
        actions: zp.actions,
        risks,
      };
    });
  }

  // ─────────────────────────────────────────────────────────
  // 8. FULL PLAN — Everything combined
  // ─────────────────────────────────────────────────────────

  async getFullPlan(): Promise<CommercialPlan> {
    const [
      targetPriorities,
      zonePriorities,
      ticketAnalysis,
      industryConversions,
      campaignRecommendations,
      segmentMessaging,
      centerPlans,
    ] = await Promise.all([
      this.getTargetPriorities(),
      this.getZonePriorities(),
      this.getTicketAnalysis(),
      this.getIndustryConversions(),
      this.getCampaignRecommendations(),
      this.getSegmentMessaging(),
      this.getCenterPlans(),
    ]);

    // Generate executive summary
    const topZone = zonePriorities[0];
    const topIndustry = industryConversions.find(i => i.rating === 'star') || industryConversions[0];
    const topCampaign = campaignRecommendations.find(c => c.action === 'scale');
    const criticalTargets = targetPriorities.filter(t => t.urgency === 'critical');
    const focusTicket = ticketAnalysis.find(t => t.priority === 'scale' || t.priority === 'focus');

    const summaryParts: string[] = [];
    if (topZone) summaryParts.push(`Zona prioritaria: ${topZone.label} (score ${topZone.priorityScore}, $${Math.round(topZone.pipelineValue).toLocaleString()} en pipeline).`);
    if (topIndustry && topIndustry.rating !== 'insufficient_data') summaryParts.push(`Industria estrella: ${topIndustry.industry} (${topIndustry.conversionRate}% conversion).`);
    if (focusTicket) summaryParts.push(`Rango de ticket a ${focusTicket.priority === 'scale' ? 'escalar' : 'enfocar'}: ${focusTicket.label}.`);
    if (topCampaign) summaryParts.push(`Campana a escalar: ${topCampaign.source} (${topCampaign.conversionRate}% conversion).`);
    if (criticalTargets.length > 0) summaryParts.push(`${criticalTargets.length} prospectos requieren accion critica inmediata.`);

    return {
      generatedAt: new Date().toISOString(),
      summary: summaryParts.join(' ') || 'Datos insuficientes para generar resumen. Agregue mas prospectos al sistema.',
      targetPriorities,
      zonePriorities,
      ticketAnalysis,
      industryConversions,
      campaignRecommendations,
      segmentMessaging,
      centerPlans,
    };
  }
}
