import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class DemoSeedService {
  private readonly logger = new Logger(DemoSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Helpers ────────────────────────────────────────────────────

  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private randomFloat(min: number, max: number, decimals = 4): number {
    return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
  }

  private randomPick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  private randomDate(daysAgo: number): Date {
    const now = new Date();
    const ms = now.getTime() - Math.random() * daysAgo * 24 * 60 * 60 * 1000;
    return new Date(ms);
  }

  private daysAgoDate(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
  }

  private gpsOffset(baseLat: number, baseLng: number, radiusKm = 5): { lat: number; lng: number } {
    const latOffset = (Math.random() - 0.5) * (radiusKm / 111);
    const lngOffset = (Math.random() - 0.5) * (radiusKm / (111 * Math.cos((baseLat * Math.PI) / 180)));
    return {
      lat: parseFloat((baseLat + latOffset).toFixed(6)),
      lng: parseFloat((baseLng + lngOffset).toFixed(6)),
    };
  }

  // ── Main seed method ──────────────────────────────────────────

  async seedActivityData() {
    this.logger.log('Starting demo seed of historical activity data...');
    const results: Record<string, any> = {};

    // Fetch existing data
    const allLeads = await this.prisma.lead.findMany({ where: { deletedAt: null } });
    const allUsers = await this.prisma.user.findMany({ where: { isActive: true, deletedAt: null } });

    if (allLeads.length === 0 || allUsers.length === 0) {
      return { error: 'No leads or users found. Seed base data first.' };
    }

    this.logger.log(`Found ${allLeads.length} leads and ${allUsers.length} users`);

    // Step 1: Update leads with lastContactedAt
    results.leadsContacted = await this.seedLastContactedAt(allLeads);

    // Step 2: Create visits
    results.visitsCreated = await this.seedVisits(allLeads, allUsers);

    // Step 3: Create won deals + client profiles
    results.wonDeals = await this.seedWonDeals(allLeads, allUsers);

    // Step 4: Create sales alerts
    results.alertsCreated = await this.seedSalesAlerts(allLeads, allUsers);

    // Step 5: Update follow-up sequences
    results.sequencesUpdated = await this.seedFollowUpSequences(allLeads, allUsers);

    // Step 6: Zone diversity
    results.zonesUpdated = await this.seedZoneDiversity(allLeads);

    // Step 7: Industry diversity
    results.industriesUpdated = await this.seedIndustryDiversity(allLeads);

    this.logger.log('Demo seed completed successfully');
    return { success: true, timestamp: new Date().toISOString(), results };
  }

  // ── Step 1: Last contacted dates ──────────────────────────────

  private async seedLastContactedAt(leads: any[]): Promise<number> {
    const toContact = Math.floor(leads.length * 0.8);
    const shuffled = [...leads].sort(() => Math.random() - 0.5);
    let updated = 0;

    for (let i = 0; i < toContact; i++) {
      const lead = shuffled[i];
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: { lastContactedAt: this.randomDate(30) },
      });
      updated++;
    }

    this.logger.log(`Updated ${updated} leads with lastContactedAt`);
    return updated;
  }

  // ── Step 2: Visits ────────────────────────────────────────────

  private async seedVisits(leads: any[], users: any[]): Promise<number> {
    const visitCount = this.randomInt(300, 500);
    const outcomes: Array<'SUCCESSFUL' | 'FOLLOW_UP' | 'RESCHEDULED' | 'NO_SHOW' | 'NOT_INTERESTED'> = [];

    // Build weighted outcome pool
    for (let i = 0; i < 40; i++) outcomes.push('SUCCESSFUL');
    for (let i = 0; i < 20; i++) outcomes.push('FOLLOW_UP');
    for (let i = 0; i < 15; i++) outcomes.push('RESCHEDULED');
    for (let i = 0; i < 15; i++) outcomes.push('NO_SHOW');
    for (let i = 0; i < 10; i++) outcomes.push('NOT_INTERESTED');

    const visitNotes = [
      'Cliente muy interesado en el proyecto. Solicita cotización formal para la próxima semana.',
      'Se presentó propuesta de paneles solares. El cliente pide revisar con su socio.',
      'Visita de seguimiento. El cliente confirma interés pero necesita aprobación del consejo.',
      'Recorrido por las instalaciones del cliente. Se tomaron medidas para dimensionamiento.',
      'Primera visita. Se explicaron beneficios del sistema. Buen rapport con el contacto.',
      'El cliente canceló por agenda. Se reagendó para la próxima semana.',
      'No se encontró al contacto. Se dejó tarjeta y material informativo.',
      'Presentación técnica exitosa. El cliente solicita contrato para revisión.',
      'Visita de cierre. Se firmó carta intención. Pendiente documentación fiscal.',
      'Cliente comparando con competencia. Se reforzaron diferenciadores y garantía.',
      'Reunión con el gerente de operaciones. Interés en reducir costos de energía.',
      'Se entregó cotización actualizada. El cliente la revisará esta semana.',
      'Visita post-venta para verificar satisfacción con la instalación.',
      'Demostración del sistema de monitoreo. Cliente impresionado con los ahorros proyectados.',
      'Negociación de condiciones de pago. El cliente propone esquema a 12 meses.',
      'Se visitó planta industrial. Gran potencial para instalación de 50kW.',
      'Contacto no disponible. Secretaria tomó datos para reagendar.',
      'Visita técnica para evaluar estructura del techo y capacidad eléctrica.',
      'Reunión con director financiero. Análisis de retorno de inversión presentado.',
      'Cliente decidió no avanzar por el momento. Se dejó puerta abierta para futuro.',
    ];

    const followUpNotes = [
      'Enviar cotización actualizada por email',
      'Llamar para confirmar reunión con el socio',
      'Preparar propuesta técnica detallada',
      'Coordinar visita técnica para mediciones',
      'Enviar referencias de proyectos similares',
      'Dar seguimiento a la decisión del consejo',
      'Reagendar visita para la próxima semana',
      'Enviar contrato para revisión legal',
      null,
      null,
    ];

    const gdlBase = { lat: 20.6597, lng: -103.3496 };
    let created = 0;

    for (let i = 0; i < visitCount; i++) {
      const lead = this.randomPick(leads);
      const user = this.randomPick(users);
      const outcome = this.randomPick(outcomes);
      const visitDate = this.randomDate(60);
      const checkIn = this.gpsOffset(lead.latitude || gdlBase.lat, lead.longitude || gdlBase.lng, 2);
      const checkOut = this.gpsOffset(checkIn.lat, checkIn.lng, 0.5);

      const checkInAt = new Date(visitDate.getTime() + this.randomInt(0, 2) * 60 * 60 * 1000);
      const durationMins = this.randomInt(15, 90);
      const checkOutAt = new Date(checkInAt.getTime() + durationMins * 60 * 1000);

      const followUpDate = outcome === 'FOLLOW_UP' || outcome === 'RESCHEDULED'
        ? new Date(visitDate.getTime() + this.randomInt(2, 14) * 24 * 60 * 60 * 1000)
        : null;

      try {
        await this.prisma.visit.create({
          data: {
            leadId: lead.id,
            visitedById: user.id,
            visitDate,
            outcome,
            checkInLat: checkIn.lat,
            checkInLng: checkIn.lng,
            checkOutLat: checkOut.lat,
            checkOutLng: checkOut.lng,
            checkInAt,
            checkOutAt,
            notes: this.randomPick(visitNotes),
            followUpDate,
            followUpNotes: this.randomPick(followUpNotes),
          },
        });
        created++;
      } catch (err) {
        this.logger.warn(`Failed to create visit ${i}: ${err.message}`);
      }
    }

    this.logger.log(`Created ${created} visits`);
    return created;
  }

  // ── Step 3: Won deals + client profiles ───────────────────────

  private async seedWonDeals(leads: any[], users: any[]): Promise<number> {
    const wonCount = this.randomInt(15, 25);
    // Pick leads that are NOT already CERRADO_GANADO
    const eligible = leads.filter(
      (l) => l.status !== 'CERRADO_GANADO' && l.status !== 'CERRADO_PERDIDO' && l.status !== 'LEAD_BASURA',
    );
    const shuffled = [...eligible].sort(() => Math.random() - 0.5).slice(0, wonCount);
    let created = 0;

    const systemSizes = ['5kW', '8kW', '10kW', '15kW', '20kW', '30kW', '50kW', '75kW', '100kW'];

    for (const lead of shuffled) {
      const ticketValue = this.randomInt(50, 500) * 1000; // $50K-$500K MXN
      const convertedAt = this.randomDate(90);
      const advisor = this.randomPick(users);

      try {
        // Update lead status
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: {
            status: 'CERRADO_GANADO',
            convertedAt,
            estimatedValue: ticketValue,
            lastContactedAt: convertedAt,
          },
        });

        // Check if client profile already exists
        const existing = await this.prisma.clientProfile.findUnique({
          where: { leadId: lead.id },
        });

        if (!existing) {
          await this.prisma.clientProfile.create({
            data: {
              leadId: lead.id,
              companyName: lead.companyName,
              contactName: lead.contactName,
              contactEmail: lead.contactEmail,
              contactPhone: lead.contactPhone,
              advisorId: advisor.id,
              zone: lead.zone,
              city: lead.city,
              industry: lead.industry,
              systemStatus: this.randomPick(['INSTALLED', 'ACTIVE', 'PENDING']),
              lifecycleStage: this.randomPick(['NEW_CLIENT', 'ACTIVE_CLIENT']),
              systemSize: this.randomPick(systemSizes),
              totalRevenue: ticketValue,
              avgProjectValue: ticketValue,
              lifetimeValue: ticketValue,
              satisfactionScore: this.randomInt(7, 10),
              expansionScore: this.randomInt(30, 90),
              becameClientAt: convertedAt,
              installationDate: new Date(convertedAt.getTime() + this.randomInt(7, 30) * 24 * 60 * 60 * 1000),
            },
          });
        }

        created++;
      } catch (err) {
        this.logger.warn(`Failed to create won deal for lead ${lead.id}: ${err.message}`);
      }
    }

    this.logger.log(`Created ${created} won deals with client profiles`);
    return created;
  }

  // ── Step 4: Sales alerts ──────────────────────────────────────

  private async seedSalesAlerts(leads: any[], users: any[]): Promise<number> {
    const alertTypes = [
      'inactive_48h',
      'inactive_72h',
      'inactive_7d',
      'deal_stuck',
      'reactivation',
      'low_activity',
      'high_value_unattended',
    ];

    const severities = ['critical', 'high', 'medium', 'low'];
    const statuses = ['open', 'open', 'open', 'acknowledged', 'resolved', 'resolved', 'dismissed'];
    const actions = ['call', 'message', 'escalate', 'close', 'visit', 'reassign'];
    const actionsTaken = ['called', 'messaged', 'escalated', 'reassigned', 'visited', 'closed', null];

    const alertMessages: Record<string, string[]> = {
      inactive_48h: [
        'Lead sin actividad por más de 48 horas. El interés podría enfriarse.',
        'Han pasado 2 días sin contacto. Se recomienda llamada de seguimiento.',
      ],
      inactive_72h: [
        'Lead sin contacto por 72 horas. Riesgo medio de pérdida.',
        'No hay actividad registrada en 3 días. Contactar urgentemente.',
      ],
      inactive_7d: [
        'Lead inactivo por 7 días. Riesgo alto de perder la oportunidad.',
        'Una semana sin actividad. Se recomienda visita presencial o escalamiento.',
      ],
      deal_stuck: [
        'El deal lleva más de 15 días en la misma etapa sin avance.',
        'Oportunidad estancada. Revisar objeciones y proponer nueva estrategia.',
      ],
      reactivation: [
        'Lead inactivo muestra señales de reactivación. Contactar de inmediato.',
        'Oportunidad de reactivar lead que visitó el sitio web recientemente.',
      ],
      low_activity: [
        'Asesor con baja actividad esta semana. Solo 2 visitas registradas.',
        'Actividad del asesor por debajo del promedio. Revisar carga de trabajo.',
      ],
      high_value_unattended: [
        'Lead de alto valor ($300K+) sin atención en más de 5 días.',
        'Oportunidad de alto ticket sin seguimiento. Priorizar contacto.',
      ],
    };

    let created = 0;
    const alertCount = this.randomInt(40, 80);

    for (let i = 0; i < alertCount; i++) {
      const type = this.randomPick(alertTypes);
      const severity = this.randomPick(severities);
      const status = this.randomPick(statuses);
      const lead = this.randomPick(leads);
      const advisor = this.randomPick(users);
      const createdAt = this.randomDate(45);

      const resolvedAt = status === 'resolved' ? new Date(createdAt.getTime() + this.randomInt(1, 72) * 60 * 60 * 1000) : null;
      const acknowledgedAt = status === 'acknowledged' || status === 'resolved'
        ? new Date(createdAt.getTime() + this.randomInt(1, 24) * 60 * 60 * 1000)
        : null;

      try {
        await this.prisma.salesAlert.create({
          data: {
            type,
            severity,
            leadId: lead.id,
            advisorId: advisor.id,
            title: `${type.replace(/_/g, ' ').toUpperCase()} - ${lead.companyName}`,
            message: this.randomPick(alertMessages[type] || ['Alerta generada automáticamente.']),
            suggestion: status !== 'dismissed' ? `Se sugiere ${this.randomPick(actions)} al lead.` : null,
            priorityScore: this.randomInt(20, 100),
            daysSinceActivity: this.randomInt(1, 15),
            stageDuration: this.randomInt(1, 30),
            riskOfLoss: this.randomInt(10, 95),
            recommendedAction: this.randomPick(actions),
            estimatedValue: lead.estimatedValue || this.randomInt(50, 500) * 1000,
            zone: lead.zone,
            status,
            assignedToId: advisor.id,
            resolvedAt,
            resolvedBy: resolvedAt ? advisor.id : null,
            actionTaken: resolvedAt ? this.randomPick(actionsTaken.filter(Boolean)) : null,
            acknowledgedAt,
            createdAt,
          },
        });
        created++;
      } catch (err) {
        this.logger.warn(`Failed to create alert ${i}: ${err.message}`);
      }
    }

    this.logger.log(`Created ${created} sales alerts`);
    return created;
  }

  // ── Step 5: Follow-up sequences & steps ───────────────────────

  private async seedFollowUpSequences(leads: any[], users: any[]): Promise<number> {
    const triggers = ['new_lead', 'no_response', 'stalled_deal', 'cold_lead', 'reactivation'];
    const channels = ['whatsapp', 'email', 'sms'];
    const tones = ['consultative', 'formal', 'warm', 'urgent', 'direct'];
    const seqStatuses = ['active', 'active', 'completed', 'completed', 'paused', 'stopped'];
    const stepStatuses = ['sent', 'delivered', 'opened', 'replied', 'pending', 'sent'];

    const messageTemplates = [
      'Hola {{name}}, soy de IEA. Quería darle seguimiento sobre nuestra propuesta de {{product}} para {{company}}.',
      'Buenos días {{name}}. Le comparto información actualizada sobre los beneficios fiscales del sistema solar.',
      '{{name}}, ¿tuvo oportunidad de revisar la cotización? Estoy disponible para resolver cualquier duda.',
      'Estimado {{name}}, le informo que tenemos una promoción especial este mes para sistemas de {{systemSize}}.',
      'Hola {{name}}, ¿cómo está? Me gustaría agendar una visita para presentarle los resultados del análisis.',
      '{{name}}, le comparto un caso de éxito de {{industry}} similar al suyo. Los ahorros fueron del 40%.',
      'Buenos días {{name}}. Nuestro equipo técnico completó el análisis de su consumo. ¿Agendamos para revisarlo?',
      'Hola {{name}}, entiendo que están evaluando opciones. Me gustaría presentarle nuestro diferenciador clave.',
    ];

    let created = 0;
    const seqCount = this.randomInt(30, 60);

    for (let i = 0; i < seqCount; i++) {
      const lead = this.randomPick(leads);
      const advisor = this.randomPick(users);
      const trigger = this.randomPick(triggers);
      const status = this.randomPick(seqStatuses);
      const startedAt = this.randomDate(45);
      const maxSteps = this.randomInt(3, 6);
      const currentStep = status === 'completed' ? maxSteps : this.randomInt(0, maxSteps - 1);

      try {
        const sequence = await this.prisma.followUpSequence.create({
          data: {
            leadId: lead.id,
            advisorId: advisor.id,
            trigger,
            status,
            currentStep,
            maxSteps,
            leadName: lead.contactName,
            companyName: lead.companyName,
            zone: lead.zone,
            industry: lead.industry,
            estimatedValue: lead.estimatedValue || this.randomInt(50, 300) * 1000,
            leadStatus: lead.status,
            priorityScore: this.randomInt(30, 95),
            meetingBooked: Math.random() > 0.7,
            dealCreated: Math.random() > 0.8,
            dealClosed: status === 'completed' && Math.random() > 0.7,
            startedAt,
            completedAt: status === 'completed'
              ? new Date(startedAt.getTime() + this.randomInt(5, 30) * 24 * 60 * 60 * 1000)
              : null,
            lastActionAt: this.randomDate(15),
            nextActionAt: status === 'active'
              ? new Date(Date.now() + this.randomInt(1, 7) * 24 * 60 * 60 * 1000)
              : null,
          },
        });

        // Create steps for this sequence
        const stepsToCreate = Math.min(currentStep + 1, maxSteps);
        for (let s = 0; s < stepsToCreate; s++) {
          const stepStatus = s < currentStep ? this.randomPick(stepStatuses) : 'pending';
          const channel = this.randomPick(channels);
          const sentAt = s < currentStep
            ? new Date(startedAt.getTime() + s * this.randomInt(1, 5) * 24 * 60 * 60 * 1000)
            : null;

          await this.prisma.followUpStep.create({
            data: {
              sequenceId: sequence.id,
              stepNumber: s + 1,
              channel,
              tone: this.randomPick(tones),
              messageBody: this.randomPick(messageTemplates),
              delayDays: s * this.randomInt(1, 4),
              status: stepStatus,
              sentAt,
              deliveredAt: sentAt && stepStatus !== 'pending' ? new Date(sentAt.getTime() + 60000) : null,
              openedAt: stepStatus === 'opened' || stepStatus === 'replied' ? new Date((sentAt?.getTime() || Date.now()) + this.randomInt(1, 48) * 60 * 60 * 1000) : null,
              repliedAt: stepStatus === 'replied' ? new Date((sentAt?.getTime() || Date.now()) + this.randomInt(2, 72) * 60 * 60 * 1000) : null,
              wasOpened: stepStatus === 'opened' || stepStatus === 'replied',
              wasReplied: stepStatus === 'replied',
              ledToAdvance: stepStatus === 'replied' && Math.random() > 0.5,
            },
          });
        }

        created++;
      } catch (err) {
        this.logger.warn(`Failed to create sequence ${i}: ${err.message}`);
      }
    }

    this.logger.log(`Created ${created} follow-up sequences with steps`);
    return created;
  }

  // ── Step 6: Zone diversity ────────────────────────────────────

  private async seedZoneDiversity(leads: any[]): Promise<number> {
    const zoneData: Array<{
      zone: 'BAJIO' | 'CENTRO' | 'NORTE' | 'OTROS';
      cities: Array<{ name: string; state: string; lat: number; lng: number }>;
    }> = [
      {
        zone: 'BAJIO',
        cities: [
          { name: 'León', state: 'Guanajuato', lat: 21.1236, lng: -101.6821 },
          { name: 'Querétaro', state: 'Querétaro', lat: 20.5888, lng: -100.3899 },
          { name: 'Aguascalientes', state: 'Aguascalientes', lat: 21.8818, lng: -102.2916 },
        ],
      },
      {
        zone: 'CENTRO',
        cities: [
          { name: 'Ciudad de México', state: 'CDMX', lat: 19.4326, lng: -99.1332 },
          { name: 'Puebla', state: 'Puebla', lat: 19.0414, lng: -98.2063 },
        ],
      },
      {
        zone: 'NORTE',
        cities: [
          { name: 'Monterrey', state: 'Nuevo León', lat: 25.6866, lng: -100.3161 },
          { name: 'Saltillo', state: 'Coahuila', lat: 25.4232, lng: -100.9924 },
        ],
      },
      {
        zone: 'OTROS',
        cities: [
          { name: 'Mérida', state: 'Yucatán', lat: 20.9674, lng: -89.5926 },
        ],
      },
    ];

    // Pick ~30 leads to diversify zones (skip already-won leads)
    const eligible = leads.filter((l) => l.zone === 'OCCIDENTE');
    const shuffled = [...eligible].sort(() => Math.random() - 0.5).slice(0, Math.min(30, eligible.length));
    let updated = 0;

    for (const lead of shuffled) {
      const zoneEntry = this.randomPick(zoneData);
      const city = this.randomPick(zoneEntry.cities);
      const coords = this.gpsOffset(city.lat, city.lng, 8);

      try {
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: {
            zone: zoneEntry.zone,
            city: city.name,
            state: city.state,
            latitude: coords.lat,
            longitude: coords.lng,
          },
        });
        updated++;
      } catch (err) {
        this.logger.warn(`Failed to update zone for lead ${lead.id}: ${err.message}`);
      }
    }

    this.logger.log(`Updated ${updated} leads with zone diversity`);
    return updated;
  }

  // ── Step 7: Industry diversity ────────────────────────────────

  private async seedIndustryDiversity(leads: any[]): Promise<number> {
    const industries = [
      'Solar Residencial',
      'Solar Industrial',
      'Solar Comercial',
      'Iluminación LED',
      'Climatización',
      'Infraestructura Eléctrica',
    ];

    // Update leads that have null or empty industry
    const eligible = leads.filter((l) => !l.industry);
    let updated = 0;

    for (const lead of eligible) {
      try {
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: { industry: this.randomPick(industries) },
        });
        updated++;
      } catch (err) {
        this.logger.warn(`Failed to update industry for lead ${lead.id}: ${err.message}`);
      }
    }

    // Also update some that already have industry for variety
    const withIndustry = leads.filter((l) => l.industry);
    const toUpdate = [...withIndustry].sort(() => Math.random() - 0.5).slice(0, Math.floor(withIndustry.length * 0.3));
    for (const lead of toUpdate) {
      try {
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: { industry: this.randomPick(industries) },
        });
        updated++;
      } catch (err) {
        this.logger.warn(`Failed to update industry for lead ${lead.id}: ${err.message}`);
      }
    }

    this.logger.log(`Updated ${updated} leads with industry diversity`);
    return updated;
  }

  // ── Status check ──────────────────────────────────────────────

  async getDataStatus() {
    const [
      totalLeads,
      contactedLeads,
      wonLeads,
      totalVisits,
      totalAlerts,
      openAlerts,
      resolvedAlerts,
      totalSequences,
      activeSequences,
      completedSequences,
      totalSteps,
      clientProfiles,
      zoneCounts,
      industryCounts,
    ] = await Promise.all([
      this.prisma.lead.count({ where: { deletedAt: null } }),
      this.prisma.lead.count({ where: { deletedAt: null, lastContactedAt: { not: null } } }),
      this.prisma.lead.count({ where: { deletedAt: null, status: 'CERRADO_GANADO' } }),
      this.prisma.visit.count(),
      this.prisma.salesAlert.count(),
      this.prisma.salesAlert.count({ where: { status: 'open' } }),
      this.prisma.salesAlert.count({ where: { status: 'resolved' } }),
      this.prisma.followUpSequence.count(),
      this.prisma.followUpSequence.count({ where: { status: 'active' } }),
      this.prisma.followUpSequence.count({ where: { status: 'completed' } }),
      this.prisma.followUpStep.count(),
      this.prisma.clientProfile.count(),
      this.prisma.lead.groupBy({ by: ['zone'], _count: true, where: { deletedAt: null } }),
      this.prisma.lead.groupBy({ by: ['industry'], _count: true, where: { deletedAt: null, industry: { not: null } } }),
    ]);

    return {
      timestamp: new Date().toISOString(),
      leads: {
        total: totalLeads,
        contacted: contactedLeads,
        neverContacted: totalLeads - contactedLeads,
        won: wonLeads,
      },
      visits: { total: totalVisits },
      alerts: { total: totalAlerts, open: openAlerts, resolved: resolvedAlerts },
      sequences: { total: totalSequences, active: activeSequences, completed: completedSequences },
      steps: { total: totalSteps },
      clientProfiles: { total: clientProfiles },
      zones: zoneCounts.reduce((acc, z) => ({ ...acc, [z.zone]: z._count }), {}),
      industries: industryCounts
        .sort((a, b) => b._count - a._count)
        .map((i) => ({ industry: i.industry, count: i._count })),
    };
  }
}
