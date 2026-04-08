import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

const DEFAULT_META_MENSUAL = 500_000;

const DEAL_STAGES = [
  'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO',
];

const CLOSING_STAGES = [
  'COTIZACION_ENTREGADA', 'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO',
];

@Injectable()
export class MetasService {
  constructor(private prisma: PrismaService) {}

  async getMetas() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [advisors, leads] = await Promise.all([
      this.prisma.user.findMany({
        where: { isActive: true, role: 'OPERATOR' as any, deletedAt: null },
        select: { id: true, firstName: true, lastName: true },
      }),
      this.prisma.lead.findMany({
        where: { isHistorical: false, deletedAt: null },
        select: {
          id: true, companyName: true, status: true,
          assignedToId: true, estimatedValue: true,
          createdAt: true, updatedAt: true,
        },
      }),
    ]);

    const ll: any[] = leads;

    const asesores = advisors.map((adv: any) => {
      const advLeads = ll.filter((l: any) => l.assignedToId === adv.id);

      const wonThisMonth = advLeads.filter(
        (l: any) => l.status === 'CERRADO_GANADO' && l.updatedAt >= monthStart,
      );
      const ventasCerradas = wonThisMonth.reduce(
        (sum: number, l: any) => sum + (l.estimatedValue || 0), 0,
      );

      const pipelineLeads = advLeads.filter(
        (l: any) => DEAL_STAGES.includes(l.status),
      );
      const pipelineActivo = pipelineLeads.reduce(
        (sum: number, l: any) => sum + (l.estimatedValue || 0), 0,
      );

      const metaMensual = DEFAULT_META_MENSUAL;
      const faltante = Math.max(0, metaMensual - ventasCerradas);
      const cumplimiento = metaMensual > 0 ? Math.round((ventasCerradas / metaMensual) * 100) : 0;

      const dealsToClose = advLeads
        .filter((l: any) => CLOSING_STAGES.includes(l.status))
        .map((l: any) => ({
          id: l.id,
          companyName: l.companyName,
          estimatedValue: l.estimatedValue || 0,
          status: l.status,
          daysInStage: l.updatedAt
            ? Math.floor((now.getTime() - l.updatedAt.getTime()) / 86_400_000)
            : 0,
        }))
        .sort((a: any, b: any) => b.estimatedValue - a.estimatedValue);

      return {
        advisorId: adv.id,
        advisorName: `${adv.firstName} ${adv.lastName}`.trim(),
        metaMensual,
        ventasCerradas,
        pipelineActivo,
        cumplimiento,
        faltante,
        dealsToClose,
      };
    });

    const metaTotal = asesores.reduce((s: number, a: any) => s + a.metaMensual, 0);
    const ventasCerradas = asesores.reduce((s: number, a: any) => s + a.ventasCerradas, 0);
    const pipelineActivo = asesores.reduce((s: number, a: any) => s + a.pipelineActivo, 0);
    const cumplimiento = metaTotal > 0 ? Math.round((ventasCerradas / metaTotal) * 100) : 0;

    return {
      equipo: { metaTotal, ventasCerradas, pipelineActivo, cumplimiento },
      asesores,
    };
  }
}
