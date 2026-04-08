import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

const TEAM_EMAILS = [
  'admin@iea.com', 'j.pimentel@iealanis.com', 'jaime.nav@iealanis.com',
  'atencion@iealanis.com', 'jenifer@iealanis.com', 'mariana@iealanis.com',
];

const ACTIVE_STAGES = [
  'PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR', 'EN_PROSPECCION',
  'AGENDAR_CITA', 'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO',
];

const CLOSING_STAGES = ['COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO'];

const DEAL_STAGES = [
  'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO',
  'PENDIENTE_PAGO', 'CERRADO_GANADO', 'CERRADO_PERDIDO',
];

const STAGE_LABELS: Record<string, string> = {
  PENDIENTE_CONTACTAR: 'Pendiente Contactar',
  INTENTANDO_CONTACTAR: 'Intentando Contactar',
  EN_PROSPECCION: 'En Prospeccion',
  AGENDAR_CITA: 'Agendar Cita',
  ESPERANDO_COTIZACION: 'Esperando Cotizacion',
  COTIZACION_ENTREGADA: 'Cotizacion Entregada',
  ESPERANDO_CONTRATO: 'Esperando Contrato',
  PENDIENTE_PAGO: 'Pendiente Pago',
  CERRADO_GANADO: 'Cerrado Ganado',
  CERRADO_PERDIDO: 'Cerrado Perdido',
  CONTACTAR_FUTURO: 'Contactar Futuro',
  LEAD_BASURA: 'Lead Basura',
};

const STAGE_COLORS: Record<string, string> = {
  PENDIENTE_CONTACTAR: '#94a3b8',
  INTENTANDO_CONTACTAR: '#60a5fa',
  EN_PROSPECCION: '#a78bfa',
  AGENDAR_CITA: '#f472b6',
  ESPERANDO_COTIZACION: '#fb923c',
  COTIZACION_ENTREGADA: '#fbbf24',
  ESPERANDO_CONTRATO: '#34d399',
  PENDIENTE_PAGO: '#22d3ee',
  CERRADO_GANADO: '#4ade80',
  CERRADO_PERDIDO: '#f87171',
};

const VALUE_RANGES = [
  { label: '$0 - $100K', min: 0, max: 100000 },
  { label: '$100K - $500K', min: 100000, max: 500000 },
  { label: '$500K - $1M', min: 500000, max: 1000000 },
  { label: '$1M - $5M', min: 1000000, max: 5000000 },
  { label: '$5M+', min: 5000000, max: Infinity },
];

const COTIZACION_PLUS = ['COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO', 'CERRADO_GANADO'];

@Injectable()
export class AdminDashboardService {
  constructor(private prisma: PrismaService) {}

