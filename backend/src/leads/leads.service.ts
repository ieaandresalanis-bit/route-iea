import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { LeadQueryDto } from './dto/lead-query.dto';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(private prisma: PrismaService) {}

  async create(dto: CreateLeadDto) {
    const lead = await this.prisma.lead.create({ data: dto });
    this.logger.log(`Lead created: ${lead.id} — ${lead.companyName}`);
    return lead;
  }

  async findAll(query: LeadQueryDto) {
    const page = parseInt(query.page ?? '1', 10);
    const limit = parseInt(query.limit ?? '50', 10);
    const skip = (page - 1) * limit;

    const where: Prisma.LeadWhereInput = {
      deletedAt: null,
      isHistorical: false,
      ...(query.zone ? { zone: query.zone } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.assignedToId ? { assignedToId: query.assignedToId } : {}),
      ...(query.search
        ? {
            OR: [
              { companyName: { contains: query.search, mode: 'insensitive' } },
              { contactName: { contains: query.search, mode: 'insensitive' } },
              { address: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: {
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** Lightweight data for map markers */
  async getMapData() {
    return this.prisma.lead.findMany({
      where: { deletedAt: null, isHistorical: false, status: { notIn: ['CERRADO_PERDIDO', 'LEAD_BASURA'] } },
      select: {
        id: true,
        companyName: true,
        contactName: true,
        latitude: true,
        longitude: true,
        zone: true,
        status: true,
        address: true,
      },
    });
  }

  /** Counts grouped by zone and status */
  async getStats() {
    const [byZone, byStatus, total] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['zone'],
        where: { deletedAt: null, isHistorical: false },
        _count: true,
      }),
      this.prisma.lead.groupBy({
        by: ['status'],
        where: { deletedAt: null, isHistorical: false },
        _count: true,
      }),
      this.prisma.lead.count({ where: { deletedAt: null, isHistorical: false } }),
    ]);

    return { total, byZone, byStatus };
  }

  /** Rich data for commercial decision map */
  async getCommercialMapData() {
    const PIPELINE_STATUSES: any[] = [
      'PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR', 'EN_PROSPECCION',
      'AGENDAR_CITA', 'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA',
      'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO',
    ];
    const HOT_STATUSES: any[] = [
      'COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO',
    ];

    // Get all active leads with full details
    const leads = await this.prisma.lead.findMany({
      where: { deletedAt: null, isHistorical: false, status: { notIn: ['LEAD_BASURA' as any] } },
      select: {
        id: true,
        companyName: true,
        contactName: true,
        contactPhone: true,
        latitude: true,
        longitude: true,
        zone: true,
        status: true,
        source: true,
        industry: true,
        estimatedValue: true,
        address: true,
        city: true,
        state: true,
        lastContactedAt: true,
        createdAt: true,
        assignedToId: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Aggregate by zone
    const zoneAgg = await this.prisma.lead.groupBy({
      by: ['zone'],
      where: { deletedAt: null, isHistorical: false, status: { notIn: ['LEAD_BASURA' as any, 'CERRADO_PERDIDO' as any] } },
      _count: true,
      _sum: { estimatedValue: true },
    });

    // Pipeline value by zone (only active pipeline)
    const pipelineAgg = await this.prisma.lead.groupBy({
      by: ['zone'],
      where: { deletedAt: null, isHistorical: false, status: { in: PIPELINE_STATUSES } },
      _count: true,
      _sum: { estimatedValue: true },
    });

    // Won deals by zone
    const wonAgg = await this.prisma.lead.groupBy({
      by: ['zone'],
      where: { deletedAt: null, isHistorical: false, status: 'CERRADO_GANADO' as any },
      _count: true,
      _sum: { estimatedValue: true },
    });

    // City counts for density
    const cityAgg = await this.prisma.lead.groupBy({
      by: ['city', 'zone'],
      where: { deletedAt: null, isHistorical: false, city: { not: null }, status: { notIn: ['LEAD_BASURA' as any] } },
      _count: true,
      _sum: { estimatedValue: true },
    });

    // Hot leads
    const hotLeadIds = new Set(
      leads.filter(l => HOT_STATUSES.includes(l.status)).map(l => l.id)
    );

    // Advisor stats
    const advisorLeadCounts = await this.prisma.lead.groupBy({
      by: ['assignedToId'],
      where: { deletedAt: null, isHistorical: false, assignedToId: { not: null }, status: { in: PIPELINE_STATUSES } },
      _count: true,
      _sum: { estimatedValue: true },
    });

    // Days since last contact for each lead
    const now = Date.now();
    const enrichedLeads = leads.map(l => ({
      ...l,
      isHot: hotLeadIds.has(l.id),
      isPipeline: PIPELINE_STATUSES.includes(l.status),
      isClient: l.status === 'CERRADO_GANADO',
      isLost: l.status === 'CERRADO_PERDIDO',
      daysSinceContact: l.lastContactedAt
        ? Math.floor((now - new Date(l.lastContactedAt).getTime()) / 86400000)
        : null,
      lowAttention: l.lastContactedAt
        ? (now - new Date(l.lastContactedAt).getTime()) > 14 * 86400000
        : (now - new Date(l.createdAt).getTime()) > 7 * 86400000,
    }));

    // Zone summaries
    const zoneSummaries = (['BAJIO', 'OCCIDENTE', 'CENTRO', 'NORTE', 'OTROS'] as any[]).map(zone => {
      const total = zoneAgg.find(z => z.zone === zone);
      const pipeline = pipelineAgg.find(z => z.zone === zone);
      const won = wonAgg.find(z => z.zone === zone);
      const zoneLeads = enrichedLeads.filter(l => l.zone === zone);
      const lowAttentionCount = zoneLeads.filter(l => l.lowAttention && l.isPipeline).length;
      const hotCount = zoneLeads.filter(l => l.isHot).length;

      return {
        zone,
        totalLeads: total?._count || 0,
        totalValue: total?._sum?.estimatedValue || 0,
        pipelineLeads: pipeline?._count || 0,
        pipelineValue: pipeline?._sum?.estimatedValue || 0,
        wonLeads: won?._count || 0,
        wonValue: won?._sum?.estimatedValue || 0,
        hotLeads: hotCount,
        lowAttentionLeads: lowAttentionCount,
        conversionRate: (total?._count || 0) > 0
          ? Math.round(((won?._count || 0) / (total?._count || 1)) * 100)
          : 0,
      };
    });

    // City density
    const cities = cityAgg
      .filter(c => c.city)
      .map(c => ({
        city: c.city,
        zone: c.zone,
        count: c._count,
        value: c._sum?.estimatedValue || 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Advisors
    const advisors = advisorLeadCounts
      .filter(a => a.assignedToId)
      .map(a => ({
        advisorId: a.assignedToId,
        pipelineLeads: a._count,
        pipelineValue: a._sum?.estimatedValue || 0,
      }));

    return {
      leads: enrichedLeads,
      zoneSummaries,
      cities,
      advisors,
      totals: {
        totalLeads: leads.length,
        hotLeads: hotLeadIds.size,
        pipelineValue: pipelineAgg.reduce((s, z) => s + (z._sum?.estimatedValue || 0), 0),
        wonValue: wonAgg.reduce((s, z) => s + (z._sum?.estimatedValue || 0), 0),
        lowAttention: enrichedLeads.filter(l => l.lowAttention && l.isPipeline).length,
      },
    };
  }

  async findOne(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        visits: {
          orderBy: { visitDate: 'desc' },
          take: 10,
          include: { visitedBy: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    });
    if (!lead || lead.deletedAt) throw new NotFoundException(`Lead ${id} not found`);
    return lead;
  }

  async update(id: string, dto: UpdateLeadDto) {
    await this.findOne(id);
    const updated = await this.prisma.lead.update({ where: { id }, data: dto });
    this.logger.log(`Lead updated: ${id}`);
    return updated;
  }

  async convert(id: string) {
    const lead = await this.findOne(id);
    if (lead.status === 'CERRADO_GANADO') {
      throw new BadRequestException('Lead is already closed/won');
    }
    if (lead.status === 'CERRADO_PERDIDO') {
      throw new BadRequestException('Cannot convert a lost lead');
    }

    const updated = await this.prisma.lead.update({
      where: { id },
      data: { status: 'CERRADO_GANADO', convertedAt: new Date() },
    });

    this.logger.log(`Lead ${id} converted to CERRADO_GANADO`);
    return updated;
  }

  async softDelete(id: string) {
    await this.findOne(id);
    await this.prisma.lead.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    this.logger.log(`Lead ${id} soft-deleted`);
  }
}
