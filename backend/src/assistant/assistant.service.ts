import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// ── Response interfaces ────────────────────────────────────────

interface ChatResponseData {
  type: 'table' | 'metrics' | 'list' | 'funnel' | 'plan';
  title?: string;
  headers?: string[];
  rows?: (string | number)[][];
  metrics?: { label: string; value: string; color?: string }[];
  items?: string[];
  steps?: { time: string; action: string; target: string; reason: string }[];
}

export interface ChatResponse {
  agent: string;
  message: string;
  data?: ChatResponseData;
  insights?: string[];
  actions?: { label: string; type: string }[];
  suggestions?: string[];
}

interface DetectedIntent {
  intent: string;
  entities: Entities;
}

interface Entities {
  zone?: string;
  advisor?: { id: string; name: string };
  industry?: string;
  dateRange?: { from: Date; to: Date };
  amount?: { min?: number; max?: number };
  stage?: string;
  period?: 'daily' | 'weekly' | 'monthly';
}

// ── Constants ──────────────────────────────────────────────────

const ACTIVE_STAGES = [
  'PENDIENTE_CONTACTAR',
  'INTENTANDO_CONTACTAR',
  'EN_PROSPECCION',
  'AGENDAR_CITA',
  'ESPERANDO_COTIZACION',
  'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO',
  'PENDIENTE_PAGO',
];

const DEAL_STAGES = [
  'ESPERANDO_COTIZACION',
  'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO',
  'PENDIENTE_PAGO',
  'CERRADO_GANADO',
  'CERRADO_PERDIDO',
];

const CLOSING_STAGES = [
  'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO',
  'PENDIENTE_PAGO',
];

const ADVISORS = [
  { patterns: ['juan pablo', 'pimentel'], id: 'c14e6db8-81ea-4094-8c6c-42750fab3f8a', name: 'Juan Pablo' },
  { patterns: ['jaime', 'navarrete'], id: '11753574-4454-4728-8155-843de3e55d27', name: 'Jaime' },
  { patterns: ['brenda', 'lopez'], id: '9eee0d3f-0656-4975-b767-7bf9bdc06aea', name: 'Brenda' },
  { patterns: ['jenifer', 'hernandez'], id: 'c86985d1-2775-475d-ac1c-31f603271d90', name: 'Jenifer' },
  { patterns: ['mariana', 'zarate'], id: 'a1b25b0f-b900-4fdf-8a71-8ef1825197f1', name: 'Mariana' },
];

const ZONE_MAP: Record<string, string> = {
  bajio: 'BAJIO',
  occidente: 'OCCIDENTE',
  centro: 'CENTRO',
  norte: 'NORTE',
  guadalajara: 'OCCIDENTE',
  jalisco: 'OCCIDENTE',
  monterrey: 'NORTE',
  cdmx: 'CENTRO',
  queretaro: 'BAJIO',
};

const STAGE_MAP: Record<string, string> = {
  cotizacion: 'ESPERANDO_COTIZACION',
  contrato: 'ESPERANDO_CONTRATO',
  pago: 'PENDIENTE_PAGO',
  ganado: 'CERRADO_GANADO',
  perdido: 'CERRADO_PERDIDO',
  prospeccion: 'EN_PROSPECCION',
};

const INDUSTRY_KEYWORDS = [
  'industrial', 'comercial', 'gobierno', 'salud', 'educacion',
  'alimentos', 'tecnologia', 'construccion', 'manufactura',
  'logistica', 'transporte', 'retail', 'farmaceutica', 'automotriz',
];

// ── Money formatter ────────────────────────────────────────────

const fmt = (n: number): string =>
  n >= 1e6
    ? `$${(n / 1e6).toFixed(1)}M`
    : n >= 1e3
      ? `$${(n / 1e3).toFixed(0)}K`
      : `$${n}`;

