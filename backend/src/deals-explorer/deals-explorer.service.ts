import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

const DEAL_STAGES = [
  'ESPERANDO_COTIZACION',
  'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO',
  'PENDIENTE_PAGO',
  'CERRADO_GANADO',
  'CERRADO_PERDIDO',
];

const STAGE_LABELS: Record<string, string> = {
  ESPERANDO_COTIZACION: 'Esperando Cotizacion',
  COTIZACION_ENTREGADA: 'Cotizacion Entregada',
  ESPERANDO_CONTRATO: 'Esperando Contrato',
  PENDIENTE_PAGO: 'Pendiente Pago',
  CERRADO_GANADO: 'Cerrado Ganado',
  CERRADO_PERDIDO: 'Cerrado Perdido',
};

interface DealsFilters {
  page?: number;
  limit?: number;
  search?: string;
  stage?: string;
  advisorId?: string;
  zone?: string;
  industry?: string;
  dateFrom?: string;
  dateTo?: string;
  minAmount?: number;
  maxAmount?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

@Injectable()
export class DealsExplorerService {
  constructor(private prisma: PrismaService) {}

  async getDeals(filters: DealsFilters) {
    const page = filters.page || 1;
    const limit = filters.limit || 25;
    const skip = (page - 1) * limit;
    const now = new Date();

    // Build dynamic where clause — always filter to deal stages
    const where: any = {
      deletedAt: null,
      isHistorical: false,
      status: { in: DEAL_STAGES },
    };

    // Additional stage filter narrows within deal stages
    if (filters.stage) {
      where.status = filters.stage;
    }

    if (filters.search) {
      where.OR = [
        { companyName: { contains: filters.search, mode: 'insensitive' } },
        { contactName: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    if (filters.zone) {
      where.zone = filters.zone;
    }

    if (filters.industry) {
      where.industry = filters.industry;
    }

    if (filters.advisorId) {
      where.assignedToId = filters.advisorId;
    }

    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) {
        where.createdAt.gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        where.createdAt.lte = new Date(filters.dateTo);
      }
    }

    if (filters.minAmount !== undefined || filters.maxAmount !== undefined) {
      where.estimatedValue = {};
      if (filters.minAmount !== undefined) {
        where.estimatedValue.gte = filters.minAmount;
      }
      if (filters.maxAmount !== undefined) {
        where.estimatedValue.lte = filters.maxAmount;
      }
    }

    // Build orderBy
    const sortBy = filters.sortBy || 'createdAt';
    const sortDir = filters.sortDir || 'desc';
    const orderBy: any = { [sortBy]: sortDir };

    // Fetch deals + total count in parallel
    const [deals, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          companyName: true,
          contactName: true,
          contactPhone: true,
          zone: true,
          industry: true,
          status: true,
          estimatedValue: true,
          assignedToId: true,
          lastContactedAt: true,
          createdAt: true,
          assignedTo: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.lead.count({ where }),
    ]);

    // Get contact attempts (salesTask count per leadId)
    const dealIds = (deals as any[]).map((d: any) => d.id);
    const taskCounts = dealIds.length > 0
      ? await this.prisma.salesTask.groupBy({
          by: ['leadId'],
          where: { leadId: { in: dealIds } },
          _count: { id: true },
        })
      : [];
    const taskCountMap = new Map<string, number>(
      (taskCounts as any[]).map((t: any) => [t.leadId, t._count.id]),
    );

    // Map results
    const items = (deals as any[]).map((d: any) => {
      const daysSinceContact = d.lastContactedAt
        ? Math.floor((now.getTime() - new Date(d.lastContactedAt).getTime()) / 86400000)
        : -1;

      return {
        id: d.id,
        companyName: d.companyName,
        contactName: d.contactName,
        contactPhone: d.contactPhone,
        stage: d.status,
        stageLabel: STAGE_LABELS[d.status] || d.status,
        estimatedValue: d.estimatedValue,
        zone: d.zone,
        industry: d.industry,
        advisor: d.assignedTo
          ? `${d.assignedTo.firstName} ${d.assignedTo.lastName}`
          : 'Sin asignar',
        advisorId: d.assignedToId || null,
        lastContactedAt: d.lastContactedAt,
        createdAt: d.createdAt,
        contactAttempts: taskCountMap.get(d.id) || 0,
        daysSinceContact,
      };
    });

    // Get distinct filter values for dropdowns
    const dealWhere: any = { deletedAt: null, isHistorical: false, status: { in: DEAL_STAGES } };

    const [zones, industries, advisors] = await Promise.all([
      this.prisma.lead.findMany({
        where: dealWhere,
        select: { zone: true },
        distinct: ['zone'],
      }),
      this.prisma.lead.findMany({
        where: { ...dealWhere, industry: { not: null } },
        select: { industry: true },
        distinct: ['industry'],
      }),
      this.prisma.user.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          assignedLeads: { some: { deletedAt: null, status: { in: DEAL_STAGES as any } } },
        },
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      filters: {
        stages: DEAL_STAGES.map((s: string) => ({
          value: s,
          label: STAGE_LABELS[s] || s,
        })),
        advisors: (advisors as any[]).map((a: any) => ({
          id: a.id,
          name: `${a.firstName} ${a.lastName}`,
        })),
        zones: (zones as any[]).map((z: any) => z.zone as string),
        industries: (industries as any[])
          .map((i: any) => i.industry as string)
          .filter((v: any) => v != null),
      },
    };
  }
}
