import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const STAGE_ORDER = [
  'PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR', 'EN_PROSPECCION',
  'AGENDAR_CITA', 'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO', 'CERRADO_GANADO', 'CERRADO_PERDIDO',
];

const STAGE_LABELS: Record<string, string> = {
  PENDIENTE_CONTACTAR: 'Pendiente Contactar',
  INTENTANDO_CONTACTAR: 'Intentando Contactar',
  EN_PROSPECCION: 'En Prospeccion',
  AGENDAR_CITA: 'Agendar Cita',
  ESPERANDO_COTIZACION: 'Esperando Cotizacion',
  COTIZACION_ENTREGADA: 'Cotizacion Entregada',
  ESPERANDO_CONTRATO: 'Esperando Contrato',
  PENDIENTE_PAGO: 'Pendiente de Pago',
  CERRADO_GANADO: 'Cerrado Ganado',
  CERRADO_PERDIDO: 'Cerrado Perdido',
};

/** Probability weights per stage for weighted pipeline value */
const STAGE_PROBABILITY: Record<string, number> = {
  PENDIENTE_CONTACTAR: 0.05,
  INTENTANDO_CONTACTAR: 0.10,
  EN_PROSPECCION: 0.15,
  AGENDAR_CITA: 0.25,
  ESPERANDO_COTIZACION: 0.40,
  COTIZACION_ENTREGADA: 0.60,
  ESPERANDO_CONTRATO: 0.80,
  PENDIENTE_PAGO: 0.90,
};

const CLOSING_STAGES = [
  'COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO',
];

const ACTIVE_STAGES = [
  'PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR', 'EN_PROSPECCION',
  'AGENDAR_CITA', 'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO',
];

/** Keyword labels to detect in notes */
const KEYWORD_LABELS = ['URGENTE', 'VIP', 'SEGUIMIENTO', 'PERDIDO'];

// ═══════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════

