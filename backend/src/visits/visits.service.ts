import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateVisitDto, CheckInDto } from './dto/create-visit.dto';

@Injectable()
export class VisitsService {
  private readonly logger = new Logger(VisitsService.name);

  constructor(private prisma: PrismaService) {}

  async create(dto: CreateVisitDto) {
    const visit = await this.prisma.visit.create({
      data: {
        ...dto,
        visitDate: new Date(dto.visitDate),
        followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : undefined,
      },
      include: {
        lead: { select: { id: true, companyName: true } },
        visitedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Update lead's lastContactedAt
    await this.prisma.lead.update({
      where: { id: dto.leadId },
      data: { lastContactedAt: new Date(dto.visitDate) },
    });

    this.logger.log(`Visit created: ${visit.id} for lead ${dto.leadId}`);
    return visit;
  }

  async findAll(query: {
    leadId?: string;
    visitedById?: string;
    outcome?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    return this.prisma.visit.findMany({
      where: {
        ...(query.leadId ? { leadId: query.leadId } : {}),
        ...(query.visitedById ? { visitedById: query.visitedById } : {}),
        ...(query.outcome ? { outcome: query.outcome as any } : {}),
        ...(query.dateFrom || query.dateTo
          ? {
              visitDate: {
                ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
                ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
              },
            }
          : {}),
      },
      include: {
        lead: { select: { id: true, companyName: true, contactName: true } },
        visitedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { visitDate: 'desc' },
    });
  }

  async findOne(id: string) {
    const visit = await this.prisma.visit.findUnique({
      where: { id },
      include: {
        lead: true,
        visitedBy: { select: { id: true, firstName: true, lastName: true } },
        route: { select: { id: true, name: true } },
      },
    });
    if (!visit) throw new NotFoundException(`Visit ${id} not found`);
    return visit;
  }

  async update(id: string, data: Partial<CreateVisitDto>) {
    await this.findOne(id);
    return this.prisma.visit.update({
      where: { id },
      data: {
        ...data,
        visitDate: data.visitDate ? new Date(data.visitDate) : undefined,
        followUpDate: data.followUpDate ? new Date(data.followUpDate) : undefined,
      },
    });
  }

  async checkIn(id: string, dto: CheckInDto) {
    await this.findOne(id);
    return this.prisma.visit.update({
      where: { id },
      data: {
        checkInLat: dto.latitude,
        checkInLng: dto.longitude,
        checkInAt: new Date(),
      },
    });
  }

  async checkOut(id: string, dto: CheckInDto) {
    await this.findOne(id);
    return this.prisma.visit.update({
      where: { id },
      data: {
        checkOutLat: dto.latitude,
        checkOutLng: dto.longitude,
        checkOutAt: new Date(),
      },
    });
  }
}
