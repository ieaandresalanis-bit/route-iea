import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

const DAILY_TARGETS: Record<string, number> = {
  llamadas: 15,
  intentosContacto: 25,
  seguimientos: 10,
  cotizacionesEntregadas: 2,
  tratosMovidos: 3,
  tratosCerrados: 1,
  reactivaciones: 2,
};

const METRIC_LABELS: Record<string, string> = {
  llamadas: 'Llamadas',
  intentosContacto: 'Intentos de Contacto',
  seguimientos: 'Seguimientos',
  cotizacionesEntregadas: 'Cotizaciones Entregadas',
  tratosMovidos: 'Tratos Movidos',
  tratosCerrados: 'Tratos Cerrados',
  reactivaciones: 'Reactivaciones',
};

const WEEKLY_MULT = 5;
const MONTHLY_MULT = 22;
const CONTACT_TYPES = ['call', 'follow_up', 'whatsapp', 'email'];

@Injectable()
export class KpiTrackingService {
  constructor(private prisma: PrismaService) {}

  async getDashboard() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [advisors, tasks, leads] = await Promise.all([
      this.prisma.user.findMany({
        where: { isActive: true, role: 'OPERATOR' as any, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
      this.prisma.salesTask.findMany({
        where: { isHistorical: false },
        select: {
          id: true, advisorId: true, type: true, status: true,
          completedAt: true, createdAt: true, pipelineMoved: true,
        },
      }),
      this.prisma.lead.findMany({
        where: { isHistorical: false, deletedAt: null },
        select: {
          id: true, companyName: true, status: true,
          assignedToId: true, estimatedValue: true, createdAt: true, updatedAt: true,
        },
      }),
    ]);

    const tt: any[] = tasks;
    const ll: any[] = leads;

    // Per-advisor resumen diario raw data
    const resumenMap = new Map<string, any>();

    const advisorResults = advisors.map((adv: any) => {
      const advTasks = tt.filter((t: any) => t.advisorId === adv.id);
      const advLeads = ll.filter((l: any) => l.assignedToId === adv.id);

      const hoyRaw = this.computeMetrics(advTasks, advLeads, todayStart, now);
      const semanaRaw = this.computeMetrics(advTasks, advLeads, weekStart, now);
      const mesRaw = this.computeMetrics(advTasks, advLeads, monthStart, now);

      const today = this.buildPeriodData(hoyRaw, DAILY_TARGETS, 1);
      const week = this.buildPeriodData(semanaRaw, DAILY_TARGETS, WEEKLY_MULT);
      const month = this.buildPeriodData(mesRaw, DAILY_TARGETS, MONTHLY_MULT);

      const completionPct = today.totalScore;
      const score =
        mesRaw.llamadas * 1 +
        mesRaw.intentosContacto * 0.5 +
        mesRaw.cotizacionesEntregadas * 3 +
        mesRaw.tratosCerrados * 10;

      const alerts = this.generateAlerts(hoyRaw, DAILY_TARGETS, mesRaw);

      // Store raw for resumen
      resumenMap.set(adv.id, { hoyRaw, mesRaw });

      return {
        advisorId: adv.id,
        advisorName: `${adv.firstName} ${adv.lastName}`.trim(),
        email: adv.email,
        score,
        completionPct,
        today,
        week,
        month,
        alerts,
        dailySummary: {
          done: this.buildDone(hoyRaw),
          pending: this.buildPending(hoyRaw, DAILY_TARGETS),
          recommendations: this.buildRecommendations(hoyRaw, DAILY_TARGETS, mesRaw),
        },
      };
    });

    // Team totals
    const teamTotals = {
      today: this.buildTeamTotals(advisorResults, 'today', 1),
      week: this.buildTeamTotals(advisorResults, 'week', WEEKLY_MULT),
      month: this.buildTeamTotals(advisorResults, 'month', MONTHLY_MULT),
    };

    return {
      advisors: advisorResults,
      teamTotals,
      generatedAt: now.toISOString(),
    };
  }

  async getAdvisorKpi(advisorId: string) {
    const dashboard = await this.getDashboard();
    const advisor = dashboard.advisors.find((a: any) => a.advisorId === advisorId);
    if (!advisor) return { error: 'Asesor no encontrado' };
    const rankSorted = [...dashboard.advisors].sort((a: any, b: any) => b.score - a.score);
    const rankPos = rankSorted.findIndex((r: any) => r.advisorId === advisorId) + 1;
    return { ...advisor, rankingPosition: rankPos, totalAdvisors: rankSorted.length };
  }

  // ── Private ──

  private computeMetrics(tasks: any[], leads: any[], from: Date, to: Date) {
    const periodTasks = tasks.filter((t: any) => t.createdAt >= from && t.createdAt < to);
    const completed = periodTasks.filter((t: any) => t.status === 'completed');
    return {
      llamadas: completed.filter((t: any) => t.type === 'call').length,
      intentosContacto: periodTasks.filter((t: any) => CONTACT_TYPES.includes(t.type)).length,
      seguimientos: completed.filter((t: any) => t.type === 'follow_up').length,
      cotizacionesEntregadas: leads.filter(
        (l: any) => l.status === 'COTIZACION_ENTREGADA' && l.updatedAt >= from && l.updatedAt < to,
      ).length,
      tratosMovidos: periodTasks.filter((t: any) => t.pipelineMoved).length,
      tratosCerrados: leads.filter(
        (l: any) => l.status === 'CERRADO_GANADO' && l.updatedAt >= from && l.updatedAt < to,
      ).length,
      reactivaciones: periodTasks.filter((t: any) => t.type === 'reactivation').length,
    };
  }

  private buildPeriodData(
    raw: Record<string, number>,
    baseTgt: Record<string, number>,
    mult: number,
  ) {
    const keys = Object.keys(baseTgt);
    const metrics = keys.map((k: string) => {
      const actual = raw[k] || 0;
      const meta = (baseTgt[k] || 0) * mult;
      const pct = meta > 0 ? Math.min(Math.round((actual / meta) * 100), 100) : 0;
      return { key: k, label: METRIC_LABELS[k] || k, actual, meta, pct };
    });
    const totalScore =
      keys.length > 0
        ? Math.round(metrics.reduce((s: number, m: any) => s + m.pct, 0) / keys.length)
        : 0;
    return { metrics, totalScore };
  }

  private buildTeamTotals(advisorResults: any[], periodKey: string, mult: number) {
    const result: Record<string, number> = {};
    const metaResult: Record<string, number> = {};
    for (const k of Object.keys(DAILY_TARGETS)) {
      result[k] = 0;
      metaResult[`meta${k.charAt(0).toUpperCase()}${k.slice(1)}`] = (DAILY_TARGETS[k] || 0) * mult * advisorResults.length;
    }
    for (const adv of advisorResults) {
      const period = adv[periodKey];
      if (!period?.metrics) continue;
      for (const m of period.metrics) {
        if (result[m.key] !== undefined) result[m.key] += m.actual;
      }
    }
    return { ...result, ...metaResult };
  }

  private generateAlerts(
    hoy: Record<string, number>,
    targets: Record<string, number>,
    mes: Record<string, number>,
  ): string[] {
    const alerts: string[] = [];
    const faltanLlamadas = targets.llamadas - (hoy.llamadas || 0);
    if (faltanLlamadas > 0) alerts.push(`Te faltan ${faltanLlamadas} llamadas para tu meta diaria`);
    if ((hoy.cotizacionesEntregadas || 0) === 0) alerts.push('No has entregado cotizacion hoy');
    const pctMes = targets.tratosCerrados * MONTHLY_MULT > 0
      ? Math.round(((mes.tratosCerrados || 0) / (targets.tratosCerrados * MONTHLY_MULT)) * 100) : 0;
    if (pctMes < 50 && new Date().getDate() > 15) alerts.push('Vas atrasado en cierre este mes');
    const keys = Object.keys(targets);
    const pctDia = keys.length > 0
      ? Math.round(keys.reduce((s: number, k: string) => s + Math.min((hoy[k] || 0) / (targets[k] || 1), 1), 0) / keys.length * 100) : 0;
    alerts.push(`Vas al ${pctDia}% de tu meta diaria`);
    const faltanSeg = targets.seguimientos - (hoy.seguimientos || 0);
    if (faltanSeg > 0) alerts.push(`Te faltan ${faltanSeg} seguimientos hoy`);
    return alerts;
  }

  private buildDone(hoy: Record<string, number>): string[] {
    const items: string[] = [];
    if (hoy.llamadas > 0) items.push(`${hoy.llamadas} llamadas realizadas`);
    if (hoy.seguimientos > 0) items.push(`${hoy.seguimientos} seguimientos completados`);
    if (hoy.intentosContacto > 0) items.push(`${hoy.intentosContacto} intentos de contacto`);
    if (hoy.cotizacionesEntregadas > 0) items.push(`${hoy.cotizacionesEntregadas} cotizaciones entregadas`);
    if (hoy.tratosMovidos > 0) items.push(`${hoy.tratosMovidos} tratos movidos en pipeline`);
    if (hoy.tratosCerrados > 0) items.push(`${hoy.tratosCerrados} tratos cerrados`);
    if (hoy.reactivaciones > 0) items.push(`${hoy.reactivaciones} reactivaciones`);
    if (items.length === 0) items.push('Sin actividad registrada hoy');
    return items;
  }

  private buildPending(hoy: Record<string, number>, targets: Record<string, number>): string[] {
    const items: string[] = [];
    const diff = (key: string, label: string) => {
      const falta = (targets[key] || 0) - (hoy[key] || 0);
      if (falta > 0) items.push(`Faltan ${falta} ${label}`);
    };
    diff('llamadas', 'llamadas');
    diff('intentosContacto', 'intentos de contacto');
    diff('seguimientos', 'seguimientos');
    diff('cotizacionesEntregadas', 'cotizaciones por entregar');
    diff('tratosMovidos', 'tratos por mover');
    diff('tratosCerrados', 'cierres pendientes');
    diff('reactivaciones', 'reactivaciones');
    if (items.length === 0) items.push('Meta diaria cumplida');
    return items;
  }

  private buildRecommendations(
    hoy: Record<string, number>,
    targets: Record<string, number>,
    mes: Record<string, number>,
  ): string[] {
    const recs: string[] = [];
    if ((hoy.llamadas || 0) < targets.llamadas * 0.5)
      recs.push('Priorizar llamadas: estas por debajo del 50% de tu meta');
    if ((hoy.cotizacionesEntregadas || 0) === 0)
      recs.push('Enviar al menos una cotizacion antes de terminar el dia');
    if ((mes.tratosCerrados || 0) < targets.tratosCerrados * MONTHLY_MULT * 0.5 && new Date().getDate() > 15)
      recs.push('Enfocarse en cierre: estas atrasado en meta mensual');
    if ((hoy.seguimientos || 0) < targets.seguimientos * 0.3)
      recs.push('Realizar seguimientos pendientes antes de nuevas llamadas');
    if (recs.length === 0) recs.push('Buen ritmo, mantener la ejecucion');
    return recs;
  }
}