  async getDashboard() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // ── Fetch all data ──
    const [allLeads, allTasks, users] = await Promise.all([
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false },
        select: {
          id: true, companyName: true, zone: true, status: true,
          source: true, industry: true, estimatedValue: true,
          assignedToId: true, createdAt: true, lastContactedAt: true, updatedAt: true,
        },
      }),
      this.prisma.salesTask.findMany({
        where: { isHistorical: false },
        select: {
          id: true, leadId: true, advisorId: true, type: true, status: true,
          completedAt: true, createdAt: true, pipelineMoved: true, dueDate: true,
          newStage: true, previousStage: true, zone: true, channel: true,
        },
      }),
      this.prisma.user.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
    ]);

    const ll: any[] = allLeads;
    const tt: any[] = allTasks;
    const uMap = new Map<string, string>(users.map((u: any) => [u.id, `${u.firstName} ${u.lastName}`]));
    const doneTasks = tt.filter((t: any) => t.status === 'completed');

    // Segment leads
    const activeLeads = ll.filter((l: any) => ACTIVE_STAGES.includes(l.status));
    const deals = ll.filter((l: any) => DEAL_STAGES.includes(l.status));
    const won = ll.filter((l: any) => l.status === 'CERRADO_GANADO');

    // Touched leads: leads with at least one completed task
    const touchedIds = new Set(doneTasks.filter((t: any) => t.leadId).map((t: any) => t.leadId));

    // ── A. LEADS OVERVIEW ──
    const leads = this.buildLeadsOverview(ll, tt, doneTasks, touchedIds, now, todayStart, weekStart, monthStart);

    // ── B. DEALS OVERVIEW ──
    const dealsOverview = this.buildDealsOverview(deals, won, uMap, now, todayStart, weekStart, monthStart);

    // ── C. CONVERSION FUNNEL ──
    const funnel = this.buildFunnel(ll, uMap, now);

    // ── D. STAGE ANALYSIS ──
    const stageAnalysis = this.buildStageAnalysis(ll, now);

    // ── E. TEAM PERFORMANCE ──
    const team = this.buildTeamPerformance(ll, tt, doneTasks, users, uMap, todayStart);

    return { leads, deals: dealsOverview, funnel, stageAnalysis, team };
  }

  // ════════════════════════════════════════════════════════════
  // A. LEADS OVERVIEW
  // ════════════════════════════════════════════════════════════
  private buildLeadsOverview(
    ll: any[], tt: any[], doneTasks: any[], touchedIds: Set<string>,
    now: Date, todayStart: Date, weekStart: Date, monthStart: Date,
  ) {
    const total = ll.length;
    const today = ll.filter((l: any) => l.createdAt >= todayStart).length;
    const thisWeek = ll.filter((l: any) => l.createdAt >= weekStart).length;
    const thisMonth = ll.filter((l: any) => l.createdAt >= monthStart).length;

    // Last 3 months
    const last3Months: { month: string; count: number }[] = [];
    for (let i = 2; i >= 0; i--) {
      const s = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const e = new Date(s.getFullYear(), s.getMonth() + 1, 1);
      const count = ll.filter((l: any) => l.createdAt >= s && l.createdAt < e).length;
      last3Months.push({ month: s.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }), count });
    }

    const byZone = this.bdAmt(ll, (l: any) => l.zone);
    const byIndustry = this.bdAmt(ll.filter((l: any) => l.industry), (l: any) => l.industry);
    const bySource = this.bdBy(ll, (l: any) => l.source);

    // By value range
    const valued = ll.filter((l: any) => l.estimatedValue != null && l.estimatedValue > 0);
    const byValueRange = VALUE_RANGES.map((r: any) => {
      const matches = valued.filter((l: any) => l.estimatedValue >= r.min && l.estimatedValue < r.max);
      return {
        label: r.label,
        count: matches.length,
        amount: matches.reduce((s: number, l: any) => s + (l.estimatedValue || 0), 0),
      };
    });

    // Touched vs untouched
    const touched = ll.filter((l: any) => touchedIds.has(l.id)).length;
    const untouched = total - touched;
    const touchRate = total > 0 ? Math.round((touched / total) * 1000) / 10 : 0;

    // Contact attempts
    const contactTasks = doneTasks.filter((t: any) => ['call', 'whatsapp', 'email', 'visit'].includes(t.type));
    const totalAttempts = contactTasks.length;
    const avgPerLead = total > 0 ? Math.round((totalAttempts / total) * 10) / 10 : 0;
    const byType = this.bdBy(contactTasks, (t: any) => t.type);

    return {
      total, today, thisWeek, thisMonth, last3Months,
      byZone, byIndustry, bySource, byValueRange,
      touchedVsUntouched: { touched, untouched, touchRate },
      contactAttempts: { total: totalAttempts, avgPerLead, byType },
    };
  }

  // ════════════════════════════════════════════════════════════
  // B. DEALS OVERVIEW
  // ════════════════════════════════════════════════════════════
  private buildDealsOverview(
    deals: any[], won: any[], uMap: Map<string, string>,
    now: Date, todayStart: Date, weekStart: Date, monthStart: Date,
  ) {
    const total = deals.length;
    const today = deals.filter((d: any) => d.createdAt >= todayStart).length;
    const thisWeek = deals.filter((d: any) => d.createdAt >= weekStart).length;
    const thisMonth = deals.filter((d: any) => d.createdAt >= monthStart).length;

    // Last 3 months
    const last3Months: { month: string; count: number; amount: number }[] = [];
    for (let i = 2; i >= 0; i--) {
      const s = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const e = new Date(s.getFullYear(), s.getMonth() + 1, 1);
      const m = deals.filter((d: any) => d.createdAt >= s && d.createdAt < e);
      last3Months.push({
        month: s.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }),
        count: m.length,
        amount: m.reduce((x: number, d: any) => x + (d.estimatedValue || 0), 0),
      });
    }

    const totalValue = deals.reduce((s: number, d: any) => s + (d.estimatedValue || 0), 0);
    const avgTicket = total > 0 ? this.fmt(totalValue / total) : 0;
    const wonAmount = won.reduce((s: number, d: any) => s + (d.estimatedValue || 0), 0);

    // By stage
    const byStage = DEAL_STAGES.map((stage: string) => {
      const m = deals.filter((d: any) => d.status === stage);
      return {
        stage,
        label: STAGE_LABELS[stage] || stage,
        count: m.length,
        amount: m.reduce((x: number, d: any) => x + (d.estimatedValue || 0), 0),
        color: STAGE_COLORS[stage] || '#94a3b8',
      };
    });

    // By advisor
    const byAdvisor = this.bdAmtAdvisor(deals, uMap);

    // By zone & industry
    const byZone = this.bdAmt(deals, (d: any) => d.zone);
    const byIndustry = this.bdAmt(deals.filter((d: any) => d.industry), (d: any) => d.industry);

    return {
      total, today, thisWeek, thisMonth, last3Months,
      totalValue, avgTicket, wonAmount,
      byStage, byAdvisor, byZone, byIndustry,
    };
  }

  // ════════════════════════════════════════════════════════════
  // C. CONVERSION FUNNEL
  // ════════════════════════════════════════════════════════════
  private buildFunnel(ll: any[], uMap: Map<string, string>, now: Date) {
    const totalLeads = ll.length;
    const becameDeals = ll.filter((l: any) => DEAL_STAGES.includes(l.status)).length;
    const reachedCotizacion = ll.filter((l: any) => COTIZACION_PLUS.includes(l.status)).length;
    const closed = ll.filter((l: any) => l.status === 'CERRADO_GANADO').length;

    // Rates (percentage)
    const leadToDeal = totalLeads > 0 ? Math.round((becameDeals / totalLeads) * 1000) / 10 : 0;
    const dealToCotizacion = becameDeals > 0 ? Math.round((reachedCotizacion / becameDeals) * 1000) / 10 : 0;
    const cotizacionToClose = reachedCotizacion > 0 ? Math.round((closed / reachedCotizacion) * 1000) / 10 : 0;
    const overallConversion = totalLeads > 0 ? Math.round((closed / totalLeads) * 1000) / 10 : 0;

    // Dropoff (absolute numbers lost at each stage)
    const dropoff = {
      leadToDeal: totalLeads - becameDeals,
      dealToCotizacion: becameDeals - reachedCotizacion,
      cotizacionToClose: reachedCotizacion - closed,
    };

    // By advisor
    const advisorIds = [...new Set(ll.filter((l: any) => l.assignedToId).map((l: any) => l.assignedToId))];
    const byAdvisor = advisorIds
      .filter((id: any) => uMap.has(id))
      .map((id: any) => {
        const advLeads = ll.filter((l: any) => l.assignedToId === id);
        const advDeals = advLeads.filter((l: any) => DEAL_STAGES.includes(l.status)).length;
        const advCotiz = advLeads.filter((l: any) => COTIZACION_PLUS.includes(l.status)).length;
        const advClosed = advLeads.filter((l: any) => l.status === 'CERRADO_GANADO').length;
        return {
          name: uMap.get(id) || 'Sin asignar',
          leads: advLeads.length,
          deals: advDeals,
          cotizaciones: advCotiz,
          closed: advClosed,
          conversionRate: advLeads.length > 0 ? Math.round((advClosed / advLeads.length) * 1000) / 10 : 0,
        };
      })
      .sort((a: any, b: any) => b.closed - a.closed);

    // By zone
    const zones = [...new Set(ll.map((l: any) => l.zone))];
    const byZone = zones.map((z: any) => {
      const zLeads = ll.filter((l: any) => l.zone === z);
      const zDeals = zLeads.filter((l: any) => DEAL_STAGES.includes(l.status)).length;
      const zClosed = zLeads.filter((l: any) => l.status === 'CERRADO_GANADO').length;
      return {
        name: z,
        leads: zLeads.length,
        deals: zDeals,
        closed: zClosed,
        rate: zLeads.length > 0 ? Math.round((zClosed / zLeads.length) * 1000) / 10 : 0,
      };
    }).sort((a: any, b: any) => b.closed - a.closed);

    // By industry
    const industries = [...new Set(ll.filter((l: any) => l.industry).map((l: any) => l.industry))];
    const byIndustry = industries.map((ind: any) => {
      const iLeads = ll.filter((l: any) => l.industry === ind);
      const iDeals = iLeads.filter((l: any) => DEAL_STAGES.includes(l.status)).length;
      const iClosed = iLeads.filter((l: any) => l.status === 'CERRADO_GANADO').length;
      return {
        name: ind,
        leads: iLeads.length,
        deals: iDeals,
        closed: iClosed,
        rate: iLeads.length > 0 ? Math.round((iClosed / iLeads.length) * 1000) / 10 : 0,
      };
    }).sort((a: any, b: any) => b.closed - a.closed);

    // By month (last 3)
    const byMonth: any[] = [];
    for (let i = 2; i >= 0; i--) {
      const s = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const e = new Date(s.getFullYear(), s.getMonth() + 1, 1);
      const mLeads = ll.filter((l: any) => l.createdAt >= s && l.createdAt < e);
      const mDeals = mLeads.filter((l: any) => DEAL_STAGES.includes(l.status)).length;
      const mCotiz = mLeads.filter((l: any) => COTIZACION_PLUS.includes(l.status)).length;
      const mClosed = mLeads.filter((l: any) => l.status === 'CERRADO_GANADO').length;
      byMonth.push({
        month: s.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }),
        leads: mLeads.length,
        deals: mDeals,
        cotizaciones: mCotiz,
        closed: mClosed,
        rate: mLeads.length > 0 ? Math.round((mClosed / mLeads.length) * 1000) / 10 : 0,
      });
    }

    return {
      totalLeads, becameDeals, reachedCotizacion, closed,
      rates: { leadToDeal, dealToCotizacion, cotizacionToClose, overallConversion },
      dropoff,
      byAdvisor, byZone, byIndustry, byMonth,
    };
  }

  // ════════════════════════════════════════════════════════════
  // D. STAGE ANALYSIS
  // ════════════════════════════════════════════════════════════
  private buildStageAnalysis(ll: any[], now: Date) {
    // Last 3 months stage breakdown
    const last3Months: any[] = [];
    for (let i = 2; i >= 0; i--) {
      const s = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const e = new Date(s.getFullYear(), s.getMonth() + 1, 1);
      const mLeads = ll.filter((l: any) => l.createdAt >= s && l.createdAt < e);

      const stages = ACTIVE_STAGES.map((stage: string) => {
        const inStage = mLeads.filter((l: any) => l.status === stage);
        const avgDays = inStage.length > 0
          ? Math.round(inStage.reduce((x: number, l: any) => {
              return x + Math.floor((now.getTime() - l.updatedAt.getTime()) / 86400000);
            }, 0) / inStage.length)
          : 0;
        return {
          stage,
          label: STAGE_LABELS[stage] || stage,
          count: inStage.length,
          amount: inStage.reduce((x: number, l: any) => x + (l.estimatedValue || 0), 0),
          avgDaysInStage: avgDays,
        };
      }).filter((s: any) => s.count > 0);

      last3Months.push({
        month: s.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }),
        stages,
      });
    }

    // Stuck deals: active leads not contacted in 7+ days
    const stuckDeals = ACTIVE_STAGES.map((stage: string) => {
      const inStage = ll.filter((l: any) => l.status === stage);
      const stuck = inStage.filter((l: any) => {
        const days = l.lastContactedAt
          ? Math.floor((now.getTime() - l.lastContactedAt.getTime()) / 86400000)
          : 999;
        return days > 7;
      });
      const avgDays = stuck.length > 0
        ? Math.round(stuck.reduce((x: number, l: any) => {
            return x + (l.lastContactedAt
              ? Math.floor((now.getTime() - l.lastContactedAt.getTime()) / 86400000)
              : 90);
          }, 0) / stuck.length)
        : 0;
      return {
        stage,
        label: STAGE_LABELS[stage] || stage,
        count: stuck.length,
        amount: stuck.reduce((x: number, l: any) => x + (l.estimatedValue || 0), 0),
        avgDays,
      };
    }).filter((s: any) => s.count > 0);

    // Bottleneck insight
    const closingStuck = stuckDeals.filter((s: any) => CLOSING_STAGES.includes(s.stage));
    const worstStuck = stuckDeals.sort((a: any, b: any) => b.count - a.count)[0];
    let bottleneck = 'Pipeline flowing normally';
    if (worstStuck && worstStuck.count > 0) {
      if (closingStuck.length > 0) {
        const totalClosingStuck = closingStuck.reduce((x: number, s: any) => x + s.count, 0);
        const totalClosingAmt = closingStuck.reduce((x: number, s: any) => x + s.amount, 0);
        bottleneck = `${totalClosingStuck} deals worth $${this.fmt(totalClosingAmt)} stuck in closing stages (${closingStuck.map((s: any) => s.label).join(', ')}). Focus follow-up here for quickest revenue impact.`;
      } else {
        bottleneck = `${worstStuck.count} leads stuck in "${worstStuck.label}" (avg ${worstStuck.avgDays} days). Biggest pipeline bottleneck — needs attention.`;
      }
    }

    return { last3Months, stuckDeals, bottleneck };
  }

  // ════════════════════════════════════════════════════════════
  // E. TEAM PERFORMANCE
  // ════════════════════════════════════════════════════════════
  private buildTeamPerformance(
    ll: any[], tt: any[], doneTasks: any[], users: any[], uMap: Map<string, string>,
    todayStart: Date,
  ) {
    return users.map((u: any) => {
      const id = u.id;
      const name = `${u.firstName} ${u.lastName}`;

      const myLeads = ll.filter((l: any) => l.assignedToId === id);
      const myDeals = myLeads.filter((l: any) => DEAL_STAGES.includes(l.status));
      const myWon = myLeads.filter((l: any) => l.status === 'CERRADO_GANADO');
      const myLost = myLeads.filter((l: any) => l.status === 'CERRADO_PERDIDO');
      const myActive = myLeads.filter((l: any) => ACTIVE_STAGES.includes(l.status));

      const pipelineValue = myActive.reduce((s: number, l: any) => s + (l.estimatedValue || 0), 0);
      const wonAmount = myWon.reduce((s: number, l: any) => s + (l.estimatedValue || 0), 0);

      // Today's activity
      const myTasksToday = doneTasks.filter((t: any) => t.advisorId === id && t.completedAt && t.completedAt >= todayStart);
      const callsToday = myTasksToday.filter((t: any) => t.type === 'call').length;
      const contactsToday = myTasksToday.length;

      const conversionRate = myLeads.length > 0
        ? Math.round((myWon.length / myLeads.length) * 1000) / 10
        : 0;

      // Status: based on pending tasks and contact rate
      const pendingTasks = tt.filter((t: any) => t.advisorId === id && t.status === 'pending').length;
      const overdueTasks = tt.filter((t: any) => t.advisorId === id && t.status === 'overdue').length;
      let status: 'on_track' | 'behind' | 'critical' = 'on_track';
      if (overdueTasks > 5 || (myActive.length > 0 && contactsToday === 0 && pendingTasks > 10)) {
        status = 'critical';
      } else if (overdueTasks > 2 || pendingTasks > 8) {
        status = 'behind';
      }

      return {
        id, name,
        leads: myLeads.length,
        deals: myDeals.length,
        won: myWon.length,
        lost: myLost.length,
        pipelineValue,
        wonAmount,
        callsToday,
        contactsToday,
        conversionRate,
        status,
      };
    }).sort((a: any, b: any) => b.wonAmount - a.wonAmount);
  }

  // ════════════════════════════════════════════════════════════
  // Helpers
  // ════════════════════════════════════════════════════════════

  /** Format number to 2 decimals */
  private fmt(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /** Group items by key, return { name, count } sorted desc */
  private bdBy(items: any[], fn: (i: any) => string): { name: string; count: number }[] {
    const m = new Map<string, number>();
    for (const i of items) {
      const k = fn(i);
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()]
      .map(([name, count]: [string, number]) => ({ name, count }))
      .sort((a: any, b: any) => b.count - a.count);
  }

  /** Group items by key, return { name, count, amount } sorted by amount desc */
  private bdAmt(items: any[], fn: (i: any) => string): { name: string; count: number; amount: number }[] {
    const m = new Map<string, { c: number; a: number }>();
    for (const i of items) {
      const k = fn(i);
      const e = m.get(k) || { c: 0, a: 0 };
      e.c++;
      e.a += i.estimatedValue || 0;
      m.set(k, e);
    }
    return [...m.entries()]
      .map(([name, v]: [string, { c: number; a: number }]) => ({ name, count: v.c, amount: v.a }))
      .sort((a: any, b: any) => b.amount - a.amount);
  }

  /** Group deals by advisor, return { name, count, amount, avgTicket } */
  private bdAmtAdvisor(items: any[], uMap: Map<string, string>) {
    const m = new Map<string, { c: number; a: number }>();
    for (const i of items) {
      const k = i.assignedToId ? uMap.get(i.assignedToId) || 'Sin asignar' : 'Sin asignar';
      const e = m.get(k) || { c: 0, a: 0 };
      e.c++;
      e.a += i.estimatedValue || 0;
      m.set(k, e);
    }
    return [...m.entries()]
      .map(([name, v]: [string, { c: number; a: number }]) => ({
        name,
        count: v.c,
        amount: v.a,
        avgTicket: v.c > 0 ? this.fmt(v.a / v.c) : 0,
      }))
      .sort((a: any, b: any) => b.amount - a.amount);
  }
}
