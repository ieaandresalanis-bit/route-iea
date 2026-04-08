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
const NEAR_CLOSE = ['ESPERANDO_CONTRATO', 'PENDIENTE_PAGO'];

const STAGE_LABELS: Record<string, string> = {
  PENDIENTE_CONTACTAR: 'Pendiente Contactar', INTENTANDO_CONTACTAR: 'Intentando Contactar',
  EN_PROSPECCION: 'En Prospeccion', AGENDAR_CITA: 'Agendar Cita',
  ESPERANDO_COTIZACION: 'Esperando Cotizacion', COTIZACION_ENTREGADA: 'Cotizacion Entregada',
  ESPERANDO_CONTRATO: 'Esperando Contrato', PENDIENTE_PAGO: 'Pendiente Pago',
  CERRADO_GANADO: 'Cerrado Ganado', CERRADO_PERDIDO: 'Cerrado Perdido',
};

const DAILY = { calls: 15, contacts: 20, quotes: 2, reactivations: 3, dealsMoved: 3 };
const WEEKLY = { calls: 75, contacts: 100, quotes: 10, reactivations: 15 };
const MONTHLY = { calls: 300, contacts: 400, quotes: 40, revenue: 1_500_000 };

@Injectable()
export class AgentLayerService {
  constructor(private prisma: PrismaService) {}

