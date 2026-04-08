import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

const DEAL_AND_WON_STAGES = [
  'ESPERANDO_COTIZACION', 'COTIZACION_ENTREGADA',
  'ESPERANDO_CONTRATO', 'PENDIENTE_PAGO', 'CERRADO_GANADO',
];

const FINANCING_LABELS: Record<string, string> = {
  CASHBOLT: 'Cashbolt',
  ASPIRIA: 'Aspiria',
  CONTADO: 'Contado',
  ARRENDAMIENTO: 'Arrendamiento',
  OTRO: 'Otro',
};

const STAGE_LABELS: Record<string, string> = {
  NA: 'Sin etapa',
  DOCUMENTACION: 'Documentacion',
  INGRESADO: 'Ingresado',
  APROBADO: 'Aprobado',
  INSTALACION: 'Instalacion',
  COBRO: 'Cobro',
};

const FINANCING_TYPES = ['CASHBOLT', 'ASPIRIA', 'CONTADO', 'ARRENDAMIENTO', 'OTRO'];
const FINANCIAL_STAGES = ['NA', 'DOCUMENTACION', 'INGRESADO', 'APROBADO', 'INSTALACION', 'COBRO'];

@Injectable()
export class FinanzasService {
  constructor(private prisma: PrismaService) {}

  async getDashboard() {
    const [leads, users] = await Promise.all([
      this.prisma.lead.findMany({
        where: {
          isHistorical: false,
          deletedAt: null,
          status: { in: DEAL_AND_WON_STAGES as any },
        },
        select: {
          id: true, companyName: true, status: true,
          estimatedValue: true, financingType: true, financialStage: true,
          assignedToId: true,
        },
      }),
      this.prisma.user.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);

    const ll: any[] = leads;
    const uMap = new Map<string, string>(
      users.map((u: any) => [u.id, `${u.firstName} ${u.lastName}`]),
    );

    // Pipeline with counts
    const aprobadoLeads = ll.filter((l: any) => l.financialStage === 'APROBADO');
    const pendienteLeads = ll.filter((l: any) => ['DOCUMENTACION', 'INGRESADO'].includes(l.financialStage));
    const instalacionLeads = ll.filter((l: any) => l.financialStage === 'INSTALACION');
    const cobroLeads = ll.filter((l: any) => l.financialStage === 'COBRO');

    const pipeline = {
      totalEnJuego: ll.reduce((s: number, l: any) => s + (l.estimatedValue || 0), 0),
      totalAprobado: aprobadoLeads.reduce((s: number, l: any) => s + (l.estimatedValue || 0), 0),
      totalPendiente: pendienteLeads.reduce((s: number, l: any) => s + (l.estimatedValue || 0), 0),
      enInstalacion: instalacionLeads.reduce((s: number, l: any) => s + (l.estimatedValue || 0), 0),
      porCobrar: cobroLeads.reduce((s: number, l: any) => s + (l.estimatedValue || 0), 0),
      countEnJuego: ll.length,
      countAprobado: aprobadoLeads.length,
      countPendiente: pendienteLeads.length,
      countInstalacion: instalacionLeads.length,
      countCobrar: cobroLeads.length,
    };

    // Por Financiera
    const porFinanciera = FINANCING_TYPES.map((tipo: string) => {
      const matched = ll.filter((l: any) => l.financingType === tipo);
      const montoTotal = matched.reduce((s: number, l: any) => s + (l.estimatedValue || 0), 0);
      return {
        nombre: FINANCING_LABELS[tipo] || tipo,
        proyectos: matched.length,
        montoTotal,
        ticketPromedio: matched.length > 0 ? Math.round(montoTotal / matched.length) : 0,
      };
    }).filter((r: any) => r.proyectos > 0);

    // Por Etapa
    const etapas = FINANCIAL_STAGES.map((etapa: string) => {
      const matched = ll.filter((l: any) => l.financialStage === etapa);
      return {
        etapa,
        label: STAGE_LABELS[etapa] || etapa,
        count: matched.length,
        monto: matched.reduce((s: number, l: any) => s + (l.estimatedValue || 0), 0),
      };
    }).filter((r: any) => r.count > 0);

    // Proyectos detail
    const proyectos = ll.map((l: any) => ({
      id: l.id,
      empresa: l.companyName,
      monto: l.estimatedValue || 0,
      financiera: FINANCING_LABELS[l.financingType] || l.financingType || 'Otro',
      etapaFinanciera: STAGE_LABELS[l.financialStage] || l.financialStage || 'Sin etapa',
      asesor: l.assignedToId ? uMap.get(l.assignedToId) || 'Sin asignar' : 'Sin asignar',
      statusVenta: l.status,
    })).sort((a: any, b: any) => b.monto - a.monto);

    return { pipeline, porFinanciera, etapas, proyectos };
  }
}
