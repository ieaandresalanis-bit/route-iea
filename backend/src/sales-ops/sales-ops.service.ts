import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PriorityEngineService } from '../priority-engine/priority-engine.service';

/** Terminal statuses — excluded from active pipeline and ops alerts */
const TERMINAL_STATUSES = ['CERRADO_GANADO', 'CERRADO_PERDIDO', 'LEAD_BASURA', 'CONTACTAR_FUTURO'];

@Injectable()
export class SalesOpsService {
  constructor(
    private prisma: PrismaService,
    private priorityEngine: PriorityEngineService,
  ) {}

  /** Leads with follow-up date <= today that haven't been followed up */
  async getFollowUps() {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const visits = await this.prisma.visit.findMany({
      where: {
        followUpDate: { lte: today },
        lead: { deletedAt: null, isHistorical: false, status: { notIn: TERMINAL_STATUSES as any } },
      },
      include: {
        lead: {
          select: {
            id: true,
            companyName: true,
            contactName: true,
            contactPhone: true,
            zone: true,
            status: true,
            estimatedValue: true,
          },
        },
        visitedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { followUpDate: 'asc' },
    });

    return visits.map((v) => ({
      visitId: v.id,
      followUpDate: v.followUpDate,
      followUpNotes: v.followUpNotes,
      outcome: v.outcome,
      lead: v.lead,
      advisor: v.visitedBy,
    }));
  }

  /** Leads with no contact in 14+ days (or never contacted) that are still active */
  async getInactive() {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const leads = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        isHistorical: false,
        status: { notIn: TERMINAL_STATUSES as any },
        OR: [
          { lastContactedAt: null },
          { lastContactedAt: { lt: fourteenDaysAgo } },
        ],
      },
      select: {
        id: true,
        companyName: true,
        contactName: true,
        contactPhone: true,
        zone: true,
        status: true,
        source: true,
        estimatedValue: true,
        lastContactedAt: true,
        createdAt: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { estimatedValue: { sort: 'desc', nulls: 'last' } },
    });

    return leads.map((l) => {
      const scored = this.priorityEngine.scoreLead(l);
      return {
        ...l,
        daysSinceContact: scored.daysSinceContact,
        score: scored.score,
        probability: scored.probability,
        urgency: scored.urgency,
      };
    });
  }

  /** Top priority-scored leads via Priority Engine */
  async getPriority() {
    return this.priorityEngine.getTopLeadsOfDay(20);
  }

  /** Top deals to push forward */
  async getDealsToPush() {
    return this.priorityEngine.getTopDealsToPush(10);
  }

  /** Priority lists grouped by advisor */
  async getAdvisorPriorities() {
    return this.priorityEngine.getAdvisorPriorityLists();
  }

  /** Daily summary counts */
  async getDailySummary() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const [followUpsToday, overdue, inactive, newThisWeek] = await Promise.all([
      this.prisma.visit.count({
        where: {
          followUpDate: { gte: today, lt: tomorrow },
          lead: { deletedAt: null, isHistorical: false, status: { notIn: TERMINAL_STATUSES as any } },
        },
      }),
      this.prisma.visit.count({
        where: {
          followUpDate: { lt: today },
          lead: { deletedAt: null, isHistorical: false, status: { notIn: TERMINAL_STATUSES as any } },
        },
      }),
      this.prisma.lead.count({
        where: {
          deletedAt: null,
          isHistorical: false,
          status: { notIn: TERMINAL_STATUSES as any },
          OR: [
            { lastContactedAt: null },
            { lastContactedAt: { lt: fourteenDaysAgo } },
          ],
        },
      }),
      this.prisma.lead.count({
        where: { deletedAt: null, isHistorical: false, createdAt: { gte: weekAgo } },
      }),
    ]);

    return { followUpsToday, overdue, inactive, newThisWeek };
  }
}
