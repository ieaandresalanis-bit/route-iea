import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

const TEAM_EMAILS = [
  'admin@iea.com', 'j.pimentel@iealanis.com', 'jaime.nav@iealanis.com',
  'atencion@iealanis.com', 'jenifer@iealanis.com', 'mariana@iealanis.com',
];

const ALL_STAGES = [
  'PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR', 'EN_PROSPECCION',
  'AGENDAR_CITA', 'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO', 'CERRADO_GANADO', 'CERRADO_PERDIDO',
  'CONTACTAR_FUTURO', 'LEAD_BASURA',
];

const DEAL_STAGES = [
  'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO',
  'PENDIENTE_PAGO', 'CERRADO_GANADO', 'CERRADO_PERDIDO',
];

const ACTIVE_DEAL_STAGES = [
  'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO',
];

const CLOSING_STAGES = ['COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO'];

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

const STAGE_PROB: Record<string, number> = {
  ESPERANDO_COTIZACION: 0.25,
  COTIZACION_ENTREGADA: 0.50,
  ESPERANDO_CONTRATO: 0.75,
  PENDIENTE_PAGO: 0.90,
  CERRADO_GANADO: 1.00,
};

const STAGE_COLORS: Record<string, string> = {
  ESPERANDO_COTIZACION: '#8b5cf6',
  COTIZACION_ENTREGADA: '#f97316',
  ESPERANDO_CONTRATO: '#ec4899',
  PENDIENTE_PAGO: '#ef4444',
  CERRADO_GANADO: '#22c55e',
  CERRADO_PERDIDO: '#64748b',
};

@Injectable()
export class DealsIntelligenceService {
  constructor(private prisma: PrismaService) {}

