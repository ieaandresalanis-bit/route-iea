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

const STAGE_ORDER = [
  'PENDIENTE_CONTACTAR', 'INTENTANDO_CONTACTAR', 'EN_PROSPECCION',
  'AGENDAR_CITA', 'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO', 'CERRADO_GANADO', 'CERRADO_PERDIDO',
  'CONTACTAR_FUTURO', 'LEAD_BASURA',
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

const VALUE_RANGES = [
  { label: '$0 - $100K', min: 0, max: 100_000 },
  { label: '$100K - $500K', min: 100_000, max: 500_000 },
  { label: '$500K - $1M', min: 500_000, max: 1_000_000 },
  { label: '$1M - $5M', min: 1_000_000, max: 5_000_000 },
  { label: '$5M+', min: 5_000_000, max: Infinity },
];

@Injectable()
export class LeadsIntelligenceService {
  constructor(private prisma: PrismaService) {}

  async getAnalytics() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [leads, tasks, users] = await Promise.all([
      this.prisma.lead.findMany({
        where: { deletedAt: null, isHistorical: false },
        select: {
          id: true, companyName: true, zone: true, status: true,
          source: true, industry: true, estimatedValue: true,
          assignedToId: true, createdAt: true, lastContactedAt: true,
        },
      }),
      this.prisma.salesTask.findMany({
        where: { leadId: { not: null } },
        select: {
          leadId: true, type: true, status: true,
          completedAt: true, createdAt: true,
        },
      }),
      this.prisma.user.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);

    const uMap = new Map<string, string>(users.map((u: any) => [u.id, `${u.firstName} ${u.lastName}`]));
    const ll: any[] = leads;
    const tt: any[] = tasks;
    const done = tt.filter(t => t.status === 'completed');

    // ── SUMMARY ──
    const active = ll.filter(l => ACTIVE_STAGES.includes(l.status));
    const closing = ll.filter(l => CLOSING_STAGES.includes(l.status));
    const won = ll.filter(l => l.status === 'CERRADO_GANADO');
    const lost = ll.filter(l => l.status === 'CERRADO_PERDIDO');
    const totalVal = ll.reduce((s: number, l: any) => s + (l.estimatedValue || 0), 0);
    const summary = {
      total: ll.length, active: active.length, inClosing: closing.length,
      won: won.length, lost: lost.length, totalValue: totalVal,
      avgValue: ll.length ? totalVal / ll.length : 0,
    };

    // ── CREATED ──
    const created = {
      today: ll.filter(l => l.createdAt >= todayStart).length,
      thisWeek: ll.filter(l => l.createdAt >= weekStart).length,
      thisMonth: ll.filter(l => l.createdAt >= monthStart).length,
      byMonth: this.monthly(now, ll, l => l.createdAt),
      byAdvisor: this.bdBy(ll, l => l.assignedToId ? uMap.get(l.assignedToId) || 'Sin asignar' : 'Sin asignar'),
      byZone: this.bdBy(ll, l => l.zone),
      byIndustry: this.bdBy(ll.filter(l => l.industry), l => l.industry),
      bySource: this.bdBy(ll, l => l.source),
    };

    // ── VALUE ──
    const wv = ll.filter(l => l.estimatedValue && l.estimatedValue > 0);
    const value = {
      total: totalVal,
      avg: wv.length ? wv.reduce((s, l) => s + l.estimatedValue, 0) / wv.length : 0,
      byRange: VALUE_RANGES.map(r => {
        const m = wv.filter(l => l.estimatedValue >= r.min && l.estimatedValue < r.max);
        return { name: r.label, count: m.length, amount: m.reduce((s, l) => s + l.estimatedValue, 0) };
      }),
      byZone: this.bdAmt(wv, l => l.zone),
      byIndustry: this.bdAmt(wv.filter(l => l.industry), l => l.industry),
    };

    // ── CONTACT INTELLIGENCE ──
    const touchIds = (since: Date) => new Set(done.filter(t => t.completedAt && t.completedAt >= since).map(t => t.leadId)).size;
    const contact = {
      touchedToday: touchIds(todayStart),
      touchedWeek: touchIds(weekStart),
      touchedMonth: touchIds(monthStart),
      avgTouches: ll.length ? Math.round((done.length / ll.length) * 10) / 10 : 0,
      byType: this.bdBy(done, t => t.type),
      untouched: active
        .map(l => ({
          id: l.id, company: l.companyName, zone: l.zone,
          advisor: uMap.get(l.assignedToId || '') || 'Sin asignar',
          value: l.estimatedValue || 0,
          days: l.lastContactedAt ? Math.floor((now.getTime() - l.lastContactedAt.getTime()) / 86400000) : 999,
        }))
        .filter(l => l.days > 3)
        .sort((a, b) => b.value - a.value)
        .slice(0, 15),
    };

    // ── CONVERSION ──
    const convRate = ll.length ? Math.round((won.length / ll.length) * 1000) / 10 : 0;
    const conversion = {
      won: won.length, lost: lost.length, rate: convRate,
      byAdvisor: this.conv(ll, won, l => l.assignedToId ? uMap.get(l.assignedToId) || 'Sin asignar' : 'Sin asignar'),
      byZone: this.conv(ll, won, l => l.zone),
      byIndustry: this.conv(ll.filter(l => l.industry), won.filter(l => l.industry), l => l.industry),
      bySource: this.conv(ll, won, l => l.source),
    };

    // ── SEGMENTATION ──
    const segmentation = {
      byStatus: STAGE_ORDER.map(s => {
        const m = ll.filter(l => l.status === s);
        return { name: STAGE_LABELS[s] || s, status: s, count: m.length, amount: m.reduce((x, l) => x + (l.estimatedValue || 0), 0) };
      }).filter(s => s.count > 0),
      byZone: this.bdAmt(ll, l => l.zone),
      byIndustry: this.bdAmt(ll.filter(l => l.industry), l => l.industry),
      bySource: this.bdAmt(ll, l => l.source),
    };

    // ── INSIGHTS ──
    const insights = this.mkInsights(ll, won, lost, active, closing, value.byZone, value.byIndustry, created.byAdvisor);

    // ── LABELS ──
    const labels = this.mkLabels(ll, uMap);

    return { summary, created, value, contact, conversion, segmentation, insights, labels };
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

  private conv<T>(all: T[], won: T[], fn: (i: T) => string) {
    const g = new Map<string, { t: number; w: number }>();
    for (const i of all) { const k = fn(i); const e = g.get(k) || { t: 0, w: 0 }; e.t++; g.set(k, e); }
    for (const i of won) { const k = fn(i); const e = g.get(k); if (e) e.w++; }
    return [...g.entries()].map(([name, v]) => ({ name, total: v.t, converted: v.w, rate: v.t ? Math.round((v.w / v.t) * 1000) / 10 : 0 })).sort((a, b) => b.total - a.total);
  }

  private monthly(now: Date, items: any[], fn: (i: any) => Date) {
    const r: { month: string; count: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const s = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const e = new Date(s.getFullYear(), s.getMonth() + 1, 1);
      r.push({ month: s.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }), count: items.filter(x => { const d = fn(x); return d >= s && d < e; }).length });
    }
    return r;
  }

  private fmt(n: number) { return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : n.toFixed(0); }

  private mkInsights(leads: any[], won: any[], lost: any[], active: any[], closing: any[], vZone: any[], vInd: any[], bAdv: any[]) {
    const ins: string[] = [];
    if (vZone[0]) ins.push(`Mayor oportunidad: zona ${vZone[0].name} con $${this.fmt(vZone[0].amount)} en ${vZone[0].count} leads`);
    if (vInd[0]) ins.push(`Industria top: "${vInd[0].name}" — $${this.fmt(vInd[0].amount)}, ticket promedio $${this.fmt(vInd[0].avg)}`);
    if (bAdv[0]) ins.push(`${bAdv[0].name} tiene mas leads: ${bAdv[0].count}`);
    if (closing.length > 0) {
      const amt = closing.reduce((s: number, l: any) => s + (l.estimatedValue || 0), 0);
      ins.push(`${closing.length} deals en cierre por $${this.fmt(amt)} — prioridad cerrar`);
    }
    if (won.length + lost.length > 0) ins.push(`Win rate: ${Math.round((won.length / (won.length + lost.length)) * 100)}% (${won.length} ganados, ${lost.length} perdidos)`);
    const hv = active.filter((l: any) => {
      const d = l.lastContactedAt ? Math.floor((Date.now() - l.lastContactedAt.getTime()) / 86400000) : 999;
      return (l.estimatedValue || 0) > 1_000_000 && d > 7;
    });
    if (hv.length > 0) ins.push(`${hv.length} leads >$1M sin contacto en 7+ dias — oportunidad en riesgo`);
    // Stage bottleneck
    const stageCount = STAGE_ORDER.map(s => ({ s, c: leads.filter((l: any) => l.status === s).length }));
    const biggest = stageCount.filter(s => ACTIVE_STAGES.includes(s.s)).sort((a, b) => b.c - a.c)[0];
    if (biggest && biggest.c > 20) ins.push(`Cuello de botella: ${STAGE_LABELS[biggest.s]} con ${biggest.c} leads atascados`);
    return ins;
  }

  private mkLabels(leads: any[], uMap: Map<string, string>) {
    const labels: { label: string; count: number; type: string; color: string }[] = [];
    const byAdv = (arr: any[]) => {
      const m = new Map<string, number>();
      for (const l of arr) { if (l.assignedToId) m.set(l.assignedToId, (m.get(l.assignedToId) || 0) + 1); }
      return m;
    };
    for (const [id, c] of byAdv(leads.filter(l => CLOSING_STAGES.includes(l.status))))
      labels.push({ label: `Cerrar ${(uMap.get(id) || '').split(' ')[0]}`, count: c, type: 'closing', color: 'red' });
    for (const [id, c] of byAdv(leads.filter(l => ACTIVE_STAGES.includes(l.status) && l.lastContactedAt && (Date.now() - l.lastContactedAt.getTime()) > 14 * 86400000)))
      labels.push({ label: `Reactivar ${(uMap.get(id) || '').split(' ')[0]}`, count: c, type: 'reactivation', color: 'orange' });
    for (const [id, c] of byAdv(leads.filter(l => ACTIVE_STAGES.includes(l.status) && (l.estimatedValue || 0) > 1_000_000)))
      labels.push({ label: `High Value ${(uMap.get(id) || '').split(' ')[0]}`, count: c, type: 'high_value', color: 'purple' });
    for (const [id, c] of byAdv(leads.filter(l => l.status === 'PENDIENTE_CONTACTAR')))
      labels.push({ label: `1er Contacto ${(uMap.get(id) || '').split(' ')[0]}`, count: c, type: 'first_contact', color: 'blue' });
    return labels.sort((a, b) => b.count - a.count);
  }
}
