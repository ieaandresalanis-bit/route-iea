import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LeadStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

// ── Constants ────────────────────────────────────────────────────

const CURRENT_TEAM_EMAILS = [
  'jaime.nav@iealanis.com',
  'j.pimentel@iealanis.com',
  'atencion@iealanis.com',
  'jenifer@iealanis.com',
  'mariana@iealanis.com',
];

const MAIN_ACCOUNT_EMAIL = 'comercial@iealanis.com';

const CURRENT_TEAM_DEPT = 'Comercial Activo';
const HISTORICAL_TEAM_DEPT = 'Comercial Historico';

// ── Helpers ──────────────────────────────────────────────────────

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round(
    Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24),
  );
}

function workloadCapacity(
  activeLeads: number,
): 'low' | 'medium' | 'high' | 'overloaded' {
  if (activeLeads <= 15) return 'low';
  if (activeLeads <= 30) return 'medium';
  if (activeLeads <= 50) return 'high';
  return 'overloaded';
}

// Statuses considered "active" (not closed/garbage)
const ACTIVE_STATUSES: LeadStatus[] = [
  LeadStatus.PENDIENTE_CONTACTAR,
  LeadStatus.INTENTANDO_CONTACTAR,
  LeadStatus.EN_PROSPECCION,
  LeadStatus.AGENDAR_CITA,
  LeadStatus.ESPERANDO_COTIZACION,
  LeadStatus.COTIZACION_ENTREGADA,
  LeadStatus.ESPERANDO_CONTRATO,
  LeadStatus.PENDIENTE_PAGO,
  LeadStatus.CONTACTAR_FUTURO,
];

const CLOSING_STATUSES: LeadStatus[] = [
  LeadStatus.COTIZACION_ENTREGADA,
  LeadStatus.ESPERANDO_CONTRATO,
  LeadStatus.PENDIENTE_PAGO,
];

// ── Service ──────────────────────────────────────────────────────

