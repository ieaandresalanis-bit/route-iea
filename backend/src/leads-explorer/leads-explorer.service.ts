import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

interface LeadsFilters {
  page?: number;
  limit?: number;
  search?: string;
  zone?: string;
  industry?: string;
  advisorId?: string;
  status?: string;
  source?: string;
  dateFrom?: string;
  dateTo?: string;
  minValue?: number;
  maxValue?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

@Injectable()
export class LeadsExplorerService {
  constructor(private prisma: PrismaService) {}

  async getLeads(filters: LeadsFilters) {
    const page = filters.page || 1;
    const limit = filters.limit || 25;
    const skip = (page - 1) * limit;

    // Build dynamic where clause
    const where: any = { deletedAt: null, isHistorical: false };

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

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.source) {
      where.source = filters.source;
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

    if (filters.minValue !== undefined || filters.maxValue !== undefined) {
      where.estimatedValue = {};
      if (filters.minValue !== undefined) {
        where.estimatedValue.gte = filters.minValue;
      }
      if (filters.maxValue !== undefined) {
        where.estimatedValue.lte = filters.maxValue;
      }
    }

    // Build orderBy
    const sortBy = filters.sortBy || 'createdAt';
    const sortDir = filters.sortDir || 'desc';
    const orderBy: any = { [sortBy]: sortDir };

    // Fetch leads + total count in parallel
    const [leads, total] = await Promise.all([
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
          contactEmail: true,
          zone: true,
          industry: true,
          status: true,
          source: true,
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
    const leadIds = (leads as any[]).map((l: any) => l.id);
    const taskCounts = leadIds.length > 0
      ? await this.prisma.salesTask.groupBy({
          by: ['leadId'],
          where: { leadId: { in: leadIds } },
          _count: { id: true },
        })
      : [];
    const taskCountMap = new Map<string, number>(
      (taskCounts as any[]).map((t: any) => [t.leadId, t._count.id]),
    );

    // Map results
    const items = (leads as any[]).map((l: any) => ({
      id: l.id,
      companyName: l.companyName,
      contactName: l.contactName,
      contactPhone: l.contactPhone,
      contactEmail: l.contactEmail,
      zone: l.zone,
      industry: l.industry,
      status: l.status,
      source: l.source,
      estimatedValue: l.estimatedValue,
      advisor: l.assignedTo
        ? `${l.assignedTo.firstName} ${l.assignedTo.lastName}`
        : 'Sin asignar',
      advisorId: l.assignedToId || null,
      lastContactedAt: l.lastContactedAt,
      createdAt: l.createdAt,
      contactAttempts: taskCountMap.get(l.id) || 0,
    }));

    // Get distinct filter values for dropdowns
    const [zones, industries, sources, advisors, statuses] = await Promise.all([
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false },
        select: { zone: true },
        distinct: ['zone'],
      }),
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false, industry: { not: null } },
        select: { industry: true },
        distinct: ['industry'],
      }),
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false },
        select: { source: true },
        distinct: ['source'],
      }),
      this.prisma.user.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          assignedLeads: { some: { deletedAt: null } },
        },
        select: { id: true, firstName: true, lastName: true },
      }),
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false },
        select: { status: true },
        distinct: ['status'],
      }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      filters: {
        zones: (zones as any[]).map((z: any) => z.zone as string),
        industries: (industries as any[])
          .map((i: any) => i.industry as string)
          .filter((v: any) => v != null),
        sources: (sources as any[]).map((s: any) => s.source as string),
        advisors: (advisors as any[]).map((a: any) => ({
          id: a.id,
          name: `${a.firstName} ${a.lastName}`,
        })),
        statuses: (statuses as any[]).map((s: any) => s.status as string),
      },
    };
  }
}