  async getDashboard() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [leads, tasks, users] = await Promise.all([
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false },
        select: {
          id: true, companyName: true, zone: true, status: true, industry: true,
          estimatedValue: true, assignedToId: true, createdAt: true, lastContactedAt: true,
        },
      }),
      this.prisma.salesTask.findMany({
        where: { isHistorical: false },
        select: {
          leadId: true, advisorId: true, type: true, status: true,
          completedAt: true, createdAt: true, pipelineMoved: true,
        },
      }),
      this.prisma.user.findMany({
        where: { email: { in: TEAM_EMAILS }, deletedAt: null, isActive: true },
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
    ]);

    const ll: any[] = leads;
    const tt: any[] = tasks;
    const uMap = new Map<string, string>(users.map((u: any) => [u.id, `${u.firstName} ${u.lastName}`]));
    const uFirst = new Map<string, string>(users.map((u: any) => [u.id, u.firstName]));
    const advisorIds = users.filter((u: any) => u.email !== 'admin@iea.com').map((u: any) => u.id);
    const done = tt.filter(t => t.status === 'completed');
    const doneToday = done.filter(t => t.completedAt && t.completedAt >= todayStart);
    const doneWeek = done.filter(t => t.completedAt && t.completedAt >= weekStart);
    const doneMonth = done.filter(t => t.completedAt && t.completedAt >= monthStart);

    // ── BUILD ADVISOR METRICS ──
    const advisorMetrics = advisorIds.map(id => {
      const name = uMap.get(id) || 'Unknown';
      const firstName = uFirst.get(id) || '';
      const myLeads = ll.filter(l => l.assignedToId === id && ACTIVE_STAGES.includes(l.status));
      const myClosing = ll.filter(l => l.assignedToId === id && CLOSING_STAGES.includes(l.status));
      const myNearClose = ll.filter(l => l.assignedToId === id && NEAR_CLOSE.includes(l.status));
      const myWon = ll.filter(l => l.assignedToId === id && l.status === 'CERRADO_GANADO');

      const todayTasks = doneToday.filter(t => t.advisorId === id);
      const weekTasks = doneWeek.filter(t => t.advisorId === id);
      const monthTasks = doneMonth.filter(t => t.advisorId === id);

      const callsToday = todayTasks.filter(t => t.type === 'call').length;
      const whatsToday = todayTasks.filter(t => t.type === 'whatsapp').length;
      const emailsToday = todayTasks.filter(t => t.type === 'email').length;
      const contactsToday = callsToday + whatsToday + emailsToday;
      const quotesToday = todayTasks.filter(t => t.type === 'send_quote').length;
      const reactToday = todayTasks.filter(t => t.type === 'reactivation').length;
      const movedToday = todayTasks.filter(t => t.pipelineMoved).length;

      const callsWeek = weekTasks.filter(t => t.type === 'call').length;
      const contactsWeek = weekTasks.filter(t => ['call', 'whatsapp', 'email'].includes(t.type)).length;
      const quotesWeek = weekTasks.filter(t => t.type === 'send_quote').length;
      const callsMonth = monthTasks.filter(t => t.type === 'call').length;
      const contactsMonth = monthTasks.filter(t => ['call', 'whatsapp', 'email'].includes(t.type)).length;

      const wonAmount = myWon.reduce((s, l) => s + (l.estimatedValue || 0), 0);
      const pipelineValue = myLeads.reduce((s, l) => s + (l.estimatedValue || 0), 0);
      const closingValue = myClosing.reduce((s, l) => s + (l.estimatedValue || 0), 0);

      // Stale leads (no contact 7+ days)
      const stale = myLeads.filter(l => {
        const d = l.lastContactedAt ? Math.floor((now.getTime() - l.lastContactedAt.getTime()) / 86400000) : 999;
        return d > 7;
      });

      // Priority leads to call (highest value, in closing or needing attention)
      const callFirst = myClosing
        .map(l => ({ id: l.id, company: l.companyName, value: l.estimatedValue || 0, stage: STAGE_LABELS[l.status] || l.status, zone: l.zone, days: l.lastContactedAt ? Math.floor((now.getTime() - l.lastContactedAt.getTime()) / 86400000) : 999 }))
        .sort((a: any, b: any) => b.value - a.value)
        .slice(0, 5);

      // Leads needing quotes
      const deliverQuotes = myLeads.filter(l => l.status === 'ESPERANDO_COTIZACION')
        .map(l => ({ id: l.id, company: l.companyName, value: l.estimatedValue || 0, zone: l.zone }))
        .sort((a: any, b: any) => b.value - a.value)
        .slice(0, 5);

      // Leads to reactivate (no contact 14+ days)
      const reactivate = myLeads
        .filter(l => { const d = l.lastContactedAt ? Math.floor((now.getTime() - l.lastContactedAt.getTime()) / 86400000) : 999; return d > 14; })
        .map(l => ({ id: l.id, company: l.companyName, value: l.estimatedValue || 0, zone: l.zone, days: l.lastContactedAt ? Math.floor((now.getTime() - l.lastContactedAt.getTime()) / 86400000) : 999 }))
        .sort((a: any, b: any) => b.value - a.value)
        .slice(0, 5);

      // Push closing today
      const pushClosing = myNearClose
        .map(l => ({ id: l.id, company: l.companyName, value: l.estimatedValue || 0, stage: STAGE_LABELS[l.status] || l.status }))
        .sort((a: any, b: any) => b.value - a.value)
        .slice(0, 3);

      // KPI Pressure
      const pressure = {
        calls: { done: callsToday, target: DAILY.calls, pct: Math.round((callsToday / DAILY.calls) * 100) },
        contacts: { done: contactsToday, target: DAILY.contacts, pct: Math.round((contactsToday / DAILY.contacts) * 100) },
        quotes: { done: quotesToday, target: DAILY.quotes, pct: Math.round((quotesToday / DAILY.quotes) * 100) },
        reactivations: { done: reactToday, target: DAILY.reactivations, pct: Math.round((reactToday / DAILY.reactivations) * 100) },
        dealsMoved: { done: movedToday, target: DAILY.dealsMoved, pct: Math.round((movedToday / DAILY.dealsMoved) * 100) },
        weekly: {
          calls: { done: callsWeek, target: WEEKLY.calls, pct: Math.round((callsWeek / WEEKLY.calls) * 100) },
          contacts: { done: contactsWeek, target: WEEKLY.contacts, pct: Math.round((contactsWeek / WEEKLY.contacts) * 100) },
        },
        monthly: {
          calls: { done: callsMonth, target: MONTHLY.calls, pct: Math.round((callsMonth / MONTHLY.calls) * 100) },
          revenue: { done: wonAmount, target: MONTHLY.revenue, pct: Math.round((wonAmount / MONTHLY.revenue) * 100) },
        },
        overallStatus: contactsToday >= DAILY.contacts * 0.7 ? 'on_track' : contactsToday >= DAILY.contacts * 0.3 ? 'behind' : 'critical',
      };

      const statusMsg = pressure.overallStatus === 'on_track' ? 'En ritmo — sigue asi'
        : pressure.overallStatus === 'behind' ? `Atrasado — necesitas ${DAILY.contacts - contactsToday} contactos mas`
        : `Critico — necesitas ${DAILY.calls - callsToday} llamadas y ${DAILY.contacts - contactsToday} contactos hoy`;

      // Coaching
      const bestZone = this.topGroup(myWon, 'zone');
      const bestIndustry = this.topGroup(myWon.filter(l => l.industry), 'industry');
      const coaching = {
        daily: `Enfocate en ${myClosing.length} deals en cierre ($${this.fmt(closingValue)}). Meta: ${DAILY.calls} llamadas, ${DAILY.quotes} cotizaciones.`,
        weekly: bestZone ? `Tu mejor conversion es en zona ${bestZone}. ${bestIndustry ? `Industria fuerte: ${bestIndustry}.` : ''} Aumenta contactos ahi.` : 'Aumenta volumen de contactos esta semana.',
        monthly: `Cerraste $${this.fmt(wonAmount)} este mes. Meta: $${this.fmt(MONTHLY.revenue)}. ${wonAmount < MONTHLY.revenue ? `Gap: $${this.fmt(MONTHLY.revenue - wonAmount)}.` : 'En meta!'}`,
      };

      return {
        id, name, firstName, pressure, statusMsg, coaching,
        stats: {
          activeLeads: myLeads.length, closingDeals: myClosing.length, nearClose: myNearClose.length,
          pipelineValue, closingValue, wonMonth: myWon.length, wonAmount, staleLeads: stale.length,
        },
        micro: { callFirst, deliverQuotes, reactivate, pushClosing },
      };
    });

    // ── AGENT INSTRUCTIONS ──
    const agents = this.buildAgentInstructions(ll, advisorMetrics, uMap, now);

    // ── ASSIGNMENT RECOMMENDATIONS ──
    const assignments = this.buildAssignments(ll, advisorMetrics, uMap);

    // ── SUPERVISOR GUIDANCE (NETO) ──
    const supervisorGuidance = this.buildSupervisorGuidance(advisorMetrics, ll, now);

    return { advisors: advisorMetrics, agents, assignments, supervisorGuidance };
  }

  private buildAgentInstructions(ll: any[], advisors: any[], uMap: Map<string, string>, now: Date) {
    const closing = ll.filter(l => CLOSING_STAGES.includes(l.status));
    const closingAmt = closing.reduce((s, l) => s + (l.estimatedValue || 0), 0);
    const wonMonth = ll.filter(l => l.status === 'CERRADO_GANADO');
    const wonAmt = wonMonth.reduce((s, l) => s + (l.estimatedValue || 0), 0);
    const highValue = closing.filter(l => (l.estimatedValue || 0) > 1_000_000).sort((a: any, b: any) => (b.estimatedValue || 0) - (a.estimatedValue || 0)).slice(0, 5);
    const noActivity = advisors.filter(a => a.pressure.contacts.done === 0);
    const nearClose = ll.filter(l => NEAR_CLOSE.includes(l.status));

    return [
      {
        name: 'Director Agent', icon: '🎯', status: 'active', color: '#ef4444',
        summary: `${closing.length} deals en cierre ($${this.fmt(closingAmt)}). ${wonMonth.length} ganados ($${this.fmt(wonAmt)}).`,
        instructions: [
          { text: `Revisar ${highValue.length} deals de alto valor en cierre`, priority: 'critical', deadline: 'Hoy', items: highValue.map(l => ({ company: l.companyName, value: l.estimatedValue, advisor: uMap.get(l.assignedToId) || '', stage: STAGE_LABELS[l.status] })) },
          { text: `${noActivity.length} asesores sin actividad hoy — intervenir`, priority: 'high', deadline: 'Ahora', items: noActivity.map(a => ({ name: a.name })) },
          nearClose.length > 0 ? { text: `${nearClose.length} deals casi cerrados — dar seguimiento personal`, priority: 'high', deadline: 'Hoy', items: nearClose.slice(0, 3).map(l => ({ company: l.companyName, value: l.estimatedValue, advisor: uMap.get(l.assignedToId) || '' })) } : null,
        ].filter(Boolean),
      },
      {
        name: 'Next Action Agent', icon: '🚀', status: 'active', color: '#3b82f6',
        summary: 'Acciones inmediatas priorizadas por asesor',
        instructions: advisors.map(a => ({
          text: a.micro.callFirst.length > 0
            ? `${a.firstName}: Llamar ${a.micro.callFirst.length} deals en cierre ($${this.fmt(a.micro.callFirst.reduce((s: number, d: any) => s + d.value, 0))})`
            : `${a.firstName}: ${a.stats.activeLeads} leads activos — iniciar contactos`,
          priority: a.stats.closingDeals > 10 ? 'critical' : 'high',
          deadline: 'Ahora',
          items: a.micro.callFirst.slice(0, 3).map((d: any) => ({ company: d.company, value: d.value, stage: d.stage })),
        })),
      },
      {
        name: 'Reminder Agent', icon: '⏰', status: 'active', color: '#f59e0b',
        summary: `${noActivity.length} asesores sin llamadas hoy`,
        instructions: advisors.map(a => ({
          text: a.pressure.calls.done === 0
            ? `${a.firstName}: Sin llamadas hoy — iniciar ahora (meta: ${DAILY.calls})`
            : `${a.firstName}: ${a.pressure.calls.done}/${DAILY.calls} llamadas — ${a.pressure.calls.done >= DAILY.calls ? 'meta cumplida!' : `faltan ${DAILY.calls - a.pressure.calls.done}`}`,
          priority: a.pressure.calls.done === 0 ? 'critical' : a.pressure.calls.done < DAILY.calls ? 'medium' : 'low',
          deadline: 'Antes de las 6PM',
        })),
      },
      {
        name: 'Performance Agent', icon: '📊', status: 'active', color: '#8b5cf6',
        summary: 'Monitoreo de rendimiento en tiempo real',
        instructions: advisors.map(a => ({
          text: `${a.firstName}: ${a.statusMsg}`,
          priority: a.pressure.overallStatus === 'critical' ? 'critical' : a.pressure.overallStatus === 'behind' ? 'high' : 'low',
          deadline: 'EOD',
          kpi: { calls: `${a.pressure.calls.done}/${DAILY.calls}`, contacts: `${a.pressure.contacts.done}/${DAILY.contacts}`, quotes: `${a.pressure.quotes.done}/${DAILY.quotes}` },
        })),
      },
      {
        name: 'Supervisor Agent', icon: '👁️', status: 'active', color: '#06b6d4',
        summary: `Supervisando ${advisors.length} asesores`,
        instructions: [
          ...noActivity.map(a => ({ text: `${a.name}: 0 actividad hoy — ${a.stats.activeLeads} leads esperando`, priority: 'critical' as const, deadline: 'Inmediato' })),
          ...advisors.filter(a => a.stats.staleLeads > 20).map(a => ({ text: `${a.firstName}: ${a.stats.staleLeads} leads sin contacto >7 dias`, priority: 'high' as const, deadline: 'Esta semana' })),
        ],
      },
      {
        name: 'Revenue Agent', icon: '💎', status: 'active', color: '#10b981',
        summary: `Gap mensual: $${this.fmt(Math.max(0, MONTHLY.revenue * advisors.length - wonAmt))}`,
        instructions: [
          { text: `Revenue mes: $${this.fmt(wonAmt)} / meta equipo: $${this.fmt(MONTHLY.revenue * advisors.length)}`, priority: 'high', deadline: 'Fin de mes' },
          { text: `Pipeline ponderado: $${this.fmt(closing.reduce((s, l) => s + (l.estimatedValue || 0) * 0.5, 0))} en ${closing.length} deals`, priority: 'medium', deadline: 'Continuo' },
          ...advisors.filter(a => a.stats.wonAmount < MONTHLY.revenue * 0.5).map(a => ({
            text: `${a.firstName}: $${this.fmt(a.stats.wonAmount)} cerrado — necesita $${this.fmt(MONTHLY.revenue - a.stats.wonAmount)} mas`,
            priority: 'high' as const, deadline: 'Este mes',
          })),
        ],
      },
      {
        name: 'Closing Agent', icon: '💰', status: 'active', color: '#ec4899',
        summary: `${closing.length} deals activos en cierre ($${this.fmt(closingAmt)})`,
        instructions: advisors.filter(a => a.stats.closingDeals > 0).map(a => ({
          text: `${a.firstName}: Push ${a.stats.closingDeals} deals ($${this.fmt(a.stats.closingValue)})`,
          priority: a.stats.closingDeals > 20 ? 'critical' : 'high',
          deadline: 'Hoy',
          items: a.micro.callFirst.slice(0, 2).map((d: any) => ({ company: d.company, value: d.value })),
        })),
      },
      {
        name: 'Customer Success Agent', icon: '💚', status: 'active', color: '#22c55e',
        summary: `${wonMonth.length} clientes ganados este periodo`,
        instructions: [
          { text: `Monitorear satisfaccion de ${wonMonth.length} clientes activos`, priority: 'medium', deadline: 'Continuo' },
          wonMonth.length > 0 ? { text: `Ultimo cierre: $${this.fmt(wonAmt)} — asegurar onboarding`, priority: 'high', deadline: 'Esta semana' } : null,
        ].filter(Boolean),
      },
    ];
  }

  private buildAssignments(ll: any[], advisors: any[], uMap: Map<string, string>) {
    const unassigned = ll.filter(l => !l.assignedToId && ACTIVE_STAGES.includes(l.status));
    const sorted = advisors.sort((a: any, b: any) => a.stats.activeLeads - b.stats.activeLeads);
    const lightest = sorted[0];
    const heaviest = sorted[sorted.length - 1];

    const recommendations: any[] = [];

    // Unassigned leads
    if (unassigned.length > 0) {
      recommendations.push({
        type: 'new_assignment', priority: 'high',
        text: `${unassigned.length} leads sin asignar — distribuir al equipo`,
        items: unassigned.slice(0, 5).map(l => ({
          company: l.companyName, value: l.estimatedValue || 0, zone: l.zone,
          suggestedAdvisor: lightest?.name || 'Siguiente disponible',
          reason: 'Menor carga de trabajo',
        })),
      });
    }

    // Rebalancing
    if (heaviest && lightest && heaviest.stats.activeLeads - lightest.stats.activeLeads > 20) {
      recommendations.push({
        type: 'rebalance', priority: 'medium',
        text: `Rebalancear: ${heaviest.firstName} tiene ${heaviest.stats.activeLeads} leads, ${lightest.firstName} tiene ${lightest.stats.activeLeads}`,
        suggestedMoves: Math.floor((heaviest.stats.activeLeads - lightest.stats.activeLeads) / 2),
        from: heaviest.name, to: lightest.name,
      });
    }

    // Inactive advisor reassignment
    const inactive = advisors.filter(a => a.pressure.contacts.done === 0 && a.stats.activeLeads > 0);
    for (const a of inactive) {
      const staleHighValue = ll.filter(l => l.assignedToId === a.id && CLOSING_STAGES.includes(l.status) && (l.estimatedValue || 0) > 500_000);
      if (staleHighValue.length > 0) {
        recommendations.push({
          type: 'recovery', priority: 'critical',
          text: `${a.firstName} inactivo con ${staleHighValue.length} deals en cierre >$500K — considerar reasignar`,
          items: staleHighValue.slice(0, 3).map(l => ({ company: l.companyName, value: l.estimatedValue, stage: STAGE_LABELS[l.status] })),
        });
      }
    }

    return {
      unassignedCount: unassigned.length,
      recommendations,
      teamBalance: advisors.map(a => ({ name: a.name, firstName: a.firstName, leads: a.stats.activeLeads, closing: a.stats.closingDeals, pipeline: a.stats.pipelineValue })).sort((a: any, b: any) => b.leads - a.leads),
    };
  }

  private buildSupervisorGuidance(advisors: any[], ll: any[], now: Date) {
    const actions: any[] = [];
    const noActivity = advisors.filter(a => a.pressure.contacts.done === 0);
    const behind = advisors.filter(a => a.pressure.overallStatus !== 'on_track');
    const stuckDeals = ll.filter(l => CLOSING_STAGES.includes(l.status) && l.lastContactedAt && (now.getTime() - l.lastContactedAt.getTime()) > 7 * 86400000);

    if (noActivity.length > 0) {
      actions.push({ type: 'intervene', priority: 'critical', text: `${noActivity.length} asesores sin actividad hoy: ${noActivity.map(a => a.firstName).join(', ')}. Contactar inmediatamente.` });
    }
    if (stuckDeals.length > 0) {
      const amt = stuckDeals.reduce((s, l) => s + (l.estimatedValue || 0), 0);
      actions.push({ type: 'stuck', priority: 'high', text: `${stuckDeals.length} deals en cierre sin contacto 7+ dias ($${this.fmt(amt)}). Revisar y reasignar si necesario.` });
    }

    for (const a of advisors) {
      if (a.stats.closingDeals > 30) actions.push({ type: 'overload', priority: 'medium', text: `${a.firstName} tiene ${a.stats.closingDeals} deals en cierre — considerar redistribuir.` });
      if (a.stats.staleLeads > 30) actions.push({ type: 'stale', priority: 'high', text: `${a.firstName}: ${a.stats.staleLeads} leads sin contacto >7 dias — necesita plan de reactivacion.` });
    }

    // Team health
    const totalCallsToday = advisors.reduce((s, a) => s + a.pressure.calls.done, 0);
    const teamTarget = DAILY.calls * advisors.length;
    const healthStatus = totalCallsToday >= teamTarget * 0.7 ? 'healthy' : totalCallsToday >= teamTarget * 0.3 ? 'warning' : 'critical';

    return {
      actions: actions.sort((a: any, b: any) => (a.priority === 'critical' ? 0 : a.priority === 'high' ? 1 : 2) - (b.priority === 'critical' ? 0 : b.priority === 'high' ? 1 : 2)),
      teamHealth: {
        status: healthStatus,
        callsToday: totalCallsToday, callsTarget: teamTarget,
        activeAdvisors: advisors.filter(a => a.pressure.contacts.done > 0).length,
        totalAdvisors: advisors.length,
        behindCount: behind.length,
      },
    };
  }

  private topGroup(items: any[], field: string): string | null {
    const m = new Map<string, number>();
    for (const i of items) { const k = i[field]; if (k) m.set(k, (m.get(k) || 0) + 1); }
    let top = null; let max = 0;
    for (const [k, v] of m) { if (v > max) { max = v; top = k; } }
    return top;
  }

  private fmt(n: number) { return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : n.toFixed(0); }
}