  async getAnalytics() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [allLeads, tasks, users] = await Promise.all([
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false },
        select: {
          id: true, companyName: true, zone: true, status: true,
          source: true, industry: true, estimatedValue: true,
          assignedToId: true, createdAt: true, lastContactedAt: true, updatedAt: true,
        },
      }),
      this.prisma.salesTask.findMany({
        select: {
          leadId: true, advisorId: true, type: true, status: true,
          completedAt: true, createdAt: true, pipelineMoved: true,
          newStage: true, previousStage: true, zone: true,
        },
      }),
      this.prisma.user.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);

    const uMap = new Map<string, string>(users.map((u: any) => [u.id, `${u.firstName} ${u.lastName}`]));
    const ll: any[] = allLeads;
    const tt: any[] = tasks;
    const deals = ll.filter(l => DEAL_STAGES.includes(l.status));
    const activeDeals = ll.filter(l => ACTIVE_DEAL_STAGES.includes(l.status));
    const won = ll.filter(l => l.status === 'CERRADO_GANADO');
    const lost = ll.filter(l => l.status === 'CERRADO_PERDIDO');
    const doneTasks = tt.filter(t => t.status === 'completed');

    // ── SUMMARY ──
    const totalAmt = activeDeals.reduce((s, l) => s + (l.estimatedValue || 0), 0);
    const wonAmt = won.reduce((s, l) => s + (l.estimatedValue || 0), 0);
    const weightedAmt = activeDeals.reduce((s, l) => s + (l.estimatedValue || 0) * (STAGE_PROB[l.status] || 0), 0);
    const summary = {
      totalDeals: activeDeals.length, won: won.length, lost: lost.length,
      inClosing: ll.filter(l => CLOSING_STAGES.includes(l.status)).length,
      totalAmount: totalAmt, wonAmount: wonAmt, weightedAmount: weightedAmt,
      avgTicket: activeDeals.length ? totalAmt / activeDeals.length : 0,
    };

    // ── DEALS CREATED (by period) ──
    const created = {
      today: deals.filter(l => l.createdAt >= todayStart).length,
      thisWeek: deals.filter(l => l.createdAt >= weekStart).length,
      thisMonth: deals.filter(l => l.createdAt >= monthStart).length,
      byMonth: this.monthly(now, deals),
      byAdvisor: this.bdAmt(deals, l => l.assignedToId ? uMap.get(l.assignedToId) || 'Sin asignar' : 'Sin asignar'),
      byZone: this.bdAmt(deals, l => l.zone),
      byIndustry: this.bdAmt(deals.filter(l => l.industry), l => l.industry!),
    };

    // ── DEAL VALUE ──
    const dv = activeDeals.filter(l => l.estimatedValue && l.estimatedValue > 0);
    const highestByZone = this.bdAmt(dv, l => l.zone);
    const highestByIndustry = this.bdAmt(dv.filter(l => l.industry), l => l.industry!);
    const value = {
      total: totalAmt, avg: summary.avgTicket, weighted: weightedAmt,
      highestByZone, highestByIndustry,
    };

    // ── STAGE INTELLIGENCE ──
    const byStage = ACTIVE_DEAL_STAGES.map(s => {
      const m = ll.filter(l => l.status === s);
      const amt = m.reduce((x, l) => x + (l.estimatedValue || 0), 0);
      return {
        stage: s, label: STAGE_LABELS[s], count: m.length, amount: amt,
        color: STAGE_COLORS[s] || '#94a3b8', prob: STAGE_PROB[s] || 0,
        weighted: m.reduce((x, l) => x + (l.estimatedValue || 0) * (STAGE_PROB[s] || 0), 0),
      };
    });

    // Stuck deals — active deals not contacted in 7+ days
    const stuckByStage = ACTIVE_DEAL_STAGES.map(s => {
      const stuck = ll.filter(l => l.status === s).filter(l => {
        const days = l.lastContactedAt ? Math.floor((now.getTime() - l.lastContactedAt.getTime()) / 86400000) : 999;
        return days > 7;
      });
      return {
        stage: s, label: STAGE_LABELS[s], count: stuck.length,
        amount: stuck.reduce((x, l) => x + (l.estimatedValue || 0), 0),
        avgDays: stuck.length ? Math.round(stuck.reduce((x, l) => {
          return x + (l.lastContactedAt ? Math.floor((now.getTime() - l.lastContactedAt.getTime()) / 86400000) : 90);
        }, 0) / stuck.length) : 0,
      };
    }).filter(s => s.count > 0);

    // Full pipeline (all stages including terminal)
    const fullPipeline = ALL_STAGES.map(s => {
      const m = ll.filter(l => l.status === s);
      return { stage: s, label: STAGE_LABELS[s], count: m.length, amount: m.reduce((x, l) => x + (l.estimatedValue || 0), 0) };
    }).filter(s => s.count > 0);

    const stages = { byStage, stuckByStage, fullPipeline };

    // ── CONTACT + MOVEMENT ──
    const tasksByLead = new Map<string, number>();
    const movesByLead = new Map<string, number>();
    for (const t of doneTasks) {
      if (t.leadId) tasksByLead.set(t.leadId, (tasksByLead.get(t.leadId) || 0) + 1);
      if (t.leadId && t.pipelineMoved) movesByLead.set(t.leadId, (movesByLead.get(t.leadId) || 0) + 1);
    }
    const dealIds = new Set(activeDeals.map(d => d.id));
    const dealTaskCounts = [...tasksByLead.entries()].filter(([id]) => dealIds.has(id)).map(([, c]) => c);
    const dealMoveCounts = [...movesByLead.entries()].filter(([id]) => dealIds.has(id)).map(([, c]) => c);

    // Deals needing touch today (last contact > 3 days)
    const needTouch = activeDeals.filter(l => {
      const days = l.lastContactedAt ? Math.floor((now.getTime() - l.lastContactedAt.getTime()) / 86400000) : 999;
      return days >= 3;
    });

    // Inactive deals (top 10 by value, not contacted 7+ days)
    const inactive = activeDeals
      .map(l => ({
        id: l.id, company: l.companyName, stage: STAGE_LABELS[l.status] || l.status,
        advisor: uMap.get(l.assignedToId || '') || 'Sin asignar',
        value: l.estimatedValue || 0,
        days: l.lastContactedAt ? Math.floor((now.getTime() - l.lastContactedAt.getTime()) / 86400000) : 999,
      }))
      .filter(d => d.days > 7)
      .sort((a, b) => b.value - a.value)
      .slice(0, 15);

    const movement = {
      avgContactsPerDeal: dealTaskCounts.length ? Math.round(dealTaskCounts.reduce((a, b) => a + b, 0) / dealTaskCounts.length * 10) / 10 : 0,
      avgMovesPerDeal: dealMoveCounts.length ? Math.round(dealMoveCounts.reduce((a, b) => a + b, 0) / dealMoveCounts.length * 10) / 10 : 0,
      needTouchToday: needTouch.length,
      inactive,
    };

    // ── COTIZACION INTELLIGENCE ──
    const quoteTasks = doneTasks.filter(t => t.type === 'send_quote' || t.newStage === 'COTIZACION_ENTREGADA');
    const cotToday = quoteTasks.filter(t => t.completedAt && t.completedAt >= todayStart).length;
    const cotWeek = quoteTasks.filter(t => t.completedAt && t.completedAt >= weekStart).length;
    const cotMonth = quoteTasks.filter(t => t.completedAt && t.completedAt >= monthStart).length;

    const cotByAdvisor = this.bdBy(quoteTasks, t => t.advisorId ? uMap.get(t.advisorId) || 'Sin asignar' : 'Sin asignar');
    const cotByZone = this.bdBy(quoteTasks.filter(t => t.zone), t => t.zone!);

    // Cotizacion to close: leads that were in COTIZACION_ENTREGADA and are now won
    const cotizLeads = ll.filter(l => l.status === 'COTIZACION_ENTREGADA' || l.status === 'ESPERANDO_CONTRATO' || l.status === 'PENDIENTE_PAGO' || l.status === 'CERRADO_GANADO');
    const cotCloseRate = cotizLeads.length ? Math.round((won.length / cotizLeads.length) * 1000) / 10 : 0;

    const cotizacion = {
      today: cotToday, thisWeek: cotWeek, thisMonth: cotMonth,
      byAdvisor: cotByAdvisor, byZone: cotByZone, closeRate: cotCloseRate,
    };

    // ── REACTIVATION INTELLIGENCE ──
    const reactTasks = doneTasks.filter(t => t.type === 'reactivation');
    const reactToday = reactTasks.filter(t => t.completedAt && t.completedAt >= todayStart).length;
    const reactWeek = reactTasks.filter(t => t.completedAt && t.completedAt >= weekStart).length;
    const reactMonth = reactTasks.filter(t => t.completedAt && t.completedAt >= monthStart).length;

    const reactivation = {
      today: reactToday, thisWeek: reactWeek, thisMonth: reactMonth,
      byAdvisor: this.bdBy(reactTasks, t => t.advisorId ? uMap.get(t.advisorId) || 'Sin asignar' : 'Sin asignar'),
      byZone: this.bdBy(reactTasks.filter(t => t.zone), t => t.zone!),
      byIndustry: this.bdBy([], () => ''), // no industry on task
    };

    // ── MONTHLY TIMELINE ──
    const monthly = this.buildMonthly(now, allLeads, doneTasks, uMap);

    // ── LABELS ──
    const labels = this.mkLabels(allLeads, activeDeals, uMap);

    // ── INSIGHTS ──
    const insights = this.mkInsights(allLeads, activeDeals, won, lost, byStage, stuckByStage, created.byAdvisor, uMap);

    return { summary, created, value, stages, movement, cotizacion, reactivation, monthly, labels, insights };
  }

  // ── Helpers ──
  private bdBy<T>(items: T[], fn: (i: T) => string) {
    const m = new Map<string, number>();
    for (const i of items) { const k = fn(i); m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }

  private bdAmt(items: any[], fn: (i: any) => string) {
    const m = new Map<string, { c: number; a: number }>();
    for (const i of items) { const k = fn(i); const e = m.get(k) || { c: 0, a: 0 }; e.c++; e.a += i.estimatedValue || 0; m.set(k, e); }
    return [...m.entries()].map(([name, v]) => ({ name, count: v.c, amount: v.a, avg: v.c ? v.a / v.c : 0 })).sort((a, b) => b.amount - a.amount);
  }

  private monthly(now: Date, items: any[]) {
    const r: { month: string; count: number; amount: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const s = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const e = new Date(s.getFullYear(), s.getMonth() + 1, 1);
      const m = items.filter(x => x.createdAt >= s && x.createdAt < e);
      r.push({
        month: s.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }),
        count: m.length,
        amount: m.reduce((x: number, l: any) => x + (l.estimatedValue || 0), 0),
      });
    }
    return r;
  }

  private buildMonthly(now: Date, leads: any[], tasks: any[], uMap: Map<string, string>) {
    const result: any[] = [];
    for (let i = 11; i >= 0; i--) {
      const s = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const e = new Date(s.getFullYear(), s.getMonth() + 1, 1);
      const label = s.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' });

      const created = leads.filter(l => l.createdAt >= s && l.createdAt < e);
      const dealsCreated = created.filter(l => DEAL_STAGES.includes(l.status));
      const wonMonth = created.filter(l => l.status === 'CERRADO_GANADO');
      const values = created.filter(l => l.estimatedValue && l.estimatedValue > 0);
      const totalAmt = values.reduce((x: number, l: any) => x + l.estimatedValue, 0);

      const monthTasks = tasks.filter(t => t.completedAt && t.completedAt >= s && t.completedAt < e);
      const cotiz = monthTasks.filter(t => t.type === 'send_quote' || t.newStage === 'COTIZACION_ENTREGADA').length;
      const reacts = monthTasks.filter(t => t.type === 'reactivation').length;

      // Stuck by stage for leads created this month
      const stuckByStage = ACTIVE_DEAL_STAGES.map(st => ({
        stage: st, label: STAGE_LABELS[st],
        count: created.filter(l => l.status === st).length,
        amount: created.filter(l => l.status === st).reduce((x: number, l: any) => x + (l.estimatedValue || 0), 0),
      })).filter(st => st.count > 0);

      result.push({
        month: label,
        leadsCreated: created.length,
        dealsCreated: dealsCreated.length,
        avgTicket: values.length ? totalAmt / values.length : 0,
        totalAmount: totalAmt,
        conversions: wonMonth.length,
        cotizaciones: cotiz,
        reactivations: reacts,
        stuckByStage,
      });
    }
    return result;
  }

  private mkLabels(leads: any[], activeDeals: any[], uMap: Map<string, string>) {
    const labels: { label: string; count: number; type: string; color: string }[] = [];
    const byAdv = (arr: any[]) => {
      const m = new Map<string, number>();
      for (const l of arr) { if (l.assignedToId) m.set(l.assignedToId, (m.get(l.assignedToId) || 0) + 1); }
      return m;
    };
    for (const [id, c] of byAdv(leads.filter(l => CLOSING_STAGES.includes(l.status))))
      labels.push({ label: `Cerrar ${(uMap.get(id) || '').split(' ')[0]}`, count: c, type: 'closing', color: 'red' });
    for (const [id, c] of byAdv(activeDeals.filter(l => l.lastContactedAt && (Date.now() - l.lastContactedAt.getTime()) > 14 * 86400000)))
      labels.push({ label: `Reactivar ${(uMap.get(id) || '').split(' ')[0]}`, count: c, type: 'reactivation', color: 'orange' });
    for (const [id, c] of byAdv(activeDeals.filter(l => (l.estimatedValue || 0) > 1_000_000)))
      labels.push({ label: `High Value ${(uMap.get(id) || '').split(' ')[0]}`, count: c, type: 'high_value', color: 'purple' });
    return labels.sort((a, b) => b.count - a.count);
  }

  private fmt(n: number) { return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : n.toFixed(0); }

  private mkInsights(leads: any[], active: any[], won: any[], lost: any[], byStage: any[], stuck: any[], byAdvisor: any[], uMap: Map<string, string>) {
    const ins: string[] = [];

    // Stage with most stuck deals
    if (stuck[0]) ins.push(`Mas deals atascados: ${stuck[0].label} con ${stuck[0].count} deals ($${this.fmt(stuck[0].amount)}) — avg ${stuck[0].avgDays} dias sin contacto`);

    // Biggest pipeline stage
    const bigStage = byStage.sort((a: any, b: any) => b.amount - a.amount)[0];
    if (bigStage) ins.push(`Mayor monto en pipeline: ${bigStage.label} con $${this.fmt(bigStage.amount)} en ${bigStage.count} deals`);

    // Win rate
    if (won.length + lost.length > 0) {
      const wr = Math.round((won.length / (won.length + lost.length)) * 100);
      ins.push(`Tasa de cierre: ${wr}% (${won.length} ganados vs ${lost.length} perdidos)`);
    }

    // Advisor performance
    if (byAdvisor[0]) ins.push(`${byAdvisor[0].name} lidera en deals: ${byAdvisor[0].count} ($${this.fmt(byAdvisor[0].amount)})`);

    // High value deals at risk
    const atRisk = active.filter((l: any) => {
      const days = l.lastContactedAt ? Math.floor((Date.now() - l.lastContactedAt.getTime()) / 86400000) : 999;
      return (l.estimatedValue || 0) > 2_000_000 && days > 7;
    });
    if (atRisk.length > 0) {
      const riskAmt = atRisk.reduce((s: number, l: any) => s + (l.estimatedValue || 0), 0);
      ins.push(`${atRisk.length} deals >$2M en riesgo (sin contacto 7+ dias) — $${this.fmt(riskAmt)} en juego`);
    }

    // Weighted pipeline
    const weighted = active.reduce((s: number, l: any) => s + (l.estimatedValue || 0) * (STAGE_PROB[l.status] || 0), 0);
    ins.push(`Pipeline ponderado: $${this.fmt(weighted)} (probabilidad ajustada por etapa)`);

    return ins;
  }
}