@Injectable()
export class TeamManagementService {
  private readonly logger = new Logger(TeamManagementService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ================================================================
  // 1. getTeamStructure
  // ================================================================
  async getTeamStructure() {
    // Fetch all commercial users (current + historical)
    const allAdvisors = await this.prisma.user.findMany({
      where: {
        OR: [
          { department: CURRENT_TEAM_DEPT },
          { department: HISTORICAL_TEAM_DEPT },
          { email: { in: [...CURRENT_TEAM_EMAILS, MAIN_ACCOUNT_EMAIL] } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        department: true,
        isActive: true,
      },
    });

    const now = new Date();
    const thirtyDaysAgo = daysAgo(30);

    const buildAdvisorData = async (user: (typeof allAdvisors)[0]) => {
      const isCurrentTeam =
        CURRENT_TEAM_EMAILS.includes(user.email) ||
        user.department === CURRENT_TEAM_DEPT;

      // Lead counts by status groups
      const leads = await this.prisma.lead.findMany({
        where: { assignedToId: user.id, deletedAt: null, isHistorical: false },
        select: { status: true, estimatedValue: true },
      });

      const total = leads.length;
      const active = leads.filter((l) =>
        ACTIVE_STATUSES.includes(l.status),
      ).length;
      const won = leads.filter((l) => l.status === 'CERRADO_GANADO').length;
      const lost = leads.filter((l) => l.status === 'CERRADO_PERDIDO').length;

      // Pipeline (active leads only)
      const activeLeads = leads.filter((l) =>
        ACTIVE_STATUSES.includes(l.status),
      );
      const pipelineValue = activeLeads.reduce(
        (sum, l) => sum + (l.estimatedValue || 0),
        0,
      );
      const avgTicket =
        activeLeads.length > 0 ? pipelineValue / activeLeads.length : 0;

      // Visits in last 30 days
      const visitsLast30d = await this.prisma.visit.count({
        where: {
          visitedById: user.id,
          visitDate: { gte: thirtyDaysAgo },
        },
      });

      const lastVisit = await this.prisma.visit.findFirst({
        where: { visitedById: user.id },
        orderBy: { visitDate: 'desc' },
        select: { visitDate: true },
      });

      // Last contact from leads
      const lastContact = await this.prisma.lead.findFirst({
        where: {
          assignedToId: user.id,
          lastContactedAt: { not: null },
          deletedAt: null,
          isHistorical: false,
        },
        orderBy: { lastContactedAt: 'desc' },
        select: { lastContactedAt: true },
      });

      // Performance: conversion rate
      const closedLeads = won + lost;
      const conversionRate =
        closedLeads > 0 ? Math.round((won / closedLeads) * 100 * 10) / 10 : 0;

      // Avg cycle time: days from createdAt to convertedAt for won leads
      const wonLeadsWithDates = await this.prisma.lead.findMany({
        where: {
          assignedToId: user.id,
          status: 'CERRADO_GANADO',
          convertedAt: { not: null },
          deletedAt: null,
          isHistorical: false,
        },
        select: { createdAt: true, convertedAt: true },
      });
      const cycleTimes = wonLeadsWithDates
        .filter((l) => l.convertedAt)
        .map((l) => daysBetween(l.createdAt, l.convertedAt!));
      const avgCycleTime =
        cycleTimes.length > 0
          ? Math.round(
              cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length,
            )
          : 0;

      const workloadScore = active;
      const capacity = workloadCapacity(active);

      return {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        isCurrentTeam,
        leads: { total, active, won, lost },
        pipeline: {
          value: pipelineValue,
          deals: activeLeads.length,
          avgTicket: Math.round(avgTicket),
        },
        activity: {
          visitsLast30d,
          lastVisitDate: lastVisit?.visitDate ?? null,
          lastContactDate: lastContact?.lastContactedAt ?? null,
        },
        performance: { conversionRate, avgCycleTime },
        workload: { score: workloadScore, capacity },
      };
    };

    const advisorData = await Promise.all(allAdvisors.map(buildAdvisorData));

    const currentTeam = advisorData.filter((a) => a.isCurrentTeam);
    const historicalAdvisors = advisorData.filter((a) => !a.isCurrentTeam);

    // Unassigned leads
    const unassignedLeads = await this.prisma.lead.findMany({
      where: {
        assignedToId: null,
        deletedAt: null,
        isHistorical: false,
        status: { in: ACTIVE_STATUSES },
      },
      select: { estimatedValue: true },
    });

    // Main account
    const mainUser = allAdvisors.find((u) => u.email === MAIN_ACCOUNT_EMAIL);
    let mainAccountLeads = 0;
    let mainAccountValue = 0;
    if (mainUser) {
      const mainLeads = await this.prisma.lead.findMany({
        where: {
          assignedToId: mainUser.id,
          deletedAt: null,
          isHistorical: false,
          status: { in: ACTIVE_STATUSES },
        },
        select: { estimatedValue: true },
      });
      mainAccountLeads = mainLeads.length;
      mainAccountValue = mainLeads.reduce(
        (sum, l) => sum + (l.estimatedValue || 0),
        0,
      );
    }

    return {
      currentTeam,
      historicalAdvisors,
      unassigned: {
        leads: unassignedLeads.length,
        value: unassignedLeads.reduce(
          (sum, l) => sum + (l.estimatedValue || 0),
          0,
        ),
      },
      mainAccount: {
        email: MAIN_ACCOUNT_EMAIL,
        leads: mainAccountLeads,
        value: mainAccountValue,
        needsRedistribution: mainAccountLeads > 0,
      },
    };
  }

  // ================================================================
  // 2. getHistoricalOwnershipMap
  // ================================================================
  async getHistoricalOwnershipMap() {
    const leads = await this.prisma.lead.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        companyName: true,
        contactName: true,
        status: true,
        estimatedValue: true,
        lastContactedAt: true,
        zone: true,
        notes: true,
        assignedToId: true,
        assignedTo: {
          select: { email: true, firstName: true, lastName: true },
        },
      },
    });

    const now = new Date();

    return leads.map((lead) => {
      // Try to extract original owner from notes (Zoho: ... | Source: ...)
      let originalOwnerEmail = lead.assignedTo?.email || 'unknown';
      if (lead.notes) {
        const zohoMatch = lead.notes.match(
          /(?:Zoho|Propietario original):\s*([^\s|]+@[^\s|]+)/i,
        );
        if (zohoMatch) {
          originalOwnerEmail = zohoMatch[1];
        }
      }

      const daysSinceContact = lead.lastContactedAt
        ? daysBetween(lead.lastContactedAt, now)
        : null;

      const currentOwnerEmail = lead.assignedTo?.email || null;
      const needsReassignment =
        !currentOwnerEmail ||
        (!CURRENT_TEAM_EMAILS.includes(currentOwnerEmail) &&
          currentOwnerEmail !== MAIN_ACCOUNT_EMAIL);

      return {
        leadId: lead.id,
        companyName: lead.companyName,
        contactName: lead.contactName,
        currentOwnerEmail,
        currentOwnerName: lead.assignedTo
          ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`
          : null,
        originalOwnerEmail,
        status: lead.status,
        estimatedValue: lead.estimatedValue || 0,
        lastContactedAt: lead.lastContactedAt,
        daysSinceContact,
        zone: lead.zone,
        needsReassignment,
      };
    });
  }

  // ================================================================
  // 3. reassignLeads
  // ================================================================
  async reassignLeads(body: {
    leadIds: string[];
    targetAdvisorId: string;
    reason: 'redistribution' | 'recovery' | 'rebalance';
  }) {
    const targetAdvisor = await this.prisma.user.findUnique({
      where: { id: body.targetAdvisorId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    if (!targetAdvisor) {
      throw new NotFoundException(
        `Advisor ${body.targetAdvisorId} not found`,
      );
    }

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    let reassigned = 0;
    const errors: string[] = [];

    for (const leadId of body.leadIds) {
      try {
        const lead = await this.prisma.lead.findUnique({
          where: { id: leadId },
          select: {
            id: true,
            notes: true,
            assignedTo: {
              select: { firstName: true, lastName: true, email: true },
            },
          },
        });

        if (!lead) {
          errors.push(`Lead ${leadId} not found`);
          continue;
        }

        const oldName = lead.assignedTo
          ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`
          : 'Sin asignar';
        const newName = `${targetAdvisor.firstName} ${targetAdvisor.lastName}`;
        const noteAppend = `\nReasignado de ${oldName} a ${newName} el ${dateStr}. Razón: ${body.reason}`;

        await this.prisma.lead.update({
          where: { id: leadId },
          data: {
            assignedToId: targetAdvisor.id,
            notes: lead.notes ? lead.notes + noteAppend : noteAppend.trim(),
          },
        });

        reassigned++;
      } catch (err) {
        errors.push(`Error reassigning lead ${leadId}: ${err.message}`);
      }
    }

    this.logger.log(
      `Reassigned ${reassigned}/${body.leadIds.length} leads to ${targetAdvisor.email} (reason: ${body.reason})`,
    );

    return {
      reassigned,
      targetAdvisor: {
        id: targetAdvisor.id,
        name: `${targetAdvisor.firstName} ${targetAdvisor.lastName}`,
        email: targetAdvisor.email,
      },
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // ================================================================
  // 4. autoDistribute
  // ================================================================
  async autoDistribute() {
    // Find the current team members
    const currentTeam = await this.prisma.user.findMany({
      where: {
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    if (currentTeam.length === 0) {
      return { reassigned: 0, byAdvisor: {}, skipped: 0, error: 'No current team members found in database' };
    }

    const currentTeamIds = new Set(currentTeam.map((u) => u.id));

    // Find all active leads NOT assigned to current team
    const leadsToDistribute = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        isHistorical: false,
        status: { in: ACTIVE_STATUSES },
        OR: [
          { assignedToId: null },
          {
            assignedTo: {
              isActive: false,
            },
          },
        ],
      },
      select: {
        id: true,
        notes: true,
        zone: true,
        estimatedValue: true,
        assignedTo: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { estimatedValue: 'desc' },
    });

    // Build workload map: advisorId -> active lead count
    const workloadMap: Record<string, number> = {};
    for (const member of currentTeam) {
      const count = await this.prisma.lead.count({
        where: {
          assignedToId: member.id,
          deletedAt: null,
          isHistorical: false,
          status: { in: ACTIVE_STATUSES },
        },
      });
      workloadMap[member.id] = count;
    }

    // Build zone concentration map: advisorId -> zone -> count
    const zoneMap: Record<string, Record<string, number>> = {};
    for (const member of currentTeam) {
      const zoneLeads = await this.prisma.lead.groupBy({
        by: ['zone'],
        where: {
          assignedToId: member.id,
          deletedAt: null,
          isHistorical: false,
          status: { in: ACTIVE_STATUSES },
        },
        _count: { _all: true },
      });
      zoneMap[member.id] = {};
      for (const z of zoneLeads) {
        zoneMap[member.id][z.zone] = z._count._all;
      }
    }

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    let reassigned = 0;
    let skipped = 0;
    const byAdvisor: Record<string, number> = {};

    for (const member of currentTeam) {
      byAdvisor[member.email] = 0;
    }

    for (const lead of leadsToDistribute) {
      // Find advisor with lowest workload, preferring zone match
      let bestAdvisor = currentTeam[0];
      let bestScore = Infinity;

      for (const member of currentTeam) {
        const load = workloadMap[member.id] || 0;
        // Zone bonus: subtract 2 from score if advisor has concentration in this zone
        const zoneBonus =
          (zoneMap[member.id]?.[lead.zone] || 0) > 0 ? -2 : 0;
        const score = load + zoneBonus;

        if (score < bestScore) {
          bestScore = score;
          bestAdvisor = member;
        }
      }

      try {
        const oldName = lead.assignedTo
          ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`
          : 'Sin asignar';
        const oldEmail = lead.assignedTo?.email || 'sin asignar';
        const noteAppend = `\nAuto-redistribuido de ${oldName} el ${dateStr}. Propietario original: ${oldEmail}`;

        await this.prisma.lead.update({
          where: { id: lead.id },
          data: {
            assignedToId: bestAdvisor.id,
            notes: lead.notes ? lead.notes + noteAppend : noteAppend.trim(),
          },
        });

        workloadMap[bestAdvisor.id] = (workloadMap[bestAdvisor.id] || 0) + 1;
        // Update zone map too
        if (!zoneMap[bestAdvisor.id]) zoneMap[bestAdvisor.id] = {};
        zoneMap[bestAdvisor.id][lead.zone] =
          (zoneMap[bestAdvisor.id][lead.zone] || 0) + 1;

        byAdvisor[bestAdvisor.email] =
          (byAdvisor[bestAdvisor.email] || 0) + 1;
        reassigned++;
      } catch (err) {
        this.logger.error(`Failed to auto-distribute lead ${lead.id}: ${err.message}`);
        skipped++;
      }
    }

    this.logger.log(
      `Auto-distribution complete: ${reassigned} reassigned, ${skipped} skipped`,
    );

    return { reassigned, byAdvisor, skipped };
  }

  // ================================================================
  // 5. getRecoveryOpportunities
  // ================================================================
  async getRecoveryOpportunities() {
    const now = new Date();

    const allActiveLeads = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        isHistorical: false,
        status: { in: ACTIVE_STATUSES },
      },
      select: {
        id: true,
        companyName: true,
        contactName: true,
        status: true,
        estimatedValue: true,
        lastContactedAt: true,
        zone: true,
        createdAt: true,
        assignedTo: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    const enrichLead = (lead: (typeof allActiveLeads)[0]) => {
      const daysSinceContact = lead.lastContactedAt
        ? daysBetween(lead.lastContactedAt, now)
        : null;
      return {
        id: lead.id,
        companyName: lead.companyName,
        contactName: lead.contactName,
        status: lead.status,
        estimatedValue: lead.estimatedValue || 0,
        lastContactedAt: lead.lastContactedAt,
        daysSinceContact,
        assignedTo: lead.assignedTo
          ? {
              name: `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`,
              email: lead.assignedTo.email,
            }
          : null,
        zone: lead.zone,
      };
    };

    const critical = allActiveLeads
      .filter(
        (l) =>
          l.lastContactedAt &&
          daysBetween(l.lastContactedAt, now) >= 60 &&
          (l.estimatedValue || 0) > 100000,
      )
      .map(enrichLead);

    const high = allActiveLeads
      .filter(
        (l) =>
          l.lastContactedAt &&
          daysBetween(l.lastContactedAt, now) >= 30 &&
          (l.estimatedValue || 0) > 50000,
      )
      .map(enrichLead);

    const medium = allActiveLeads
      .filter(
        (l) =>
          l.lastContactedAt && daysBetween(l.lastContactedAt, now) >= 30,
      )
      .map(enrichLead);

    const stale = allActiveLeads
      .filter(
        (l) =>
          l.lastContactedAt && daysBetween(l.lastContactedAt, now) >= 90,
      )
      .map(enrichLead);

    const abandoned = allActiveLeads
      .filter(
        (l) =>
          (l.status === 'PENDIENTE_CONTACTAR' ||
            l.status === 'INTENTANDO_CONTACTAR') &&
          daysBetween(l.createdAt, now) > 30,
      )
      .map(enrichLead);

    const totalValue = allActiveLeads.reduce(
      (sum, l) => sum + (l.estimatedValue || 0),
      0,
    );

    return { critical, high, medium, stale, abandoned, totalValue };
  }

  // ================================================================
  // 6. getAdvisorDailyTargets
  // ================================================================
  async getAdvisorDailyTargets(advisorId: string) {
    const advisor = await this.prisma.user.findUnique({
      where: { id: advisorId },
      select: { id: true, firstName: true, lastName: true },
    });

    if (!advisor) {
      throw new NotFoundException(`Advisor ${advisorId} not found`);
    }

    const now = new Date();

    const advisorLeads = await this.prisma.lead.findMany({
      where: {
        assignedToId: advisorId,
        deletedAt: null,
        isHistorical: false,
        status: { in: ACTIVE_STATUSES },
      },
      select: {
        id: true,
        companyName: true,
        contactName: true,
        status: true,
        estimatedValue: true,
        lastContactedAt: true,
        zone: true,
      },
    });

    const enrichLead = (lead: (typeof advisorLeads)[0]) => {
      const daysSinceContact = lead.lastContactedAt
        ? daysBetween(lead.lastContactedAt, now)
        : null;
      return { ...lead, daysSinceContact };
    };

    // Recovery: not contacted in 14+ days
    const recoveryTargets = advisorLeads
      .filter(
        (l) =>
          !l.lastContactedAt ||
          daysBetween(l.lastContactedAt, now) >= 14,
      )
      .map(enrichLead);

    // Hot leads to close
    const hotLeadsToClose = advisorLeads
      .filter((l) =>
        CLOSING_STATUSES.includes(l.status),
      )
      .map(enrichLead);

    // Reactivation: CONTACTAR_FUTURO or AGENDAR_CITA, not contacted 7+ days
    const reactivationList = advisorLeads
      .filter(
        (l) =>
          (l.status === 'CONTACTAR_FUTURO' || l.status === 'AGENDAR_CITA') &&
          (!l.lastContactedAt ||
            daysBetween(l.lastContactedAt, now) >= 7),
      )
      .map(enrichLead);

    // Today's priority: top 10 by composite score (value * urgency)
    const scored = advisorLeads.map((l) => {
      const daysSince = l.lastContactedAt
        ? daysBetween(l.lastContactedAt, now)
        : 999;
      const urgencyMultiplier = Math.min(daysSince / 7, 10); // caps at 10x
      const value = l.estimatedValue || 0;
      const compositeScore = value * urgencyMultiplier;
      return { ...enrichLead(l), compositeScore };
    });

    scored.sort((a, b) => b.compositeScore - a.compositeScore);
    const todaysPriority = scored.slice(0, 10).map(({ compositeScore, ...rest }) => rest);

    return {
      advisorName: `${advisor.firstName} ${advisor.lastName}`,
      recoveryTargets,
      hotLeadsToClose,
      reactivationList,
      todaysPriority,
    };
  }

  // ================================================================
  // 7. markCurrentTeam
  // ================================================================
  async markCurrentTeam(emails: string[]) {
    // Set all commercial users to historical first
    await this.prisma.user.updateMany({
      where: {
        department: { in: [CURRENT_TEAM_DEPT, HISTORICAL_TEAM_DEPT] },
      },
      data: { department: HISTORICAL_TEAM_DEPT },
    });

    // Set specified emails as current team
    const result = await this.prisma.user.updateMany({
      where: { email: { in: emails } },
      data: { department: CURRENT_TEAM_DEPT },
    });

    this.logger.log(
      `Marked ${result.count} users as current team: ${emails.join(', ')}`,
    );

    return {
      updated: result.count,
      emails,
      department: CURRENT_TEAM_DEPT,
    };
  }
}