// ── Service ────────────────────────────────────────────────────

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(private prisma: PrismaService) {}

  // ── Main entry ─────────────────────────────────────────────

  async chat(message: string, userId: string): Promise<ChatResponse> {
    this.logger.log(`Chat from user ${userId}: ${message}`);
    const { intent, entities } = this.detectIntent(message);
    this.logger.log(`Detected intent: ${intent}, entities: ${JSON.stringify(entities)}`);

    switch (intent) {
      case 'LEADS_QUERY':
        return this.handleLeadsQuery(entities);
      case 'DEALS_QUERY':
        return this.handleDealsQuery(entities);
      case 'CONVERSION_QUERY':
        return this.handleConversionQuery(entities);
      case 'PERFORMANCE_QUERY':
        return this.handlePerformanceQuery(entities);
      case 'STUCK_DEALS':
        return this.handleStuckDeals(entities);
      case 'PLAN_GENERATE':
        return this.handlePlanGenerate(entities);
      case 'OPPORTUNITY_FIND':
        return this.handleOpportunityFind(entities);
      case 'CONTACT_ATTEMPTS':
        return this.handleContactAttempts(entities);
      case 'LOSS_ANALYSIS':
        return this.handleLossAnalysis(entities);
      case 'ACTION_FOLLOWUP':
        return this.handleActionFollowup(entities);
      case 'ACTION_MESSAGE':
        return this.handleActionMessage(entities);
      case 'ACTION_SCRIPT':
        return this.handleActionScript(entities);
      case 'ACTION_CAMPAIGN':
        return this.handleActionCampaign(entities);
      case 'ACTION_ASSIGN':
        return this.handleActionAssign(entities);
      default:
        return this.handleGeneralInsight();
    }
  }

  // ── Intent detection ───────────────────────────────────────

  private detectIntent(message: string): DetectedIntent {
    const lower = message.toLowerCase();
    const entities = this.extractEntities(message);

    const intentMap: { intent: string; keywords: string[] }[] = [
      { intent: 'LEADS_QUERY', keywords: ['leads', 'prospectos', 'lead', 'prospecto'] },
      { intent: 'DEALS_QUERY', keywords: ['deals', 'tratos', 'deal', 'trato'] },
      { intent: 'CONVERSION_QUERY', keywords: ['conversion', 'convertidos', 'converted', 'funnel', 'embudo'] },
      { intent: 'PERFORMANCE_QUERY', keywords: ['performance', 'rendimiento', 'underperforming', 'bajo rendimiento', 'mejor', 'peor'] },
      { intent: 'STUCK_DEALS', keywords: ['stuck', 'atascados', 'estancados', 'sin movimiento', 'sin contacto'] },
      { intent: 'PLAN_GENERATE', keywords: ['plan', 'planear', 'planifica', 'agenda', 'semana', 'semanal', 'diario'] },
      { intent: 'OPPORTUNITY_FIND', keywords: ['oportunidad', 'opportunity', 'potencial', 'high value', 'alto valor'] },
      { intent: 'CONTACT_ATTEMPTS', keywords: ['intentos', 'attempts', 'contacto', 'llamadas por'] },
      { intent: 'LOSS_ANALYSIS', keywords: ['perdiendo', 'losing', 'perdidos', 'perdido', 'lost', 'por que perdemos'] },
      { intent: 'ACTION_FOLLOWUP', keywords: ['follow-up', 'seguimiento', 'recordatorio', 'reminder'] },
      { intent: 'ACTION_MESSAGE', keywords: ['mensaje', 'whatsapp', 'email', 'correo', 'message'] },
      { intent: 'ACTION_SCRIPT', keywords: ['script', 'guion', 'llamada'] },
      { intent: 'ACTION_CAMPAIGN', keywords: ['campana', 'campaign', 'reactivacion', 'reactivar'] },
      { intent: 'ACTION_ASSIGN', keywords: ['asignar', 'assign', 'repartir', 'distribuir'] },
    ];

    for (const { intent, keywords } of intentMap) {
      if (keywords.some((kw: string) => lower.includes(kw))) {
        return { intent, entities };
      }
    }

    return { intent: 'GENERAL_INSIGHT', entities };
  }

  // ── Entity extraction ──────────────────────────────────────

  private extractEntities(message: string): Entities {
    const lower = message.toLowerCase();
    const entities: Entities = {};

    // Zone
    for (const [keyword, zone] of Object.entries(ZONE_MAP)) {
      if (lower.includes(keyword)) {
        entities.zone = zone;
        break;
      }
    }

    // Advisor
    for (const adv of ADVISORS) {
      if (adv.patterns.some((p: string) => lower.includes(p))) {
        entities.advisor = { id: adv.id, name: adv.name };
        break;
      }
    }

    // Industry
    for (const ind of INDUSTRY_KEYWORDS) {
      if (lower.includes(ind)) {
        entities.industry = ind;
        break;
      }
    }

    // Date range
    const now = new Date();
    if (lower.includes('hoy') || lower.includes('today')) {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      entities.dateRange = { from: start, to: now };
    } else if (lower.includes('esta semana') || lower.includes('this week')) {
      const day = now.getDay(); // 0=Sunday
      const start = new Date(now);
      start.setDate(now.getDate() - day);
      start.setHours(0, 0, 0, 0);
      entities.dateRange = { from: start, to: now };
    } else if (lower.includes('este mes') || lower.includes('this month')) {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      entities.dateRange = { from: start, to: now };
    } else if (lower.includes('ultimos 3 meses') || lower.includes('last 3 months')) {
      const start = new Date(now);
      start.setDate(now.getDate() - 90);
      entities.dateRange = { from: start, to: now };
    } else if (lower.includes('ultimo mes') || lower.includes('last month')) {
      const start = new Date(now);
      start.setDate(now.getDate() - 30);
      entities.dateRange = { from: start, to: now };
    }

    // Amount
    const amountMatch = lower.match(/\$?([\d,.]+)\s*(k|m)?/i);
    if (amountMatch) {
      let val = parseFloat(amountMatch[1].replace(/,/g, ''));
      const suffix = (amountMatch[2] || '').toLowerCase();
      if (suffix === 'k') val *= 1e3;
      if (suffix === 'm') val *= 1e6;
      if (val > 0) {
        if (lower.includes('arriba de') || lower.includes('above') || lower.includes('mayor a') || lower.includes('mas de')) {
          entities.amount = { min: val };
        } else if (lower.includes('debajo de') || lower.includes('below') || lower.includes('menor a') || lower.includes('menos de')) {
          entities.amount = { max: val };
        } else {
          entities.amount = { min: val * 0.8, max: val * 1.2 };
        }
      }
    }

    // Stage
    for (const [keyword, stage] of Object.entries(STAGE_MAP)) {
      if (lower.includes(keyword)) {
        entities.stage = stage;
        break;
      }
    }

    // Period
    if (lower.includes('diario') || lower.includes('daily')) {
      entities.period = 'daily';
    } else if (lower.includes('semanal') || lower.includes('weekly') || lower.includes('semana')) {
      entities.period = 'weekly';
    } else if (lower.includes('mensual') || lower.includes('monthly') || lower.includes('mes')) {
      entities.period = 'monthly';
    }

    return entities;
  }

  // ── Shared filter builder ──────────────────────────────────

  private buildLeadWhere(entities: Entities, extraWhere: any = {}): any {
    const where: any = { deletedAt: null, isHistorical: false, ...extraWhere };
    if (entities.zone) where.zone = entities.zone as any;
    if (entities.advisor) where.assignedToId = entities.advisor.id;
    if (entities.industry) where.industry = { contains: entities.industry, mode: 'insensitive' };
    if (entities.stage) where.status = entities.stage as any;
    if (entities.dateRange) {
      where.createdAt = { gte: entities.dateRange.from, lte: entities.dateRange.to };
    }
    if (entities.amount) {
      where.estimatedValue = {};
      if (entities.amount.min) where.estimatedValue.gte = entities.amount.min;
      if (entities.amount.max) where.estimatedValue.lte = entities.amount.max;
    }
    return where;
  }

  // ── Handler: Leads Query ───────────────────────────────────

  private async handleLeadsQuery(entities: Entities): Promise<ChatResponse> {
    const where = this.buildLeadWhere(entities);

    const leads = await this.prisma.lead.findMany({
      where,
      select: {
        companyName: true,
        contactName: true,
        zone: true,
        industry: true,
        status: true,
        estimatedValue: true,
        assignedTo: { select: { firstName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }) as any[];

    const totalValue = leads.reduce((sum: number, l: any) => sum + (l.estimatedValue || 0), 0);
    const zoneLabel = entities.zone || 'todas las zonas';
    const industryLabel = entities.industry || 'todas las industrias';

    return {
      agent: 'Asistente Comercial',
      message: `Encontre ${leads.length} leads en ${zoneLabel} (${industryLabel}).`,
      data: {
        type: 'table',
        title: 'Leads encontrados',
        headers: ['Empresa', 'Contacto', 'Zona', 'Industria', 'Status', 'Valor'],
        rows: leads.map((l: any) => [
          l.companyName,
          l.contactName,
          l.zone,
          l.industry || '-',
          l.status,
          l.estimatedValue ? fmt(l.estimatedValue) : '-',
        ]),
      },
      insights: [
        `${leads.length} leads en ${zoneLabel}`,
        `Valor total: ${fmt(totalValue)}`,
        leads.length > 0
          ? `Industria mas comun: ${this.mostCommon(leads.map((l: any) => l.industry || 'Sin industria'))}`
          : 'Sin leads en este filtro',
      ],
      suggestions: [
        'Filtrar por industria',
        'Ver deals de esta zona',
        'Mostrar oportunidades de alto valor',
      ],
    };
  }

  // ── Handler: Deals Query ───────────────────────────────────

  private async handleDealsQuery(entities: Entities): Promise<ChatResponse> {
    const where = this.buildLeadWhere(entities, {
      status: entities.stage
        ? (entities.stage as any)
        : { in: DEAL_STAGES as any },
    });

    const deals = await this.prisma.lead.findMany({
      where,
      select: {
        companyName: true,
        contactName: true,
        zone: true,
        industry: true,
        status: true,
        estimatedValue: true,
        assignedTo: { select: { firstName: true } },
      },
      orderBy: { estimatedValue: 'desc' },
      take: 50,
    }) as any[];

    const totalValue = deals.reduce((sum: number, d: any) => sum + (d.estimatedValue || 0), 0);
    const avgTicket = deals.length > 0 ? totalValue / deals.length : 0;

    return {
      agent: 'Asistente Comercial',
      message: `Hay ${deals.length} deals activos con un pipeline total de ${fmt(totalValue)}.`,
      data: {
        type: 'table',
        title: 'Deals activos',
        headers: ['Empresa', 'Contacto', 'Zona', 'Etapa', 'Valor', 'Asesor'],
        rows: deals.map((d: any) => [
          d.companyName,
          d.contactName,
          d.zone,
          d.status,
          d.estimatedValue ? fmt(d.estimatedValue) : '-',
          d.assignedTo?.firstName || 'Sin asignar',
        ]),
      },
      insights: [
        `Total deals: ${deals.length}`,
        `Pipeline total: ${fmt(totalValue)}`,
        `Ticket promedio: ${fmt(avgTicket)}`,
      ],
      actions: [
        { label: 'Ver deals estancados', type: 'query' },
        { label: 'Analizar conversion', type: 'query' },
      ],
      suggestions: [
        'Mostrar deals en cotizacion',
        'Deals por zona',
        'Deals de alto valor',
      ],
    };
  }

  // ── Handler: Conversion Query ──────────────────────────────

  private async handleConversionQuery(entities: Entities): Promise<ChatResponse> {
    const baseWhere: any = { deletedAt: null, isHistorical: false };
    if (entities.advisor) baseWhere.assignedToId = entities.advisor.id;
    if (entities.dateRange) {
      baseWhere.createdAt = { gte: entities.dateRange.from, lte: entities.dateRange.to };
    }
    if (entities.zone) baseWhere.zone = entities.zone as any;

    const [totalLeads, dealsCount, cotizacionCount, closedCount] = await Promise.all([
      this.prisma.lead.count({ where: baseWhere }),
      this.prisma.lead.count({ where: { ...baseWhere, status: { in: DEAL_STAGES as any } } }),
      this.prisma.lead.count({
        where: {
          ...baseWhere,
          status: {
            in: ['COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO', 'CERRADO_GANADO'] as any,
          },
        },
      }),
      this.prisma.lead.count({ where: { ...baseWhere, status: 'CERRADO_GANADO' as any } }),
    ]);

    const dealRate = totalLeads > 0 ? ((dealsCount / totalLeads) * 100).toFixed(1) : '0';
    const closeRate = dealsCount > 0 ? ((closedCount / dealsCount) * 100).toFixed(1) : '0';

    return {
      agent: 'Asistente Comercial',
      message: `Funnel de conversion: ${totalLeads} leads -> ${dealsCount} deals -> ${cotizacionCount} en cotizacion+ -> ${closedCount} cerrados ganados.`,
      data: {
        type: 'funnel',
        title: 'Funnel de Conversion',
        metrics: [
          { label: 'Total Leads', value: String(totalLeads), color: '#3B82F6' },
          { label: 'Deals', value: String(dealsCount), color: '#F59E0B' },
          { label: 'Cotizacion+', value: String(cotizacionCount), color: '#8B5CF6' },
          { label: 'Cerrados Ganados', value: String(closedCount), color: '#10B981' },
        ],
      },
      insights: [
        `Tasa lead-to-deal: ${dealRate}%`,
        `Tasa de cierre: ${closeRate}%`,
        closedCount === 0
          ? 'No se han cerrado deals en este periodo'
          : `${closedCount} deals cerrados exitosamente`,
      ],
      suggestions: [
        'Ver rendimiento por asesor',
        'Analizar perdidas',
        'Deals estancados',
      ],
    };
  }

  // ── Handler: Performance Query ─────────────────────────────

  private async handlePerformanceQuery(entities: Entities): Promise<ChatResponse> {
    const advisors = await this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true, role: 'OPERATOR' as any },
      select: { id: true, firstName: true, lastName: true },
    }) as any[];

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const rows: (string | number)[][] = [];
    const performanceData: { name: string; rate: number; pipeline: number }[] = [];

    for (const adv of advisors) {
      const [leadCount, dealCount, wonCount, pipelineAgg, tasksToday] = await Promise.all([
        this.prisma.lead.count({
          where: { assignedToId: adv.id, deletedAt: null, isHistorical: false, status: { in: ACTIVE_STAGES as any } },
        }),
        this.prisma.lead.count({
          where: { assignedToId: adv.id, deletedAt: null, isHistorical: false, status: { in: DEAL_STAGES as any } },
        }),
        this.prisma.lead.count({
          where: { assignedToId: adv.id, deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO' as any },
        }),
        this.prisma.lead.aggregate({
          where: {
            assignedToId: adv.id,
            deletedAt: null,
            isHistorical: false,
            status: { in: CLOSING_STAGES as any },
          },
          _sum: { estimatedValue: true },
        }),
        this.prisma.salesTask.count({
          where: {
            advisorId: adv.id,
            isHistorical: false,
            status: 'completed',
            completedAt: { gte: todayStart },
          },
        }),
      ]);

      const pipeline = (pipelineAgg as any)._sum?.estimatedValue || 0;
      const convRate = dealCount > 0 ? ((wonCount / dealCount) * 100).toFixed(0) : '0';

      rows.push([
        `${adv.firstName} ${adv.lastName}`,
        leadCount,
        dealCount,
        wonCount,
        fmt(pipeline),
        `${convRate}%`,
      ]);

      performanceData.push({
        name: adv.firstName,
        rate: dealCount > 0 ? (wonCount / dealCount) * 100 : 0,
        pipeline,
      });
    }

    const best = performanceData.reduce((a: any, b: any) => (a.rate > b.rate ? a : b), performanceData[0]);
    const worst = performanceData.reduce((a: any, b: any) => (a.rate < b.rate ? a : b), performanceData[0]);

    const insights: string[] = [];
    if (best) insights.push(`${best.name} tiene mejor tasa de conversion (${best.rate.toFixed(0)}%)`);
    if (worst && worst.name !== best?.name) {
      insights.push(`${worst.name} necesita mas actividad (${worst.rate.toFixed(0)}% conversion)`);
    }

    return {
      agent: 'Asistente Comercial',
      message: `Rendimiento del equipo comercial (${advisors.length} asesores activos).`,
      data: {
        type: 'table',
        title: 'Rendimiento por Asesor',
        headers: ['Asesor', 'Leads', 'Deals', 'Ganados', 'Pipeline', 'Tasa Conv.'],
        rows,
      },
      insights,
      suggestions: [
        'Ver plan de accion para el equipo',
        'Deals estancados por asesor',
        'Analizar conversion detallada',
      ],
    };
  }

  // ── Handler: Stuck Deals ───────────────────────────────────

  private async handleStuckDeals(entities: Entities): Promise<ChatResponse> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const where: any = {
      deletedAt: null,
      isHistorical: false,
      status: { in: DEAL_STAGES.filter((s: string) => s !== 'CERRADO_GANADO' && s !== 'CERRADO_PERDIDO') as any },
      OR: [
        { lastContactedAt: { lt: sevenDaysAgo } },
        { lastContactedAt: null },
      ],
    };
    if (entities.advisor) where.assignedToId = entities.advisor.id;
    if (entities.zone) where.zone = entities.zone as any;

    const stuck = await this.prisma.lead.findMany({
      where,
      select: {
        companyName: true,
        status: true,
        estimatedValue: true,
        lastContactedAt: true,
        assignedTo: { select: { firstName: true } },
      },
      orderBy: { lastContactedAt: 'asc' },
      take: 50,
    }) as any[];

    const totalRisk = stuck.reduce((sum: number, s: any) => sum + (s.estimatedValue || 0), 0);
    const now = new Date();

    return {
      agent: 'Asistente Comercial',
      message: `${stuck.length} deals sin contacto en 7+ dias (${fmt(totalRisk)} en riesgo).`,
      data: {
        type: 'table',
        title: 'Deals Estancados',
        headers: ['Empresa', 'Etapa', 'Asesor', 'Dias sin Contacto', 'Valor'],
        rows: stuck.map((s: any) => {
          const days = s.lastContactedAt
            ? Math.floor((now.getTime() - new Date(s.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24))
            : 999;
          return [
            s.companyName,
            s.status,
            s.assignedTo?.firstName || 'Sin asignar',
            days === 999 ? 'Nunca' : days,
            s.estimatedValue ? fmt(s.estimatedValue) : '-',
          ];
        }),
      },
      insights: [
        `${stuck.length} deals sin contacto en 7+ dias`,
        `${fmt(totalRisk)} en riesgo`,
        stuck.length > 0
          ? `Etapa mas afectada: ${this.mostCommon(stuck.map((s: any) => s.status))}`
          : 'No hay deals estancados',
      ],
      actions: [
        { label: 'Generar plan de rescate', type: 'action' },
        { label: 'Enviar recordatorios', type: 'action' },
      ],
      suggestions: [
        'Generar plan de seguimiento',
        'Ver por asesor',
        'Analizar perdidas',
      ],
    };
  }

  // ── Handler: Plan Generate ─────────────────────────────────

  private async handlePlanGenerate(entities: Entities): Promise<ChatResponse> {
    const period = entities.period || 'daily';
    const leadFilter = entities.advisor ? { assignedToId: entities.advisor.id } : {};
    const taskFilter = entities.advisor ? { advisorId: entities.advisor.id } : {};

    const now = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(now.getDate() - 7);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Get overdue tasks
    const overdueTasks = await this.prisma.salesTask.findMany({
      where: {
        ...taskFilter,
        isHistorical: false,
        status: { in: ['pending', 'overdue'] },
        dueDate: { lt: now },
      } as any,
      select: { title: true, leadId: true, type: true, dueDate: true, priority: true },
      orderBy: { priorityScore: 'desc' },
      take: 10,
    }) as any[];

    // Get stuck deals
    const stuckDeals = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        isHistorical: false,
        status: { in: CLOSING_STAGES as any },
        ...leadFilter,
        OR: [
          { lastContactedAt: { lt: sevenDaysAgo } },
          { lastContactedAt: null },
        ],
      },
      select: { companyName: true, status: true, estimatedValue: true, lastContactedAt: true },
      orderBy: { estimatedValue: 'desc' },
      take: 10,
    }) as any[];

    // Get new leads to contact
    const newLeads = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        isHistorical: false,
        status: { in: ['PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR'] as any },
        ...leadFilter,
      },
      select: { companyName: true, status: true, estimatedValue: true, industry: true },
      orderBy: { estimatedValue: 'desc' },
      take: 10,
    }) as any[];

    const steps: { time: string; action: string; target: string; reason: string }[] = [];
    let hour = 8;
    let minute = 0;

    const addStep = (action: string, target: string, reason: string) => {
      const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      steps.push({ time: timeStr, action, target, reason });
      minute += 30;
      if (minute >= 60) {
        hour++;
        minute = 0;
      }
    };

    if (period === 'daily') {
      // Priority 1: overdue tasks
      for (const task of overdueTasks.slice(0, 3)) {
        addStep(task.type === 'call' ? 'Llamar' : 'Seguimiento', task.title, 'Tarea vencida');
      }
      // Priority 2: stuck deals
      for (const deal of stuckDeals.slice(0, 3)) {
        const days = deal.lastContactedAt
          ? Math.floor((now.getTime() - new Date(deal.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        addStep('Llamar', deal.companyName, `Sin contacto ${days > 0 ? days + ' dias' : 'nunca contactado'}`);
      }
      // Priority 3: new leads
      for (const lead of newLeads.slice(0, 2)) {
        addStep('Contactar', lead.companyName, `Lead nuevo - ${lead.industry || 'sin industria'}`);
      }
    } else if (period === 'weekly') {
      const dayNames = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes'];
      const allItems = [
        ...overdueTasks.map((t: any) => ({ action: 'Seguimiento', target: t.title, reason: 'Tarea vencida' })),
        ...stuckDeals.map((d: any) => ({ action: 'Llamar', target: d.companyName, reason: 'Deal estancado' })),
        ...newLeads.map((l: any) => ({ action: 'Contactar', target: l.companyName, reason: 'Lead nuevo' })),
      ];
      let dayIdx = 0;
      for (let i = 0; i < Math.min(allItems.length, 25); i++) {
        if (i > 0 && i % 5 === 0) {
          dayIdx++;
          hour = 8;
          minute = 0;
        }
        const item = allItems[i];
        steps.push({
          time: `${dayNames[dayIdx] || 'Viernes'} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
          action: item.action,
          target: item.target,
          reason: item.reason,
        });
        minute += 30;
        if (minute >= 60) { hour++; minute = 0; }
      }
    } else {
      // monthly: strategy overview
      steps.push(
        { time: 'Semana 1', action: 'Limpiar pipeline', target: `${stuckDeals.length} deals estancados`, reason: 'Recuperar deals en riesgo' },
        { time: 'Semana 2', action: 'Prospeccion intensiva', target: `${newLeads.length} leads nuevos`, reason: 'Llenar pipeline' },
        { time: 'Semana 3', action: 'Cierre agresivo', target: 'Deals en cotizacion', reason: 'Acelerar cierres' },
        { time: 'Semana 4', action: 'Revision y ajuste', target: 'Equipo completo', reason: 'Optimizar procesos' },
      );
    }

    const advisorLabel = entities.advisor ? entities.advisor.name : 'el equipo';

    return {
      agent: 'Asistente Comercial',
      message: `Plan ${period === 'daily' ? 'diario' : period === 'weekly' ? 'semanal' : 'mensual'} generado para ${advisorLabel} con ${steps.length} acciones.`,
      data: {
        type: 'plan',
        title: `Plan ${period === 'daily' ? 'Diario' : period === 'weekly' ? 'Semanal' : 'Mensual'}`,
        steps,
      },
      insights: [
        `${overdueTasks.length} tareas vencidas pendientes`,
        `${stuckDeals.length} deals necesitan atencion urgente`,
        `${newLeads.length} leads nuevos por contactar`,
      ],
      suggestions: [
        'Ver deals estancados',
        'Rendimiento del equipo',
        'Oportunidades de alto valor',
      ],
    };
  }

  // ── Handler: Opportunity Find ──────────────────────────────

  private async handleOpportunityFind(entities: Entities): Promise<ChatResponse> {
    const where: any = {
      deletedAt: null,
      isHistorical: false,
      estimatedValue: { gt: 0 },
      status: { in: ACTIVE_STAGES as any },
    };
    if (entities.zone) where.zone = entities.zone as any;
    if (entities.industry) where.industry = { contains: entities.industry, mode: 'insensitive' };
    if (entities.amount?.min) where.estimatedValue = { ...where.estimatedValue, gte: entities.amount.min };

    const opportunities = await this.prisma.lead.findMany({
      where,
      select: {
        companyName: true,
        zone: true,
        industry: true,
        estimatedValue: true,
        status: true,
        assignedTo: { select: { firstName: true } },
      },
      orderBy: { estimatedValue: 'desc' },
      take: 20,
    }) as any[];

    const totalValue = opportunities.reduce((sum: number, o: any) => sum + (o.estimatedValue || 0), 0);
    const avgTicket = opportunities.length > 0 ? totalValue / opportunities.length : 0;

    return {
      agent: 'Asistente Comercial',
      message: `Top ${opportunities.length} oportunidades de alto valor (${fmt(totalValue)} total).`,
      data: {
        type: 'table',
        title: 'Oportunidades de Alto Valor',
        headers: ['Empresa', 'Zona', 'Industria', 'Valor', 'Etapa', 'Asesor'],
        rows: opportunities.map((o: any) => [
          o.companyName,
          o.zone,
          o.industry || '-',
          fmt(o.estimatedValue),
          o.status,
          o.assignedTo?.firstName || 'Sin asignar',
        ]),
      },
      insights: [
        `${opportunities.length} oportunidades identificadas`,
        `Valor total: ${fmt(totalValue)}`,
        `Ticket promedio: ${fmt(avgTicket)}`,
        opportunities.length > 0
          ? `Segmento mas concentrado: ${this.mostCommon(opportunities.map((o: any) => o.industry || 'Sin industria'))}`
          : 'Sin oportunidades en este filtro',
      ],
      suggestions: [
        'Ver deals estancados',
        'Generar plan de cierre',
        'Filtrar por zona',
      ],
    };
  }

  // ── Handler: Contact Attempts ──────────────────────────────

  private async handleContactAttempts(entities: Entities): Promise<ChatResponse> {
    const taskWhere: any = { type: { in: ['call', 'whatsapp', 'email'] }, isHistorical: false };
    if (entities.advisor) taskWhere.advisorId = entities.advisor.id;

    const tasks = await this.prisma.salesTask.findMany({
      where: taskWhere,
      select: { leadId: true, advisorId: true, status: true },
    }) as any[];

    // Group by lead
    const byLead: Record<string, number> = {};
    for (const t of tasks) {
      if (t.leadId) {
        byLead[t.leadId] = (byLead[t.leadId] || 0) + 1;
      }
    }

    const leadIds = Object.keys(byLead);
    const attempts = Object.values(byLead);
    const totalAttempts = attempts.reduce((a: number, b: number) => a + b, 0);
    const avgAttempts = leadIds.length > 0 ? (totalAttempts / leadIds.length).toFixed(1) : '0';
    const maxAttempts = attempts.length > 0 ? Math.max(...attempts) : 0;

    // Leads with zero attempts
    const leadsWithTasks = new Set(leadIds);
    const advisorWhere: any = { deletedAt: null, isHistorical: false, status: { in: ACTIVE_STAGES as any } };
    if (entities.advisor) advisorWhere.assignedToId = entities.advisor.id;

    const totalActiveLeads = await this.prisma.lead.count({ where: advisorWhere });
    const zeroAttempts = totalActiveLeads - leadsWithTasks.size;

    return {
      agent: 'Asistente Comercial',
      message: `Analisis de intentos de contacto: promedio ${avgAttempts} intentos por lead.`,
      data: {
        type: 'metrics',
        title: 'Intentos de Contacto',
        metrics: [
          { label: 'Promedio por lead', value: avgAttempts, color: '#3B82F6' },
          { label: 'Maximo intentos', value: String(maxAttempts), color: '#F59E0B' },
          { label: 'Leads sin intentos', value: String(zeroAttempts > 0 ? zeroAttempts : 0), color: '#EF4444' },
          { label: 'Leads contactados', value: String(leadsWithTasks.size), color: '#10B981' },
        ],
      },
      insights: [
        `Promedio de ${avgAttempts} intentos por deal`,
        `Maximo: ${maxAttempts} intentos en un solo lead`,
        zeroAttempts > 0
          ? `${zeroAttempts} leads activos sin ningun intento de contacto`
          : 'Todos los leads activos han sido contactados al menos una vez',
      ],
      suggestions: [
        'Ver leads sin contacto',
        'Rendimiento por asesor',
        'Deals estancados',
      ],
    };
  }

  // ── Handler: Loss Analysis ─────────────────────────────────

  private async handleLossAnalysis(entities: Entities): Promise<ChatResponse> {
    const where: any = { deletedAt: null, isHistorical: false, status: 'CERRADO_PERDIDO' as any };
    if (entities.zone) where.zone = entities.zone as any;
    if (entities.dateRange) where.updatedAt = { gte: entities.dateRange.from, lte: entities.dateRange.to };
    if (entities.advisor) where.assignedToId = entities.advisor.id;

    const lost = await this.prisma.lead.findMany({
      where,
      select: {
        companyName: true,
        zone: true,
        industry: true,
        estimatedValue: true,
        assignedTo: { select: { firstName: true } },
      },
    }) as any[];

    const totalLost = lost.reduce((sum: number, l: any) => sum + (l.estimatedValue || 0), 0);

    // Group by zone
    const byZone: Record<string, number> = {};
    for (const l of lost) {
      byZone[l.zone] = (byZone[l.zone] || 0) + 1;
    }

    // Group by industry
    const byIndustry: Record<string, number> = {};
    for (const l of lost) {
      const ind = l.industry || 'Sin industria';
      byIndustry[ind] = (byIndustry[ind] || 0) + 1;
    }

    // Check previous stages from tasks
    const lostLeadTasks = await this.prisma.salesTask.findMany({
      where: {
        isHistorical: false,
        leadId: { in: lost.map((l: any) => l.companyName).length > 0 ? undefined : undefined },
        previousStage: { not: null },
      },
      select: { previousStage: true },
      take: 200,
    }) as any[];

    const byPrevStage: Record<string, number> = {};
    for (const t of lostLeadTasks) {
      if (t.previousStage) {
        byPrevStage[t.previousStage] = (byPrevStage[t.previousStage] || 0) + 1;
      }
    }

    const worstZone = Object.entries(byZone).sort(([, a], [, b]) => (b as number) - (a as number))[0];
    const worstIndustry = Object.entries(byIndustry).sort(([, a], [, b]) => (b as number) - (a as number))[0];

    return {
      agent: 'Asistente Comercial',
      message: `Analisis de perdidas: ${lost.length} deals perdidos (${fmt(totalLost)} en valor).`,
      data: {
        type: 'table',
        title: 'Deals Perdidos',
        headers: ['Empresa', 'Zona', 'Industria', 'Valor', 'Asesor'],
        rows: lost.slice(0, 30).map((l: any) => [
          l.companyName,
          l.zone,
          l.industry || '-',
          l.estimatedValue ? fmt(l.estimatedValue) : '-',
          l.assignedTo?.firstName || 'Sin asignar',
        ]),
      },
      insights: [
        `${lost.length} deals perdidos con valor de ${fmt(totalLost)}`,
        worstZone ? `Zona con mas perdidas: ${worstZone[0]} (${worstZone[1]} deals)` : 'Sin datos por zona',
        worstIndustry ? `Industria con mas perdidas: ${worstIndustry[0]} (${worstIndustry[1]} deals)` : 'Sin datos por industria',
      ],
      suggestions: [
        'Ver conversion por zona',
        'Comparar rendimiento de asesores',
        'Oportunidades actuales',
      ],
    };
  }

  // ── Handler: Action Follow-up ──────────────────────────────

  private async handleActionFollowup(entities: Entities): Promise<ChatResponse> {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const where: any = {
      deletedAt: null,
      isHistorical: false,
      status: { in: ACTIVE_STAGES as any },
      OR: [
        { lastContactedAt: { lt: threeDaysAgo } },
        { lastContactedAt: null },
      ],
    };
    if (entities.advisor) where.assignedToId = entities.advisor.id;

    const needFollowUp = await this.prisma.lead.findMany({
      where,
      select: {
        companyName: true,
        status: true,
        estimatedValue: true,
        lastContactedAt: true,
        assignedTo: { select: { firstName: true } },
      },
      orderBy: { lastContactedAt: 'asc' },
      take: 20,
    }) as any[];

    const now = new Date();
    const items = needFollowUp.map((l: any) => {
      const days = l.lastContactedAt
        ? Math.floor((now.getTime() - new Date(l.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      const urgency = days > 7 ? 'URGENTE' : days > 5 ? 'ALTA' : 'MEDIA';
      return `[${urgency}] ${l.companyName} - ${l.status} - ${days > 0 ? days + ' dias sin contacto' : 'Nunca contactado'} - Asesor: ${l.assignedTo?.firstName || 'Sin asignar'} - Valor: ${l.estimatedValue ? fmt(l.estimatedValue) : 'N/A'}`;
    });

    return {
      agent: 'Asistente Comercial',
      message: `${needFollowUp.length} leads necesitan seguimiento (sin contacto 3+ dias).`,
      data: {
        type: 'list',
        title: 'Seguimientos Pendientes',
        items,
      },
      insights: [
        `${needFollowUp.length} leads sin seguimiento reciente`,
        needFollowUp.length > 0
          ? `Prioridad: ${needFollowUp[0].companyName} (${needFollowUp[0].lastContactedAt ? 'hace mucho tiempo' : 'nunca contactado'})`
          : 'Todos los leads estan al dia',
      ],
      actions: [
        { label: 'Generar plan de seguimiento', type: 'action' },
        { label: 'Enviar recordatorios masivos', type: 'action' },
      ],
      suggestions: [
        'Generar plan diario',
        'Ver deals estancados',
        'Intentos de contacto',
      ],
    };
  }

  // ── Handler: Action Message ────────────────────────────────

  private async handleActionMessage(entities: Entities): Promise<ChatResponse> {
    const stage = entities.stage || 'PENDIENTE_CONTACTAR';
    let template: string;
    let subject: string;

    switch (stage) {
      case 'PENDIENTE_CONTACTAR':
      case 'INTENTANDO_CONTACTAR':
        subject = 'Primer contacto';
        template = `Hola [NOMBRE], soy [ASESOR] de IEA. Le contacto porque identificamos que su empresa [EMPRESA] podria beneficiarse de nuestras soluciones en [INDUSTRIA].

Me gustaria agendar una llamada breve de 15 minutos para entender sus necesidades actuales. Que dia y horario le funciona mejor?

Quedo atento a su respuesta.
Saludos cordiales.`;
        break;

      case 'ESPERANDO_COTIZACION':
      case 'COTIZACION_ENTREGADA':
        subject = 'Seguimiento de cotizacion';
        template = `Hola [NOMBRE], espero que se encuentre bien.

Le escribo para dar seguimiento a la cotizacion que le compartimos para [EMPRESA]. Queria saber si tuvo oportunidad de revisarla y si tiene alguna duda o comentario.

Estoy disponible para aclarar cualquier punto o ajustar la propuesta segun sus necesidades.

Quedo al pendiente.
Saludos.`;
        break;

      case 'ESPERANDO_CONTRATO':
        subject = 'Recordatorio de contrato';
        template = `Hola [NOMBRE], buen dia.

Me comunico respecto al contrato de [EMPRESA]. Queriamos confirmar si ya tuvieron oportunidad de revisar los terminos y si podemos avanzar con la firma.

Si necesita algun ajuste o tiene dudas, con gusto lo revisamos juntos. Estamos listos para iniciar en cuanto tengamos todo en orden.

Saludos cordiales.`;
        break;

      case 'PENDIENTE_PAGO':
        subject = 'Seguimiento de pago';
        template = `Hola [NOMBRE], espero que todo marche bien.

Le contacto para dar seguimiento al pago pendiente de [EMPRESA]. Queriamos confirmar si ya se proceso o si necesitan apoyo con la facturacion.

Quedamos atentos.
Saludos.`;
        break;

      default:
        subject = 'Seguimiento general';
        template = `Hola [NOMBRE], soy [ASESOR] de IEA.

Me gustaria ponerme en contacto con usted para platicar sobre como podemos apoyar a [EMPRESA] con nuestras soluciones.

Quedo al pendiente de su respuesta.
Saludos cordiales.`;
    }

    return {
      agent: 'Asistente Comercial',
      message: `Plantilla generada para etapa: ${stage}.`,
      data: {
        type: 'list',
        title: subject,
        items: [
          `Asunto: ${subject}`,
          '---',
          template,
          '---',
          'Nota: Reemplaza [NOMBRE], [ASESOR], [EMPRESA] e [INDUSTRIA] con los datos del lead.',
        ],
      },
      insights: [
        `Plantilla para etapa ${stage}`,
        'Personaliza el mensaje antes de enviarlo',
      ],
      suggestions: [
        'Generar script de llamada',
        'Ver leads en esta etapa',
        'Generar plantilla para otra etapa',
      ],
    };
  }

  // ── Handler: Action Script ─────────────────────────────────

  private async handleActionScript(entities: Entities): Promise<ChatResponse> {
    const stage = entities.stage || 'PENDIENTE_CONTACTAR';
    let script: string[];

    switch (stage) {
      case 'PENDIENTE_CONTACTAR':
      case 'INTENTANDO_CONTACTAR':
        script = [
          'APERTURA: "Buenos dias, [NOMBRE]. Soy [ASESOR] de IEA. Le llamo porque identificamos que [EMPRESA] podria beneficiarse de nuestras soluciones de telematica y gestion de flotillas."',
          'VALOR: "Ayudamos a empresas como la suya a reducir costos operativos hasta un 30% con monitoreo GPS, control de combustible y optimizacion de rutas."',
          'PREGUNTA ABIERTA: "Actualmente como manejan el control de sus unidades/flotilla?"',
          'OBJECIONES COMUNES:',
          '  - "Ya tenemos proveedor" -> "Entiendo. Muchos de nuestros clientes tambien tenian proveedor antes. Lo que nos diferencia es [DIFERENCIADOR]. Le parece si le comparto una comparativa rapida?"',
          '  - "No tenemos presupuesto" -> "Comprendo. Precisamente nuestras soluciones generan ahorros que se pagan solos. Puedo mostrarle un caso similar al suyo donde el ROI fue de X meses."',
          '  - "No me interesa" -> "Respeto su posicion. Solo para entender mejor, hay alguna razon especifica? Quizas puedo resolver alguna duda."',
          'CIERRE: "Me gustaria agendar una demostracion de 20 minutos para mostrarle especificamente como podemos ayudar a [EMPRESA]. Tiene disponibilidad esta semana?"',
        ];
        break;

      case 'COTIZACION_ENTREGADA':
        script = [
          'APERTURA: "Hola [NOMBRE], soy [ASESOR] de IEA. Le llamo para dar seguimiento a la cotizacion que le enviamos la semana pasada."',
          'SONDEO: "Tuvo oportunidad de revisarla? Hay algun punto que le gustaria que ajustaramos?"',
          'MANEJO DE PRECIO: "Entiendo que el precio es un factor importante. Permita me mostrarle el desglose del ROI: con nuestro sistema, empresas similares ahorran [X] mensual en combustible y [Y] en mantenimiento preventivo."',
          'URGENCIA: "Actualmente tenemos disponibilidad inmediata para instalacion, lo que significa que podrian empezar a ver beneficios desde la proxima semana."',
          'CIERRE: "Si ajustamos [PUNTO_ESPECIFICO], podriamos avanzar con la orden esta semana?"',
        ];
        break;

      case 'ESPERANDO_CONTRATO':
        script = [
          'APERTURA: "Hola [NOMBRE], soy [ASESOR]. Le llamo respecto al contrato de [EMPRESA]."',
          'PREGUNTA DIRECTA: "Ya tuvieron oportunidad de revisar los terminos del contrato?"',
          'FACILITAR: "Si tiene alguna duda legal o tecnica, puedo coordinar una llamada con nuestro equipo para resolverla hoy mismo."',
          'URGENCIA SUAVE: "Tenemos el equipo y el equipo de instalacion reservado para su proyecto. Nos gustaria confirmar las fechas lo antes posible para garantizar la disponibilidad."',
          'CIERRE: "Hay algo que podamos hacer de nuestro lado para agilizar el proceso?"',
        ];
        break;

      default:
        script = [
          'APERTURA: "Buenos dias, [NOMBRE]. Soy [ASESOR] de IEA."',
          'CONTEXTO: Referencia la ultima interaccion o punto de contacto.',
          'VALOR: Refuerza el beneficio principal para su empresa.',
          'PREGUNTA: Identifica objeciones o necesidades no resueltas.',
          'CIERRE: Propone siguiente paso concreto con fecha.',
        ];
    }

    return {
      agent: 'Asistente Comercial',
      message: `Script de llamada generado para etapa: ${stage}.`,
      data: {
        type: 'list',
        title: `Script de Llamada - ${stage}`,
        items: script,
      },
      insights: [
        'Adapta el script al contexto especifico del lead',
        'Registra el resultado de la llamada al terminar',
      ],
      suggestions: [
        'Generar plantilla de mensaje',
        'Ver leads en esta etapa',
        'Generar plan diario',
      ],
    };
  }

  // ── Handler: Action Campaign ───────────────────────────────

  private async handleActionCampaign(entities: Entities): Promise<ChatResponse> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const inactive = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        isHistorical: false,
        OR: [
          { status: 'CONTACTAR_FUTURO' as any },
          {
            status: { in: ACTIVE_STAGES as any },
            lastContactedAt: { lt: thirtyDaysAgo },
          },
          {
            status: { in: ACTIVE_STAGES as any },
            lastContactedAt: null,
          },
        ],
      },
      select: {
        companyName: true,
        zone: true,
        industry: true,
        estimatedValue: true,
        status: true,
        contactEmail: true,
        contactPhone: true,
      },
    }) as any[];

    // Group by zone
    const byZone: Record<string, any[]> = {};
    for (const l of inactive) {
      const z = l.zone || 'OTROS';
      if (!byZone[z]) byZone[z] = [];
      byZone[z].push(l);
    }

    // Group by industry
    const byIndustry: Record<string, number> = {};
    for (const l of inactive) {
      const ind = l.industry || 'Sin industria';
      byIndustry[ind] = (byIndustry[ind] || 0) + 1;
    }

    const withEmail = inactive.filter((l: any) => l.contactEmail).length;
    const withPhone = inactive.filter((l: any) => l.contactPhone).length;
    const suggestedChannel = withEmail > withPhone ? 'Email' : 'WhatsApp';

    const steps: { time: string; action: string; target: string; reason: string }[] = [];

    for (const [zone, leads] of Object.entries(byZone)) {
      steps.push({
        time: 'Dia 1',
        action: `Campana ${suggestedChannel}`,
        target: `${(leads as any[]).length} leads en ${zone}`,
        reason: `Reactivacion de leads inactivos 30+ dias`,
      });
    }

    steps.push({
      time: 'Dia 3',
      action: 'Seguimiento telefonico',
      target: `Leads que abrieron ${suggestedChannel.toLowerCase()}`,
      reason: 'Convertir interes en cita',
    });

    steps.push({
      time: 'Dia 7',
      action: 'Segundo envio',
      target: 'Leads sin respuesta',
      reason: 'Refuerzo con oferta especial',
    });

    return {
      agent: 'Asistente Comercial',
      message: `Plan de campana de reactivacion: ${inactive.length} leads inactivos identificados.`,
      data: {
        type: 'plan',
        title: 'Campana de Reactivacion',
        steps,
      },
      insights: [
        `${inactive.length} leads inactivos (30+ dias sin contacto o marcados para futuro)`,
        `Canal sugerido: ${suggestedChannel} (${suggestedChannel === 'Email' ? withEmail : withPhone} leads con dato de contacto)`,
        `Industria con mas inactivos: ${this.mostCommon(inactive.map((l: any) => l.industry || 'Sin industria'))}`,
      ],
      suggestions: [
        'Generar plantilla de mensaje',
        'Ver oportunidades de alto valor',
        'Rendimiento del equipo',
      ],
    };
  }

  // ── Handler: Action Assign ─────────────────────────────────

  private async handleActionAssign(entities: Entities): Promise<ChatResponse> {
    // Unassigned leads
    const unassigned = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        isHistorical: false,
        assignedToId: null,
        status: { in: ACTIVE_STAGES as any },
      },
      select: { companyName: true, zone: true, estimatedValue: true, status: true },
      orderBy: { estimatedValue: 'desc' },
    }) as any[];

    // Current distribution
    const advisors = await this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true, role: 'OPERATOR' as any },
      select: { id: true, firstName: true, lastName: true },
    }) as any[];

    const distribution: { name: string; count: number; value: number }[] = [];

    for (const adv of advisors) {
      const [count, agg] = await Promise.all([
        this.prisma.lead.count({
          where: { assignedToId: adv.id, deletedAt: null, isHistorical: false, status: { in: ACTIVE_STAGES as any } },
        }),
        this.prisma.lead.aggregate({
          where: { assignedToId: adv.id, deletedAt: null, isHistorical: false, status: { in: ACTIVE_STAGES as any } },
          _sum: { estimatedValue: true },
        }),
      ]);
      distribution.push({
        name: `${adv.firstName} ${adv.lastName}`,
        count,
        value: (agg as any)._sum?.estimatedValue || 0,
      });
    }

    // Sort by count to find who has least leads
    distribution.sort((a: any, b: any) => a.count - b.count);

    const rows: (string | number)[][] = distribution.map((d: any) => [
      d.name,
      d.count,
      fmt(d.value),
    ]);

    return {
      agent: 'Asistente Comercial',
      message: `${unassigned.length} leads sin asignar. Distribucion actual del equipo:`,
      data: {
        type: 'table',
        title: 'Distribucion de Leads',
        headers: ['Asesor', 'Leads Activos', 'Pipeline'],
        rows,
      },
      insights: [
        `${unassigned.length} leads sin asignar`,
        distribution.length > 0
          ? `Asesor con menos carga: ${distribution[0].name} (${distribution[0].count} leads)`
          : 'Sin asesores activos',
        distribution.length > 1
          ? `Asesor con mas carga: ${distribution[distribution.length - 1].name} (${distribution[distribution.length - 1].count} leads)`
          : '',
      ].filter((i: string) => i),
      actions: [
        { label: 'Asignar automaticamente', type: 'action' },
        { label: 'Redistribuir equitativamente', type: 'action' },
      ],
      suggestions: [
        'Rendimiento por asesor',
        'Ver leads sin asignar',
        'Generar plan semanal',
      ],
    };
  }

  // ── Handler: General Insight ───────────────────────────────

  private async handleGeneralInsight(): Promise<ChatResponse> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalActive,
      totalDeals,
      pipelineAgg,
      wonThisMonth,
      wonValueAgg,
    ] = await Promise.all([
      this.prisma.lead.count({
        where: { deletedAt: null, isHistorical: false, status: { in: ACTIVE_STAGES as any } },
      }),
      this.prisma.lead.count({
        where: { deletedAt: null, isHistorical: false, status: { in: DEAL_STAGES as any } },
      }),
      this.prisma.lead.aggregate({
        where: { deletedAt: null, isHistorical: false, status: { in: CLOSING_STAGES as any } },
        _sum: { estimatedValue: true },
      }),
      this.prisma.lead.count({
        where: {
          deletedAt: null,
          isHistorical: false,
          status: 'CERRADO_GANADO' as any,
          convertedAt: { gte: monthStart },
        },
      }),
      this.prisma.lead.aggregate({
        where: {
          deletedAt: null,
          isHistorical: false,
          status: 'CERRADO_GANADO' as any,
          convertedAt: { gte: monthStart },
        },
        _sum: { estimatedValue: true },
      }),
    ]);

    const pipelineValue = (pipelineAgg as any)._sum?.estimatedValue || 0;
    const wonValue = (wonValueAgg as any)._sum?.estimatedValue || 0;

    // Find top performer this month
    const advisors = await this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true, role: 'OPERATOR' as any },
      select: { id: true, firstName: true },
    }) as any[];

    let topPerformer = { name: 'N/A', wins: 0 };
    for (const adv of advisors) {
      const wins = await this.prisma.lead.count({
        where: {
          assignedToId: adv.id,
          deletedAt: null,
          isHistorical: false,
          status: 'CERRADO_GANADO' as any,
          convertedAt: { gte: monthStart },
        },
      });
      if (wins > topPerformer.wins) {
        topPerformer = { name: adv.firstName, wins };
      }
    }

    // Bottleneck: stage with most leads stuck
    const stageCountsRaw = await (this.prisma.lead.groupBy as any)({
      by: ['status'],
      where: { deletedAt: null, isHistorical: false, status: { in: ACTIVE_STAGES as any } },
      _count: { id: true },
    }) as any[];

    const bottleneck = stageCountsRaw.sort((a: any, b: any) => b._count.id - a._count.id)[0];

    return {
      agent: 'Asistente Comercial',
      message: 'Resumen general del area comercial. Preguntame sobre cualquier tema especifico.',
      data: {
        type: 'metrics',
        title: 'Dashboard Comercial',
        metrics: [
          { label: 'Leads Activos', value: String(totalActive), color: '#3B82F6' },
          { label: 'Deals en Pipeline', value: String(totalDeals), color: '#F59E0B' },
          { label: 'Valor Pipeline', value: fmt(pipelineValue), color: '#8B5CF6' },
          { label: 'Ganados este Mes', value: String(wonThisMonth), color: '#10B981' },
          { label: 'Ingreso este Mes', value: fmt(wonValue), color: '#059669' },
        ],
      },
      insights: [
        topPerformer.wins > 0
          ? `Top performer: ${topPerformer.name} con ${topPerformer.wins} cierres este mes`
          : 'Sin cierres este mes',
        bottleneck
          ? `Mayor concentracion: ${bottleneck.status} (${bottleneck._count.id} leads)`
          : 'Distribucion equilibrada',
        `Pipeline activo: ${fmt(pipelineValue)}`,
      ],
      suggestions: [
        'Ver rendimiento del equipo',
        'Deals estancados',
        'Oportunidades de alto valor',
        'Analizar conversion',
        'Generar plan semanal',
        'Ver intentos de contacto',
      ],
    };
  }

  // ── Utilities ──────────────────────────────────────────────

  private mostCommon(values: string[]): string {
    const counts: Record<string, number> = {};
    for (const v of values) {
      counts[v] = (counts[v] || 0) + 1;
    }
    const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
    return sorted.length > 0 ? sorted[0][0] : 'N/A';
  }
}