export interface PipelineFilters {
  advisorId?: string;
  zone?: string;
  source?: string;
  industry?: string;
  billRange?: string;
  minAmount?: number;
  maxAmount?: number;
  stage?: string;
  dateFrom?: string;
  dateTo?: string;
  label?: string;
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysBetween(a: Date, b: Date): number {
  const ms = Math.abs(b.getTime() - a.getTime());
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/** Extract labels/tags from a notes string */
function extractLabels(notes: string | null | undefined): string[] {
  if (!notes) return [];
  const labels: string[] = [];

  // Bracket tags: [tag]
  const bracketMatches = notes.match(/\[([^\]]+)\]/g);
  if (bracketMatches) {
    bracketMatches.forEach((m: any) => {
      labels.push(m.replace(/[[\]]/g, '').trim());
    });
  }

  // Hashtag tags: #tag (word chars)
  const hashMatches = notes.match(/#(\w+)/g);
  if (hashMatches) {
    hashMatches.forEach((m: any) => {
      labels.push(m.replace('#', '').trim());
    });
  }

  // "X cerrar Name" patterns
  const cerrarMatch = notes.match(/\bcerrar\s+([^\n,;]+)/gi);
  if (cerrarMatch) {
    cerrarMatch.forEach((m: any) => {
      labels.push(m.trim());
    });
  }

  // "Reactivar Name" patterns
  const reactivarMatch = notes.match(/\breactivar\s+([^\n,;]+)/gi);
  if (reactivarMatch) {
    reactivarMatch.forEach((m: any) => {
      labels.push(m.trim());
    });
  }

  // Keyword labels
  const upper = notes.toUpperCase();
  KEYWORD_LABELS.forEach((kw: any) => {
    if (upper.includes(kw)) {
      labels.push(kw);
    }
  });

  return labels;
}

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

@Injectable()
export class PipelineIntelligenceService {
  constructor(private prisma: PrismaService) {}

  // ─── MAIN PIPELINE ─────────────────────────────────────

  async getPipeline(filters: PipelineFilters) {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const where = this.buildWhere(filters);

    // Fetch leads, users, and pipeline-move tasks in parallel
    const [leads, users, moveTasks] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        select: {
          id: true, companyName: true, contactName: true,
          contactPhone: true, contactEmail: true,
          estimatedValue: true, zone: true, source: true,
          industry: true, billRange: true, status: true,
          assignedToId: true, lastContactedAt: true,
          notes: true, financingType: true,
          createdAt: true, updatedAt: true,
        },
      }),
      this.prisma.user.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, firstName: true, lastName: true },
      }),
      this.prisma.salesTask.findMany({
        where: {
          isHistorical: false,
          pipelineMoved: true,
          createdAt: { gte: thirtyDaysAgo },
        },
        select: { leadId: true, previousStage: true, createdAt: true },
      }),
    ]);

    const ll: any[] = leads;
    const userMap = new Map<string, string>(
      users.map((u: any) => [u.id, `${u.firstName} ${u.lastName}`]),
    );

    // If label filter, post-filter leads whose notes contain the label
    let filtered = ll;
    if (filters.label) {
      const lbl = filters.label.toLowerCase();
      filtered = ll.filter((l: any) => {
        if (!l.notes) return false;
        return l.notes.toLowerCase().includes(lbl);
      });
    }

    // ── SUMMARY ──
    const totalLeads = filtered.length;
    const totalValue = filtered.reduce((s: number, l: any) => s + (l.estimatedValue || 0), 0);
    const avgDealSize = totalLeads > 0 ? round2(totalValue / totalLeads) : 0;

    // By source
    const sourceMap = new Map<string, { count: number; value: number }>();
    filtered.forEach((l: any) => {
      const src = l.source || 'OTHER';
      const entry = sourceMap.get(src) || { count: 0, value: 0 };
      entry.count++;
      entry.value += l.estimatedValue || 0;
      sourceMap.set(src, entry);
    });
    const totalBySource = Array.from(sourceMap.entries()).map(([source, data]: any) => ({
      source,
      count: data.count,
      value: round2(data.value),
    })).sort((a: any, b: any) => b.count - a.count);

    // By advisor
    const advisorMap = new Map<string, { count: number; value: number }>();
    filtered.forEach((l: any) => {
      const aid = l.assignedToId || '__unassigned__';
      const entry = advisorMap.get(aid) || { count: 0, value: 0 };
      entry.count++;
      entry.value += l.estimatedValue || 0;
      advisorMap.set(aid, entry);
    });
    const totalByAdvisor = Array.from(advisorMap.entries()).map(([advisorId, data]: any) => ({
      advisorId: advisorId === '__unassigned__' ? null : advisorId,
      advisorName: advisorId === '__unassigned__' ? 'Sin asignar' : (userMap.get(advisorId) || 'Desconocido'),
      count: data.count,
      value: round2(data.value),
    })).sort((a: any, b: any) => b.count - a.count);

    // Weighted pipeline
    const weightedPipeline = round2(
      filtered.reduce((s: number, l: any) => {
        const prob = STAGE_PROBABILITY[l.status] || 0;
        return s + (l.estimatedValue || 0) * prob;
      }, 0),
    );

    const summary = {
      totalLeads,
      totalValue: round2(totalValue),
      avgDealSize,
      totalBySource,
      totalByAdvisor,
      weightedPipeline,
    };

    // ── STAGE MOVE COUNTS (for advance / dropoff rates) ──
    const movesByStage = new Map<string, number>();
    moveTasks.forEach((t: any) => {
      if (t.previousStage) {
        movesByStage.set(t.previousStage, (movesByStage.get(t.previousStage) || 0) + 1);
      }
    });

    // Count leads per stage for 30-day window (for drop-off approximation)
    const stageCountAll = new Map<string, number>();
    filtered.forEach((l: any) => {
      stageCountAll.set(l.status, (stageCountAll.get(l.status) || 0) + 1);
    });

    // ── STAGES WITH LEADS ──
    const stages = STAGE_ORDER.map((stage: any) => {
      const inStage = filtered.filter((l: any) => l.status === stage);
      const stageValue = inStage.reduce((s: number, l: any) => s + (l.estimatedValue || 0), 0);

      // Avg time in stage: days between updatedAt and now (proxy)
      const daysArr = inStage.map((l: any) => daysBetween(new Date(l.updatedAt), now));
      const avgTimeInStage = daysArr.length > 0
        ? round2(daysArr.reduce((s: number, d: number) => s + d, 0) / daysArr.length)
        : 0;

      // Advance rate: leads moved FROM this stage in last 30 days / total in stage
      const movedFromStage = movesByStage.get(stage) || 0;
      const stageTotal = inStage.length + movedFromStage; // approximate denominator
      const advanceRate = stageTotal > 0 ? round2((movedFromStage / stageTotal) * 100) : 0;

      // Map leads
      const mappedLeads = inStage.map((l: any) => {
        const daysSinceContact = l.lastContactedAt
          ? daysBetween(new Date(l.lastContactedAt), now)
          : null;
        const daysInStage = daysBetween(new Date(l.updatedAt), now);
        const labels = extractLabels(l.notes);

        return {
          id: l.id,
          companyName: l.companyName,
          contactName: l.contactName,
          contactPhone: l.contactPhone || null,
          contactEmail: l.contactEmail || null,
          estimatedValue: l.estimatedValue || null,
          zone: l.zone,
          source: l.source,
          industry: l.industry || null,
          advisorId: l.assignedToId || null,
          advisorName: l.assignedToId ? (userMap.get(l.assignedToId) || null) : null,
          lastContactedAt: l.lastContactedAt ? l.lastContactedAt.toISOString() : null,
          daysSinceContact,
          daysInStage,
          labels,
          financingType: l.financingType || null,
          createdAt: l.createdAt.toISOString(),
        };
      });

      return {
        stage,
        label: STAGE_LABELS[stage] || stage,
        count: inStage.length,
        totalValue: round2(stageValue),
        avgTimeInStage,
        advanceRate,
        leads: mappedLeads,
      };
    });

    // ── STAGE ANALYTICS ──
    const stageAnalytics = STAGE_ORDER.map((stage: any, idx: number) => {
      const inStage = filtered.filter((l: any) => l.status === stage);
      const stageValue = inStage.reduce((s: number, l: any) => s + (l.estimatedValue || 0), 0);
      const daysArr = inStage.map((l: any) => daysBetween(new Date(l.updatedAt), now));
      const avgTimeInStage = daysArr.length > 0
        ? round2(daysArr.reduce((s: number, d: number) => s + d, 0) / daysArr.length)
        : 0;

      const movedFromStage = movesByStage.get(stage) || 0;
      const stageTotal = inStage.length + movedFromStage;
      const advanceRate = stageTotal > 0 ? round2((movedFromStage / stageTotal) * 100) : 0;

      // Drop-off rate: leads that went to CERRADO_PERDIDO or LEAD_BASURA from this stage
      // Approximate: check move tasks where previousStage = this stage and lead now in lost statuses
      const lostMoves = moveTasks.filter((t: any) => {
        if (t.previousStage !== stage) return false;
        const lead = filtered.find((l: any) => l.id === t.leadId);
        return lead && (lead.status === 'CERRADO_PERDIDO' || lead.status === 'LEAD_BASURA' || lead.status === 'INACTIVO');
      });
      const dropOffRate = stageTotal > 0 ? round2((lostMoves.length / stageTotal) * 100) : 0;

      return {
        stage,
        label: STAGE_LABELS[stage] || stage,
        count: inStage.length,
        totalValue: round2(stageValue),
        avgTimeInStage,
        advanceRate,
        dropOffRate,
      };
    });

    // ── ADVISOR WORKLOAD ──
    const advisorWorkload = await this.buildAdvisorWorkload(filtered, users, userMap);

    return { summary, stages, stageAnalytics, advisorWorkload };
  }

  // ─── WORKLOAD ──────────────────────────────────────────

  async getWorkload() {
    const [leads, users, tasks] = await Promise.all([
      this.prisma.lead.findMany({
        where: { isHistorical: false, deletedAt: null },
        select: {
          id: true, status: true, assignedToId: true,
          estimatedValue: true,
        },
      }),
      this.prisma.user.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, firstName: true, lastName: true },
      }),
      this.prisma.salesTask.findMany({
        where: { isHistorical: false, status: 'pending' },
        select: { advisorId: true },
      }),
    ]);

    const ll: any[] = leads;
    const tt: any[] = tasks;
    const userMap = new Map<string, string>(
      users.map((u: any) => [u.id, `${u.firstName} ${u.lastName}`]),
    );

    return this.buildAdvisorWorkload(ll, users, userMap, tt);
  }

  // ─── MOVE STAGE ────────────────────────────────────────

  async moveStage(leadId: string, newStage: string, userId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, status: true, assignedToId: true, companyName: true },
    });

    if (!lead) {
      return { error: 'Lead not found' };
    }

    const previousStage = (lead as any).status;

    // Update lead status and updatedAt
    const updated = await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        status: newStage as any,
        updatedAt: new Date(),
      },
    });

    // Record the pipeline move as a SalesTask
    await this.prisma.salesTask.create({
      data: {
        advisorId: (lead as any).assignedToId || userId,
        leadId,
        type: 'pipeline_move',
        title: `Pipeline: ${STAGE_LABELS[previousStage] || previousStage} → ${STAGE_LABELS[newStage] || newStage}`,
        description: `Lead "${(lead as any).companyName}" moved from ${previousStage} to ${newStage}`,
        priority: 'medium',
        priorityScore: 50,
        status: 'completed',
        completedAt: new Date(),
        pipelineMoved: true,
        previousStage,
        dueDate: new Date(),
        source: 'pipeline_intelligence',
      },
    });

    return updated;
  }

  // ─── LOG ACTIVITY ──────────────────────────────────────

  async logActivity(leadId: string, type: string, notes: string | undefined, userId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, assignedToId: true, companyName: true },
    });

    if (!lead) {
      return { error: 'Lead not found' };
    }

    // Update lead lastContactedAt
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { lastContactedAt: new Date() },
    });

    // Create activity task
    const task = await this.prisma.salesTask.create({
      data: {
        advisorId: (lead as any).assignedToId || userId,
        leadId,
        type,
        title: `${type}: ${(lead as any).companyName}`,
        description: notes || null,
        priority: 'medium',
        priorityScore: 50,
        status: 'completed',
        completedAt: new Date(),
        dueDate: new Date(),
        source: 'pipeline_intelligence',
      },
    });

    return task;
  }

  // ─── LABELS ────────────────────────────────────────────

  async getLabels() {
    const leads = await this.prisma.lead.findMany({
      where: { isHistorical: false, deletedAt: null },
      select: { notes: true },
    });

    const allLabels: string[] = [];
    (leads as any[]).forEach((l: any) => {
      const labels = extractLabels(l.notes);
      labels.forEach((lbl: any) => allLabels.push(lbl));
    });

    // Unique and sorted
    const unique = Array.from(new Set(allLabels)).sort();
    return { labels: unique, count: unique.length };
  }

  // ═══════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════

  private buildWhere(filters: PipelineFilters): any {
    const where: any = { isHistorical: false, deletedAt: null };

    if (filters.advisorId) {
      where.assignedToId = filters.advisorId;
    }
    if (filters.zone) {
      where.zone = filters.zone as any;
    }
    if (filters.source) {
      where.source = filters.source as any;
    }
    if (filters.stage) {
      where.status = filters.stage as any;
    }
    if (filters.industry) {
      where.industry = { contains: filters.industry, mode: 'insensitive' };
    }
    if (filters.billRange) {
      where.billRange = filters.billRange;
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

  private async buildAdvisorWorkload(
    leads: any[],
    users: any[],
    userMap: Map<string, string>,
    tasksList?: any[],
  ) {
    // Fetch pending tasks if not provided
    let pendingTasks: any[];
    if (tasksList) {
      pendingTasks = tasksList;
    } else {
      pendingTasks = await this.prisma.salesTask.findMany({
        where: { isHistorical: false, status: 'pending' },
        select: { advisorId: true },
      });
    }

    // Build pending task count by advisor
    const taskCountMap = new Map<string, number>();
    (pendingTasks as any[]).forEach((t: any) => {
      if (t.advisorId) {
        taskCountMap.set(t.advisorId, (taskCountMap.get(t.advisorId) || 0) + 1);
      }
    });

    // Group leads by advisor
    const advisorLeadMap = new Map<string, any[]>();
    leads.forEach((l: any) => {
      const aid = l.assignedToId || '__unassigned__';
      if (!advisorLeadMap.has(aid)) advisorLeadMap.set(aid, []);
      advisorLeadMap.get(aid)!.push(l);
    });

    // Collect advisor IDs: all users with assigned leads + all active users
    const advisorIds = Array.from(new Set([
      ...users.map((u: any) => u.id),
      ...Array.from(advisorLeadMap.keys()),
    ]));

    return advisorIds
      .filter((aid: any) => aid !== '__unassigned__')
      .map((advisorId: any) => {
        const advisorLeads = advisorLeadMap.get(advisorId) || [];
        const totalLeads = advisorLeads.length;
        const totalDeals = advisorLeads.filter((l: any) => CLOSING_STAGES.includes(l.status)).length;
        const totalValue = round2(advisorLeads.reduce((s: number, l: any) => s + (l.estimatedValue || 0), 0));
        const pendingTaskCount = taskCountMap.get(advisorId) || 0;

        // By stage
        const byStageMap = new Map<string, { count: number; value: number }>();
        advisorLeads.forEach((l: any) => {
          const entry = byStageMap.get(l.status) || { count: 0, value: 0 };
          entry.count++;
          entry.value += l.estimatedValue || 0;
          byStageMap.set(l.status, entry);
        });
        const byStage = STAGE_ORDER
          .filter((stage: any) => byStageMap.has(stage))
          .map((stage: any) => {
            const entry = byStageMap.get(stage)!;
            return { stage, count: entry.count, value: round2(entry.value) };
          });

        return {
          advisorId,
          advisorName: userMap.get(advisorId) || 'Desconocido',
          totalLeads,
          totalDeals,
          totalValue,
          pendingTasks: pendingTaskCount,
          byStage,
        };
      })
      .filter((a: any) => a.totalLeads > 0 || a.pendingTasks > 0)
      .sort((a: any, b: any) => b.totalLeads - a.totalLeads);
  }
}
