import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PriorityEngineService } from '../priority-engine/priority-engine.service';

// ═══════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════

export type CoachStage = 'new_lead' | 'follow_up' | 'negotiation' | 'reactivation' | 'post_sale';
export type Channel = 'whatsapp' | 'sms' | 'email' | 'call_script';
export type Tone = 'professional' | 'warm' | 'direct' | 'consultative' | 'high_urgency' | 'soft_urgency';

export interface CoachInput {
  leadId?: string;
  stage: CoachStage;
  tone?: Tone;
  channel?: Channel;
  // Lead context (optional, fetched from DB if leadId provided)
  companyName?: string;
  contactName?: string;
  contactPhone?: string;
  industry?: string;
  zone?: string;
  source?: string;
  estimatedValue?: number;
  status?: string;
  daysSinceContact?: number | null;
  lastObjection?: string;
  quoteSent?: boolean;
  financingInterest?: boolean;
  productInterest?: string;
}

export interface CoachOutput {
  stage: CoachStage;
  nextBestAction: NextBestAction;
  messages: ChannelMessages;
  objectionHandling?: ObjectionResponse[];
  closingArguments?: ClosingArgument[];
  toneUsed: Tone;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

export interface NextBestAction {
  action: string;
  reason: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  alternativeActions: string[];
}

export interface ChannelMessages {
  whatsapp: string;
  sms: string;
  email: { subject: string; body: string };
  callScript: string;
}

export interface ObjectionResponse {
  objection: string;
  bestResponse: string;
  softerResponse: string;
  strongerClose: string;
  nextAction: string;
}

export interface ClosingArgument {
  type: string;
  argument: string;
  followUp: string;
}

export interface CoachStats {
  totalUsages: number;
  byStage: Array<{ stage: string; count: number }>;
  byChannel: Array<{ channel: string; count: number }>;
  byAdvisor: Array<{ advisorId: string; name?: string; count: number }>;
  byAction: Array<{ action: string; count: number }>;
  topObjections: Array<{ objection: string; count: number }>;
}

// ═══════════════════════════════════════════════════════
// CONSTANTS — PRODUCT CATEGORIES
// ═══════════════════════════════════════════════════════

const PRODUCTS: Record<string, string> = {
  solar_commercial: 'paneles solares para empresas',
  solar_residential: 'energia solar residencial',
  financing: 'financiamiento solar',
  leasing: 'leasing de equipos solares',
  isolated: 'sistemas aislados',
  solar_pumping: 'bombeo solar',
  electrical: 'proyectos electricos',
  high_consumption: 'soluciones para alto consumo electrico',
};

const STATUS_LABELS: Record<string, string> = {
  PENDIENTE_CONTACTAR: 'Pendiente de Contactar',
  INTENTANDO_CONTACTAR: 'Intentando Contactar',
  EN_PROSPECCION: 'En Prospeccion',
  AGENDAR_CITA: 'Agendar Cita',
  ESPERANDO_COTIZACION: 'Esperando Cotizacion',
  COTIZACION_ENTREGADA: 'Cotizacion Entregada',
  ESPERANDO_CONTRATO: 'Esperando Contrato',
  PENDIENTE_PAGO: 'Pendiente de Pago',
  CERRADO_GANADO: 'Cerrado Ganado',
};

// ═══════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════

@Injectable()
export class SalesCoachService {
  private readonly logger = new Logger(SalesCoachService.name);

  constructor(
    private prisma: PrismaService,
    private priorityEngine: PriorityEngineService,
  ) {}

  // ─────────────────────────────────────────────────────
  // MAIN COACH ENGINE
  // ─────────────────────────────────────────────────────

  async generateCoaching(input: CoachInput): Promise<CoachOutput> {
    // If leadId provided, enrich with DB data
    let context = { ...input };
    if (input.leadId) {
      const lead = await this.prisma.lead.findUnique({
        where: { id: input.leadId },
        select: {
          companyName: true, contactName: true, contactPhone: true,
          zone: true, status: true, source: true, estimatedValue: true,
          industry: true, lastContactedAt: true, createdAt: true,
          visits: { orderBy: { visitDate: 'desc' as const }, take: 1, select: { outcome: true, notes: true, followUpNotes: true } },
        },
      });
      if (lead) {
        context = {
          ...context,
          companyName: lead.companyName,
          contactName: lead.contactName,
          contactPhone: lead.contactPhone || undefined,
          zone: lead.zone,
          status: lead.status,
          source: lead.source,
          estimatedValue: lead.estimatedValue || undefined,
          industry: lead.industry || undefined,
          daysSinceContact: this.priorityEngine.daysSince(lead.lastContactedAt),
        };
      }
    }

    const tone = context.tone || 'professional';
    const name = context.contactName?.split(' ')[0] || 'estimado cliente';
    const company = context.companyName || 'su empresa';
    const product = context.productInterest ? (PRODUCTS[context.productInterest] || context.productInterest) : 'energia solar';

    // Generate stage-specific output
    switch (context.stage) {
      case 'new_lead':
        return this.coachNewLead(context, tone, name, company, product);
      case 'follow_up':
        return this.coachFollowUp(context, tone, name, company, product);
      case 'negotiation':
        return this.coachNegotiation(context, tone, name, company, product);
      case 'reactivation':
        return this.coachReactivation(context, tone, name, company, product);
      case 'post_sale':
        return this.coachPostSale(context, tone, name, company, product);
      default:
        return this.coachNewLead(context, tone, name, company, product);
    }
  }

  // ─────────────────────────────────────────────────────
  // 1. NEW LEAD COACHING
  // ─────────────────────────────────────────────────────

  private coachNewLead(ctx: CoachInput, tone: Tone, name: string, company: string, product: string): CoachOutput {
    const isHighValue = (ctx.estimatedValue || 0) >= 200000;
    const sourceLabel = ctx.source === 'REFERRAL' ? 'referido' : ctx.source === 'WEBSITE' ? 'sitio web' : ctx.source === 'TRADE_SHOW' ? 'expo' : 'prospecto';

    const nextBestAction = this.nbaNewLead(ctx, sourceLabel);
    const messages = this.messagesNewLead(tone, name, company, product, sourceLabel, isHighValue, ctx.zone);

    return {
      stage: 'new_lead',
      nextBestAction,
      messages,
      toneUsed: tone,
      confidence: isHighValue ? 'high' : 'medium',
      reasoning: `Lead nuevo${isHighValue ? ' de alto valor' : ''} via ${sourceLabel}. Prioridad: establecer contacto rapido y calificar interes. ${ctx.source === 'REFERRAL' ? 'Los referidos tienen 40% mas conversion — contactar hoy.' : 'Contactar dentro de 24h para maximizar interes.'}`,
    };
  }

  private nbaNewLead(ctx: CoachInput, sourceLabel: string): NextBestAction {
    if (ctx.source === 'REFERRAL') {
      return {
        action: 'Llamar inmediatamente',
        reason: `Lead referido — los referidos convierten 40% mas. Llamar hoy para capitalizar la recomendacion.`,
        priority: 'high',
        alternativeActions: ['Enviar WhatsApp de presentacion', 'Enviar email personalizado', 'Agendar llamada para manana temprano'],
      };
    }
    if ((ctx.estimatedValue || 0) >= 300000) {
      return {
        action: 'Llamar hoy',
        reason: `Lead de alto valor ($${(ctx.estimatedValue || 0).toLocaleString('es-MX')}). Requiere atencion prioritaria.`,
        priority: 'critical',
        alternativeActions: ['Enviar WhatsApp personalizado', 'Agendar visita tecnica', 'Escaldar a asesor senior'],
      };
    }
    return {
      action: 'Enviar WhatsApp de presentacion',
      reason: `Primer contacto con ${sourceLabel}. WhatsApp tiene 80% de tasa de apertura — ideal para primer acercamiento.`,
      priority: 'medium',
      alternativeActions: ['Llamar directamente', 'Enviar email informativo', 'Esperar 24h y llamar'],
    };
  }

  private messagesNewLead(tone: Tone, name: string, company: string, product: string, source: string, highValue: boolean, zone?: string): ChannelMessages {
    const toneMap = this.getToneAdjustments(tone);

    return {
      whatsapp: `${toneMap.greeting} ${name}! Soy [Tu Nombre] de Ingenieria Electrica Alanis.${source === 'referido' ? ' Me recomendaron contactarte.' : ''} Nos especializamos en ${product} y me gustaria platicar sobre como podemos ayudar a ${company} a reducir sus costos de energia. ${toneMap.cta} ${toneMap.closing}`,

      sms: `Hola ${name}, soy [Tu Nombre] de IEA. ${source === 'referido' ? 'Me recomendaron contactarte. ' : ''}Tenemos soluciones de ${product} para ${company}. Te puedo llamar? Responde SI para agendar.`,

      email: {
        subject: `${source === 'referido' ? 'Recomendacion: ' : ''}Soluciones de ${product} para ${company}`,
        body: `${toneMap.greeting} ${name},\n\nMi nombre es [Tu Nombre] y represento a Ingenieria Electrica Alanis (IEA), lider en soluciones de ${product} en la region.\n\n${source === 'referido' ? 'Me recomendaron contactarte porque ' : 'Me pongo en contacto porque '}creo que podemos ayudar a ${company} a:\n\n• Reducir hasta un 40% en costos de energia electrica\n• Generar ahorros desde el primer mes\n• Acceder a opciones de financiamiento flexibles\n\n${highValue ? 'Dada la escala de su operacion, tenemos soluciones especializadas que podrian generar ahorros significativos.\n\n' : ''}Me gustaria agendar una llamada de 15 minutos para entender mejor sus necesidades y presentarle opciones personalizadas.\n\n${toneMap.cta}\n\n${toneMap.closing}\n[Tu Nombre]\nIngenieria Electrica Alanis\n[Tu Telefono]`,
      },

      callScript: `APERTURA:\n"${toneMap.greeting} ${name}, soy [Tu Nombre] de Ingenieria Electrica Alanis. ${source === 'referido' ? '[Nombre del referente] me sugirio contactarte. ' : ''}¿Tiene un minuto?"\n\nCALIFICACION:\n1. "¿Actualmente ${company} tiene sistema de energia solar o esta evaluando opciones?"\n2. "¿Cual es su consumo mensual aproximado de electricidad?"\n3. "¿Han considerado financiamiento para proyectos de energia?"\n4. "¿Quien mas participa en la decision de este tipo de proyectos?"\n\nVALOR:\n"En IEA ayudamos a empresas como ${company} a reducir hasta 40% sus costos de energia. Tenemos mas de [X] instalaciones exitosas en la zona ${zone || ''}."\n\nCIERRE:\n"Me gustaria agendar una visita tecnica sin compromiso para hacer un analisis personalizado. ¿Le funcionaria esta semana?"`,
    };
  }

  // ─────────────────────────────────────────────────────
  // 2. FOLLOW-UP COACHING
  // ─────────────────────────────────────────────────────

  private coachFollowUp(ctx: CoachInput, tone: Tone, name: string, company: string, product: string): CoachOutput {
    const days = ctx.daysSinceContact ?? 0;
    const quoteSent = ctx.quoteSent || ['COTIZACION_ENTREGADA', 'ESPERANDO_COTIZACION'].includes(ctx.status || '');
    const nextBestAction = this.nbaFollowUp(ctx, days, quoteSent);
    const messages = this.messagesFollowUp(tone, name, company, product, days, quoteSent);

    return {
      stage: 'follow_up',
      nextBestAction,
      messages,
      toneUsed: tone,
      confidence: days <= 3 ? 'high' : days <= 7 ? 'medium' : 'low',
      reasoning: `${days} dias sin contacto.${quoteSent ? ' Cotizacion enviada — el lead necesita un empujon.' : ''} ${days > 7 ? 'URGENTE: La probabilidad de cierre baja significativamente despues de 7 dias.' : days > 3 ? 'Seguimiento oportuno — el interes aun esta vigente.' : 'Buen momento para dar seguimiento.'}`,
    };
  }

  private nbaFollowUp(ctx: CoachInput, days: number, quoteSent: boolean): NextBestAction {
    if (quoteSent && days >= 3) {
      return {
        action: 'Llamar para revisar cotizacion',
        reason: `Cotizacion enviada hace ${days}+ dias sin respuesta. Llamar para resolver dudas y avanzar.`,
        priority: days >= 5 ? 'critical' : 'high',
        alternativeActions: ['Reenviar cotizacion con nota personal', 'Ofrecer opcion de financiamiento', 'Proponer reunion presencial'],
      };
    }
    if (days >= 7) {
      return {
        action: 'Enviar mensaje de valor + llamar',
        reason: `${days} dias sin contacto. Combinar mensaje de valor con llamada para reactivar.`,
        priority: 'high',
        alternativeActions: ['Enviar caso de exito relevante', 'Ofrecer descuento por tiempo limitado', 'Escalar a asesor senior'],
      };
    }
    if (days >= 3) {
      return {
        action: 'Enviar WhatsApp de seguimiento',
        reason: `3+ dias sin respuesta. WhatsApp para mantener el contacto activo.`,
        priority: 'medium',
        alternativeActions: ['Llamar directamente', 'Enviar email con informacion adicional', 'Esperar 24h mas'],
      };
    }
    return {
      action: 'Esperar 24h y enviar WhatsApp',
      reason: `Contacto reciente (${days}d). Dar espacio pero mantener presencia.`,
      priority: 'low',
      alternativeActions: ['Enviar informacion complementaria', 'Preparar cotizacion', 'Agendar seguimiento automatico'],
    };
  }

  private messagesFollowUp(tone: Tone, name: string, company: string, product: string, days: number, quoteSent: boolean): ChannelMessages {
    const toneMap = this.getToneAdjustments(tone);

    const whatsapp = quoteSent
      ? `${toneMap.greeting} ${name}! Queria dar seguimiento a la cotizacion que le enviamos para ${company}. ¿Tuvo oportunidad de revisarla? Si tiene alguna duda o necesita ajustes, con gusto le ayudo. ${toneMap.closing}`
      : days > 7
        ? `${toneMap.greeting} ${name}, ha pasado un tiempo desde nuestro ultimo contacto. Queria compartirle que hemos tenido resultados excelentes con empresas similares a ${company} en ${product}. ¿Le gustaria que agendemos una platica rapida? ${toneMap.closing}`
        : `${toneMap.greeting} ${name}! Solo queria dar seguimiento a nuestra platica sobre ${product} para ${company}. ¿Hay algo mas que pueda hacer para avanzar? ${toneMap.closing}`;

    return {
      whatsapp,
      sms: quoteSent
        ? `Hola ${name}, ¿revisaste la cotizacion de IEA? Puedo resolver dudas por aqui o agendar llamada. Responde para coordinar.`
        : `Hola ${name}, seguimiento de IEA sobre ${product}. ¿Puedo llamarte para platicar? Responde SI.`,
      email: {
        subject: quoteSent ? `Seguimiento: Cotizacion ${product} para ${company}` : `Seguimiento: ${product} para ${company}`,
        body: quoteSent
          ? `${toneMap.greeting} ${name},\n\nEspero que se encuentre bien. Le escribo para dar seguimiento a la cotizacion que le enviamos para el proyecto de ${product} en ${company}.\n\nEntiendo que este tipo de decisiones requieren tiempo y analisis. Por eso quiero asegurarme de que tenga toda la informacion necesaria.\n\n¿Hay algun punto de la propuesta que le gustaria que revisaramos juntos? Puedo agendar una llamada rapida de 10 minutos para resolver cualquier duda.\n\nQuedo atento a sus comentarios.\n\n${toneMap.closing}\n[Tu Nombre]\nIngenieria Electrica Alanis`
          : `${toneMap.greeting} ${name},\n\nMe pongo en contacto para dar seguimiento a nuestra conversacion sobre soluciones de ${product} para ${company}.\n\n${days > 7 ? 'Se que ha pasado un tiempo, pero queria compartirle que recientemente completamos un proyecto similar con excelentes resultados — hasta 45% de ahorro en costos de energia.\n\n' : ''}Me gustaria saber si aun tiene interes y como puedo ayudarle a avanzar.\n\n${toneMap.cta}\n\n${toneMap.closing}\n[Tu Nombre]\nIngenieria Electrica Alanis`,
      },
      callScript: `APERTURA:\n"${toneMap.greeting} ${name}, soy [Tu Nombre] de IEA. ${quoteSent ? 'Le llamo para dar seguimiento a la cotizacion que le enviamos.' : 'Le llamo para continuar con nuestra conversacion sobre ' + product + '.'} ¿Tiene unos minutos?"\n\n${quoteSent ? 'REVISAR COTIZACION:\n"¿Tuvo oportunidad de revisar la propuesta? ¿Hay algun punto que le gustaria ajustar?"\n"¿El presupuesto esta dentro de lo que tenian contemplado?"\n"¿Necesita opciones de financiamiento?"' : 'CALIFICAR AVANCE:\n"¿Ha tenido tiempo de evaluar las opciones de ' + product + '?"\n"¿Hay algo especifico que le gustaria saber sobre nuestras soluciones?"\n"¿Quien mas esta involucrado en la decision?"'}\n\nAVANCE:\n"¿Cual seria el siguiente paso ideal para usted? Puedo ${quoteSent ? 'ajustar la cotizacion, presentar opciones de financiamiento, o agendar una visita tecnica' : 'preparar una cotizacion personalizada o agendar una visita tecnica sin compromiso'}."`,
    };
  }

  // ─────────────────────────────────────────────────────
  // 3. NEGOTIATION COACHING
  // ─────────────────────────────────────────────────────

  private coachNegotiation(ctx: CoachInput, tone: Tone, name: string, company: string, product: string): CoachOutput {
    const nextBestAction = this.nbaNegotiation(ctx);
    const messages = this.messagesNegotiation(tone, name, company, product, ctx);
    const objectionHandling = this.generateObjectionResponses(name, company, product, tone);
    const closingArguments = this.generateClosingArguments(name, company, product, ctx);

    return {
      stage: 'negotiation',
      nextBestAction,
      messages,
      objectionHandling,
      closingArguments,
      toneUsed: tone,
      confidence: (ctx.estimatedValue || 0) >= 200000 ? 'high' : 'medium',
      reasoning: `Lead en negociacion final${ctx.status ? ` (${STATUS_LABELS[ctx.status] || ctx.status})` : ''}. ${ctx.lastObjection ? `Ultima objecion: "${ctx.lastObjection}". ` : ''}Priorizar cierre con mensajes de valor y urgencia controlada.`,
    };
  }

  private nbaNegotiation(ctx: CoachInput): NextBestAction {
    if (ctx.status === 'PENDIENTE_PAGO') {
      return {
        action: 'Llamar para facilitar el pago',
        reason: 'Deal en Pendiente de Pago. Solo falta el paso final — resolver cualquier barrera de pago.',
        priority: 'critical',
        alternativeActions: ['Enviar opciones de pago', 'Ofrecer plan de financiamiento', 'Enviar link de pago directo'],
      };
    }
    if (ctx.status === 'ESPERANDO_CONTRATO') {
      return {
        action: 'Enviar contrato y agendar firma',
        reason: 'El cliente esta listo. Enviar contrato y proponer fecha de firma.',
        priority: 'critical',
        alternativeActions: ['Llamar para resolver ultimas dudas', 'Ofrecer visita para firmar presencialmente', 'Enviar resumen ejecutivo'],
      };
    }
    if (ctx.lastObjection) {
      return {
        action: 'Responder objecion y proponer siguiente paso',
        reason: `Objecion detectada: "${ctx.lastObjection}". Resolver y mover hacia cierre.`,
        priority: 'high',
        alternativeActions: ['Enviar caso de exito similar', 'Agendar reunion con equipo tecnico', 'Ofrecer demo o visita a instalacion existente'],
      };
    }
    return {
      action: 'Llamar para cerrar',
      reason: 'Negociacion avanzada. Es momento de hacer la pregunta de cierre.',
      priority: 'high',
      alternativeActions: ['Enviar propuesta final con urgencia', 'Ofrecer condicion especial por tiempo limitado', 'Agendar reunion presencial de cierre'],
    };
  }

  private messagesNegotiation(tone: Tone, name: string, company: string, product: string, ctx: CoachInput): ChannelMessages {
    const toneMap = this.getToneAdjustments(tone);
    const value = ctx.estimatedValue ? `$${ctx.estimatedValue.toLocaleString('es-MX')}` : '';

    return {
      whatsapp: `${toneMap.greeting} ${name}! Estamos muy cerca de arrancar el proyecto de ${product} para ${company}. ${ctx.financingInterest ? 'Tengo lista la opcion de financiamiento que platicamos. ' : ''}¿Podemos agendar una llamada para cerrar los ultimos detalles? Quiero asegurarme de que todo quede perfecto para ustedes. ${toneMap.closing}`,

      sms: `${name}, todo listo para avanzar con el proyecto de ${product} para ${company}. ¿Cuando podemos cerrar? Llama o responde para coordinar. - IEA`,

      email: {
        subject: `Siguiente paso: Proyecto ${product} — ${company}`,
        body: `${toneMap.greeting} ${name},\n\nGracias por la confianza que ${company} ha depositado en IEA. Estamos entusiasmados con el proyecto de ${product}.\n\n${ctx.status === 'ESPERANDO_CONTRATO' ? 'Adjunto encontrara el contrato para su revision. Quedo atento a cualquier ajuste que necesite.\n\n' : ctx.status === 'PENDIENTE_PAGO' ? 'Para arrancar el proyecto, solo necesitamos completar el proceso de pago. Le comparto las opciones disponibles:\n\n• Transferencia bancaria\n• Pago con tarjeta\n• Financiamiento a 12/24/36 meses\n\n' : 'Hemos revisado todos los detalles tecnicos y estoy seguro de que esta es la mejor solucion para ${company}.\n\n'}Beneficios clave del proyecto:\n• Ahorro estimado del 35-45% en costos de energia\n• Retorno de inversion en 3-4 anos\n• ${ctx.financingInterest ? 'Financiamiento flexible sin enganche inicial\n• ' : ''}Garantia de rendimiento por 25 anos\n\n¿Le parece bien agendar una llamada para cerrar los detalles finales?\n\n${toneMap.closing}\n[Tu Nombre]\nIngenieria Electrica Alanis`,
      },

      callScript: `APERTURA:\n"${toneMap.greeting} ${name}, soy [Tu Nombre] de IEA. Le llamo porque estamos listos para avanzar con el proyecto de ${product} para ${company}. ¿Tiene 5 minutos?"\n\nVALOR:\n"Solo quiero confirmar los beneficios clave: ahorro del 35-45% en energia, retorno en 3-4 anos, y garantia de 25 anos. ${value ? `Con una inversion de ${value}, estamos hablando de ahorros de mas de $X al ano.` : ''}"\n\nMANEJO DE OBJECIONES:\n(Si dice "necesito pensarlo") → "Entiendo perfectamente. ¿Hay algun punto especifico que le gustaria que revisaramos juntos?"\n(Si dice "es caro") → "Entiendo la preocupacion. ¿Ha considerado que el ahorro mensual cubre la inversion? Ademas tenemos financiamiento sin enganche."\n\nCIERRE:\n"¿Le parece bien si procedemos con ${ctx.status === 'ESPERANDO_CONTRATO' ? 'la firma del contrato' : ctx.status === 'PENDIENTE_PAGO' ? 'el proceso de pago' : 'los siguientes pasos'}? Podemos arrancar la instalacion en [plazo]."`,
    };
  }

  // ─────────────────────────────────────────────────────
  // 4. REACTIVATION COACHING
  // ─────────────────────────────────────────────────────

  private coachReactivation(ctx: CoachInput, tone: Tone, name: string, company: string, product: string): CoachOutput {
    const days = ctx.daysSinceContact ?? 30;
    const worthReactivating = (ctx.estimatedValue || 0) >= 100000 || days < 60;
    const messages = this.messagesReactivation(tone, name, company, product, days, ctx);

    return {
      stage: 'reactivation',
      nextBestAction: {
        action: worthReactivating ? 'Reactivar con mensaje personalizado' : 'Marcar para revision futura',
        reason: worthReactivating
          ? `Lead inactivo ${days} dias${ctx.estimatedValue ? ` con valor $${ctx.estimatedValue.toLocaleString('es-MX')}` : ''}. Vale la pena reactivar.`
          : `Lead inactivo ${days}+ dias con bajo valor potencial. Revisar en ciclo futuro.`,
        priority: worthReactivating ? (days > 30 ? 'medium' : 'high') : 'low',
        alternativeActions: worthReactivating
          ? ['Enviar caso de exito por WhatsApp', 'Llamar con oferta especial', 'Enviar email con novedades', 'Invitar a evento/webinar']
          : ['Mover a contactar futuro', 'Agregar a campaña de email', 'Revisar en 30 dias'],
      },
      messages,
      toneUsed: tone,
      confidence: worthReactivating ? 'medium' : 'low',
      reasoning: `Lead inactivo por ${days} dias.${ctx.lastObjection ? ` Ultima objecion: "${ctx.lastObjection}".` : ''} ${worthReactivating ? 'Reactivar con enfoque de valor y novedades.' : 'Bajo potencial inmediato — priorizar otros leads.'} ${ctx.financingInterest ? 'Mostro interes en financiamiento — usar como gancho.' : ''}`,
    };
  }

  private messagesReactivation(tone: Tone, name: string, company: string, product: string, days: number, ctx: CoachInput): ChannelMessages {
    const toneMap = this.getToneAdjustments(tone);
    const hook = ctx.financingInterest
      ? 'Tenemos nuevas opciones de financiamiento que podrian interesarte'
      : ctx.lastObjection === 'expensive'
        ? 'Tenemos nuevas opciones mas accesibles'
        : 'Tenemos novedades que podrian interesarte';

    return {
      whatsapp: `${toneMap.greeting} ${name}! Ha pasado un tiempo desde que platicamos sobre ${product} para ${company}. ${hook}. ¿Te gustaria que agendemos una llamada rapida? Sin compromiso. ${toneMap.closing}`,

      sms: `Hola ${name}, novedades de IEA en ${product}. ${hook}. ¿Te llamo esta semana? Responde SI. - IEA`,

      email: {
        subject: `Novedades en ${product} que podrian interesarle — IEA`,
        body: `${toneMap.greeting} ${name},\n\nEspero que este bien. Ha pasado un tiempo desde nuestra ultima conversacion sobre soluciones de ${product} para ${company}, y queria ponerme al dia con usted.\n\nDesde entonces, en Ingenieria Electrica Alanis hemos:\n\n• Completado mas de [X] proyectos exitosos en la region\n• Incorporado nueva tecnologia que mejora la eficiencia un 15%\n${ctx.financingInterest ? '• Lanzado opciones de financiamiento mas flexibles (desde $0 enganche)\n' : ''}• Obtenido nuevos casos de exito con empresas similares a ${company}\n\nEntiendo que en su momento el timing no fue el ideal. ¿Le gustaria retomar la conversacion? Puedo preparar una propuesta actualizada sin compromiso.\n\n${toneMap.closing}\n[Tu Nombre]\nIngenieria Electrica Alanis`,
      },

      callScript: `APERTURA:\n"${toneMap.greeting} ${name}, soy [Tu Nombre] de Ingenieria Electrica Alanis. ¿Se acuerda de mi? Platicamos hace un tiempo sobre ${product} para ${company}. ¿Tiene un momento?"\n\nRECONEXION:\n"Entiendo que en su momento no era el timing ideal. Queria actualizarle sobre algunas novedades que tenemos — ${hook.toLowerCase()}."\n\nVALOR ACTUALIZADO:\n"Hemos completado varios proyectos similares recientemente con ahorros del 40%+. La tecnologia ha mejorado mucho y los precios son mas competitivos."\n\n${ctx.financingInterest ? 'FINANCIAMIENTO:\n"Ahora tenemos opciones de financiamiento desde $0 enganche con pagos mensuales menores a lo que estan pagando de luz."' : ''}\n\nCIERRE:\n"¿Le gustaria que le prepare una cotizacion actualizada? Sin compromiso, solo para que vea las nuevas opciones."`,
    };
  }

  // ─────────────────────────────────────────────────────
  // 5. POST-SALE COACHING
  // ─────────────────────────────────────────────────────

  private coachPostSale(ctx: CoachInput, tone: Tone, name: string, company: string, product: string): CoachOutput {
    const messages = this.messagesPostSale(tone, name, company, product, ctx);

    return {
      stage: 'post_sale',
      nextBestAction: {
        action: 'Enviar mensaje de agradecimiento y agendar check-in',
        reason: 'Cliente ganado — fortalecer relacion, pedir referidos, y detectar oportunidades de upsell.',
        priority: 'medium',
        alternativeActions: ['Pedir resena/testimonio', 'Ofrecer servicio adicional', 'Solicitar referidos', 'Programar visita de seguimiento'],
      },
      messages,
      toneUsed: tone,
      confidence: 'high',
      reasoning: 'Post-venta: momento ideal para fortalecer la relacion, pedir referidos y testimonios, y detectar oportunidades de cross-sell (mantenimiento, ampliacion, etc).',
    };
  }

  private messagesPostSale(tone: Tone, name: string, company: string, product: string, ctx: CoachInput): ChannelMessages {
    const toneMap = this.getToneAdjustments(tone);

    return {
      whatsapp: `${toneMap.greeting} ${name}! Queria agradecerle personalmente por confiar en IEA para el proyecto de ${product} en ${company}. Estamos comprometidos con que todo salga excelente. ¿Como va todo hasta ahora? Si necesita algo, estoy a una llamada de distancia. ${toneMap.closing}`,

      sms: `${name}, gracias por elegir IEA! ¿Como va el proyecto de ${product}? Cualquier cosa que necesite, estamos para servirle. - IEA`,

      email: {
        subject: `Gracias por confiar en IEA — ${company}`,
        body: `${toneMap.greeting} ${name},\n\nQuiero agradecerle personalmente por la confianza que ${company} ha depositado en Ingenieria Electrica Alanis.\n\nEstamos comprometidos con que su proyecto de ${product} sea un exito total. Aqui tiene mis datos de contacto directo para cualquier consulta:\n\n📱 [Tu Telefono]\n📧 [Tu Email]\n\nMe gustaria agendar una llamada de seguimiento en [2-4 semanas] para asegurarme de que todo funcione a la perfeccion.\n\nAdemás, si conoce a alguien que pueda beneficiarse de soluciones similares, nos encantaria poder ayudarles tambien. Las recomendaciones de clientes satisfechos como usted son nuestra mejor carta de presentacion.\n\nGracias nuevamente y quedo a sus ordenes.\n\n${toneMap.closing}\n[Tu Nombre]\nIngenieria Electrica Alanis`,
      },

      callScript: `APERTURA:\n"${toneMap.greeting} ${name}, soy [Tu Nombre] de IEA. Le llamo para darle seguimiento al proyecto de ${product}. ¿Cómo va todo? ¿Esta satisfecho?"\n\nCHECK-IN:\n"¿Ha notado ya el ahorro en su recibo de luz?"\n"¿Hay algo que podamos mejorar o ajustar?"\n"¿El equipo de instalacion le dejo buena impresion?"\n\nREFERIDOS:\n"Me alegra mucho saber que esta contento. Si conoce a alguien — un colega, vecino, o contacto — que pueda beneficiarse de energia solar, nos encantaria poder ayudarles. Las recomendaciones como la suya son lo que mas valoramos."\n\nTESTIMONIO:\n"¿Le importaria compartir una breve resena de su experiencia? Nos ayuda mucho y toma menos de 2 minutos."\n\nUPSELL:\n"Por cierto, para clientes como ${company} tambien ofrecemos [mantenimiento preventivo / ampliacion de sistema / baterias de respaldo]. ¿Le interesaria conocer mas?"`,
    };
  }

  // ─────────────────────────────────────────────────────
  // OBJECTION HANDLING ENGINE
  // ─────────────────────────────────────────────────────

  generateObjectionResponses(name: string, company: string, product: string, tone: Tone): ObjectionResponse[] {
    return [
      {
        objection: 'Necesito pensarlo',
        bestResponse: `Entiendo perfectamente, ${name}. Es una decision importante. ¿Puedo preguntarle que aspecto especifico le gustaria analizar mas? Asi puedo enviarle informacion enfocada.`,
        softerResponse: `Claro, ${name}, tomese el tiempo que necesite. Le parece si le envio un resumen con los puntos clave para que lo revise con calma?`,
        strongerClose: `${name}, muchos de nuestros clientes me dijeron lo mismo antes de ver el ahorro real en su primer recibo. ¿Que le parece si avanzamos con un estudio sin compromiso? Asi tiene datos reales para tomar su decision.`,
        nextAction: 'Agendar llamada en 3 dias para seguimiento',
      },
      {
        objection: 'Es muy caro',
        bestResponse: `Entiendo la preocupacion por la inversion, ${name}. Sin embargo, si consideramos el ahorro mensual de hasta 40% en energia, el sistema se paga solo en 3-4 anos. Ademas, tenemos financiamiento desde $0 enganche con pagos menores a su recibo actual.`,
        softerResponse: `Comprendo, ${name}. ¿Le gustaria que revisemos opciones de financiamiento? Muchos clientes terminan pagando menos que su recibo de luz actual.`,
        strongerClose: `${name}, pienselo asi: cada mes que pasa sin energia solar, ${company} esta pagando de mas. Con nuestro plan de financiamiento, el ahorro empieza desde el dia uno. ¿Le gustaria ver los numeros?`,
        nextAction: 'Enviar comparativo de ahorro con y sin financiamiento',
      },
      {
        objection: 'Estoy viendo otras opciones',
        bestResponse: `Me parece muy bien que compare, ${name}. La transparencia es importante para nosotros. ¿Puedo saber que aspectos esta evaluando? Asi me aseguro de que nuestra propuesta cubra todo lo que necesita.`,
        softerResponse: `Perfecto, ${name}. Comparar es lo mas sabio. Si me comparte que le han ofrecido, puedo asegurarme de que nuestra propuesta sea la mas completa.`,
        strongerClose: `${name}, lo que nos diferencia de la competencia es nuestra garantia de rendimiento, soporte local, y mas de [X] instalaciones exitosas en la zona. ¿Le gustaria visitar una de nuestras instalaciones para verlo en persona?`,
        nextAction: 'Enviar diferenciadores y caso de exito',
      },
      {
        objection: 'Necesito hablar con mi socio/esposa',
        bestResponse: `Claro, ${name}. ¿Le gustaria que agendemos una presentacion donde pueda estar presente su [socio/pareja]? Asi resolvemos todas las dudas juntos.`,
        softerResponse: `Entiendo, ${name}. ¿Puedo enviarle un resumen ejecutivo que pueda compartir? Asi la conversacion sera mas productiva.`,
        strongerClose: `${name}, ¿que le parece si hacemos una llamada rapida de 15 minutos los tres juntos? Asi puedo resolver todas las preguntas en el momento.`,
        nextAction: 'Proponer reunion conjunta con tomador de decision',
      },
      {
        objection: 'No tengo dinero ahorita',
        bestResponse: `Entiendo, ${name}. Precisamente por eso tenemos opciones de financiamiento sin enganche, con pagos mensuales menores a lo que esta pagando de luz. Es decir, empezaria a ahorrar desde el primer mes.`,
        softerResponse: `Sin problema, ${name}. ¿Le interesaria conocer nuestras opciones de financiamiento? Muchos clientes se sorprenden de lo accesible que resulta.`,
        strongerClose: `${name}, ¿y si le digo que puede empezar a ahorrar sin poner un peso inicial? Con nuestro plan de leasing, su pago mensual es menor que su recibo actual. Literalmente le cuesta mas NO tener solar.`,
        nextAction: 'Enviar opciones de financiamiento detalladas',
      },
      {
        objection: 'Mandame mas informacion',
        bestResponse: `Con gusto, ${name}. Para enviarle la informacion mas relevante, ¿me podria decir su consumo mensual aproximado y el tamano de su propiedad? Asi personalizo la propuesta.`,
        softerResponse: `Claro, ${name}! Le envio un resumen general. ¿Por donde le es mas comodo recibirlo?`,
        strongerClose: `${name}, mas que enviarle un PDF generico, me gustaria prepararle una propuesta personalizada para ${company}. ¿Me da 5 minutos para hacerle unas preguntas clave?`,
        nextAction: 'Enviar info pero agendar llamada de seguimiento',
      },
      {
        objection: 'Despues / Mas adelante',
        bestResponse: `Entiendo, ${name}. ¿Me podria decir para cuando estarian evaluando este tipo de proyectos? Asi puedo darle seguimiento en el momento adecuado y tener una propuesta lista.`,
        softerResponse: `Sin problema, ${name}. Lo anoto para contactarle mas adelante. ¿En cuantas semanas le parece bien?`,
        strongerClose: `${name}, le comento que tenemos una promocion vigente hasta [fecha] que incluye [beneficio]. ¿Le gustaria asegurar estas condiciones ahora y programar la instalacion para cuando le convenga?`,
        nextAction: 'Agendar seguimiento y enviar recordatorio con oferta',
      },
      {
        objection: 'Me interesa pero ahorita no',
        bestResponse: `Perfecto, ${name}. ¿Hay algo especifico que necesite resolver antes de avanzar? A veces podemos ayudar con el timing — por ejemplo, programar todo para la fecha que le convenga.`,
        softerResponse: `Entendido, ${name}. Quedo pendiente. ¿Le parece si le contacto en [1-2 semanas]?`,
        strongerClose: `${name}, muchos clientes me dicen lo mismo y despues se arrepienten de haber esperado — cada mes sin solar es dinero que se va. ¿Que le parece si aseguramos las condiciones actuales y programamos para cuando usted diga?`,
        nextAction: 'Calendarizar seguimiento en 1-2 semanas',
      },
    ];
  }

  // ─────────────────────────────────────────────────────
  // CLOSING ARGUMENTS ENGINE
  // ─────────────────────────────────────────────────────

  private generateClosingArguments(name: string, company: string, product: string, ctx: CoachInput): ClosingArgument[] {
    return [
      {
        type: 'Ahorro',
        argument: `${name}, con este proyecto ${company} ahorraria hasta 40% en energia — eso son miles de pesos al mes que se quedan en su bolsillo.`,
        followUp: 'Puedo mostrarle el calculo exacto de ahorro con sus datos de consumo.',
      },
      {
        type: 'ROI',
        argument: `La inversion se recupera en 3-4 anos, y el sistema dura 25+. Son mas de 20 anos de energia practicamente gratis.`,
        followUp: 'Le preparo una proyeccion a 10 anos para que vea el impacto acumulado.',
      },
      {
        type: 'Urgencia',
        argument: `Cada mes que pasa sin energia solar, ${company} esta pagando de mas en su recibo. El mejor momento para empezar a ahorrar es ahora.`,
        followUp: 'Podemos arrancar la instalacion en [plazo] si avanzamos esta semana.',
      },
      {
        type: 'Financiamiento',
        argument: `Con nuestro plan de financiamiento, su pago mensual es menor que su recibo actual. Empieza a ahorrar desde el dia uno sin inversion inicial.`,
        followUp: 'Le envio la simulacion de financiamiento con su consumo actual.',
      },
      {
        type: 'Social Proof',
        argument: `Empresas como [Cliente Similar] en ${ctx.zone || 'la zona'} ya estan ahorrando con nosotros. Puedo compartirle su caso de exito.`,
        followUp: 'Le agendo una visita a una instalacion existente para que lo vea en persona.',
      },
      {
        type: 'Escasez',
        argument: `Tenemos disponibilidad limitada para instalaciones este mes. Si confirma antes del [fecha], puedo garantizarle las condiciones actuales.`,
        followUp: 'Le reservo el espacio mientras lo confirma con su equipo.',
      },
    ];
  }

  // ─────────────────────────────────────────────────────
  // PREBUILT SUGGESTION LIBRARY
  // ─────────────────────────────────────────────────────

  async getSuggestionLibrary(stage: CoachStage) {
    const libraries: Record<CoachStage, any> = {
      new_lead: {
        whatsapp: [
          'Hola [Nombre]! Soy [Tu Nombre] de IEA. Nos especializamos en energia solar y me gustaria platicar sobre como podemos ayudar a [Empresa] a reducir costos.',
          'Buenos dias [Nombre], me recomendaron contactarte. En IEA tenemos soluciones de energia solar que podrian beneficiar a [Empresa]. ¿Tienes 5 minutos?',
          'Hola [Nombre], vi que [Empresa] podria beneficiarse de energia solar. Tenemos opciones desde $0 enganche. ¿Te interesa saber mas?',
          'Hola [Nombre]! Soy de Ingenieria Electrica Alanis. Ayudamos a empresas como [Empresa] a ahorrar hasta 40% en energia. ¿Podemos platicar?',
          'Buenos dias [Nombre], me gustaria presentarle una solucion que le ahorraria miles al mes en energia. ¿Tiene un momento esta semana?',
          'Hola [Nombre], estoy contactando empresas de [Zona] para presentar nuestras nuevas opciones en energia solar. ¿Le interesa una cotizacion sin compromiso?',
          'Buenas tardes [Nombre], en IEA llevamos +[X] proyectos en [Zona]. Me gustaria mostrarle como podemos ayudar a [Empresa]. ¿Cuando le funciona?',
          'Hola [Nombre]! Vi que [Empresa] tiene un gran potencial para energia solar. Tenemos financiamiento flexible. ¿Hablamos?',
          'Buenos dias [Nombre], soy asesor de IEA. Nuestros clientes en [Zona] ahorran en promedio 38% en energia. ¿Le gustaria saber cuanto podria ahorrar [Empresa]?',
          'Hola [Nombre], lo contacto porque [Empresa] podria beneficiarse de nuestro programa de energia solar con ROI en 3 anos. ¿Le interesa una evaluacion gratuita?',
        ],
        sms: [
          'Hola [Nombre], soy de IEA. Soluciones de energia solar para [Empresa]. ¿Puedo llamarte? Responde SI.',
          '[Nombre], ahorre hasta 40% en energia con IEA. Cotizacion gratis. Responda SI para info. -IEA',
          'Hola [Nombre], le escribo de IEA sobre energia solar para [Empresa]. ¿Le interesa? Responda.',
          '[Nombre], IEA tiene financiamiento $0 enganche en energia solar. Info sin compromiso. Responda SI.',
          'Buenos dias [Nombre], me gustaria presentarle opciones de ahorro energetico para [Empresa]. ¿Puedo llamar? -IEA',
          '[Nombre], empresas como la suya ahorran miles con IEA. Cotizacion gratis. Responda para agendar.',
          'Hola [Nombre], le contacto de IEA. Energia solar con retorno en 3 anos. ¿Hablamos? Responda SI.',
          '[Nombre], me recomendaron contactarle. Soy de IEA, energia solar. ¿Puedo llamar? -[Tu Nombre]',
          'Hola [Nombre], evaluacion gratuita de ahorro energetico para [Empresa]. ¿Le interesa? Responda. -IEA',
          '[Nombre], IEA le ofrece energia solar sin inversion inicial. ¿Cuando puedo llamarle? Responda hora.',
        ],
        email: [
          { subject: 'Reduccion de costos energeticos para [Empresa]', preview: 'Hasta 40% de ahorro con energia solar' },
          { subject: 'Propuesta de energia solar — IEA', preview: 'Soluciones personalizadas con financiamiento' },
          { subject: 'Recomendacion: Energia solar para [Empresa]', preview: 'Me recomendaron contactarle' },
          { subject: 'Ahorre miles al mes — Energia Solar IEA', preview: 'Cotizacion sin compromiso' },
          { subject: 'Invitacion: Evaluacion energetica gratuita', preview: 'Descubra cuanto puede ahorrar' },
          { subject: 'Nueva tecnologia solar para [Industria]', preview: 'Soluciones especializadas para su sector' },
          { subject: 'IEA — Lider en energia solar en [Zona]', preview: 'Mas de [X] proyectos exitosos' },
          { subject: 'Financiamiento solar $0 enganche', preview: 'Empiece a ahorrar desde el dia uno' },
          { subject: 'Caso de exito: [Cliente Similar] ahorro 45%', preview: 'Vea como empresas como la suya se benefician' },
          { subject: 'Oportunidad: Energia solar para [Empresa]', preview: 'Propuesta personalizada lista' },
        ],
      },
      follow_up: {
        whatsapp: [
          'Hola [Nombre], ¿tuvo oportunidad de revisar la informacion que le envie? Quedo atento.',
          '[Nombre], solo queria dar seguimiento. ¿Tiene alguna duda sobre la propuesta? Con gusto le ayudo.',
          'Hola [Nombre], espero este bien. Le comparto un caso de exito reciente que podria interesarle.',
          '[Nombre], ¿como va la evaluacion? Recuerde que tenemos condiciones especiales este mes.',
          'Buenos dias [Nombre], ¿necesita informacion adicional para tomar su decision? Estoy para servirle.',
          'Hola [Nombre], no quiero ser insistente, pero no quiero que pierda las condiciones actuales. ¿Hablamos?',
          '[Nombre], le comparto los resultados de un proyecto similar: 42% de ahorro. ¿Le gustaria lo mismo?',
          'Hola [Nombre], se que esta ocupado. ¿Le funciona una llamada de 5 min esta semana? Tengo info importante.',
          '[Nombre], revisando su caso, creo que tenemos la solucion perfecta. ¿Cuando podemos platicar?',
          'Buenos dias [Nombre], ¿sigue interesado en energia solar? Tengo novedades que le van a gustar.',
        ],
        sms: [
          '[Nombre], seguimiento IEA. ¿Reviso la cotizacion? Responda para agendar llamada.',
          'Hola [Nombre], ¿alguna duda sobre la propuesta? Estoy para ayudar. -IEA',
          '[Nombre], condiciones especiales IEA vigentes hasta [fecha]. ¿Hablamos?',
          'Seguimiento: [Nombre], tengo info nueva sobre ahorro para [Empresa]. ¿Puedo llamar? -IEA',
          '[Nombre], 42% de ahorro comprobado. ¿Le interesa ver numeros para [Empresa]? Responda SI.',
          'Hola [Nombre], no quiero que pierda la oferta actual. Ultimo dia: [fecha]. ¿Lo platicamos? -IEA',
          '[Nombre], ¿necesita opciones de financiamiento? Tenemos planes sin enganche. Responda para info.',
          'Seguimiento rapido [Nombre]: ¿todo bien? ¿Necesita algo mas? Estamos para servirle. -IEA',
          '[Nombre], revisando su caso encontre una opcion mejor. ¿5 min para explicarle? Responda hora.',
          'Hola [Nombre], su proyecto de energia solar tiene gran potencial. ¿Cuando avanzamos? -IEA',
        ],
        email: [
          { subject: 'Seguimiento: Propuesta de energia solar', preview: '¿Tiene alguna duda?' },
          { subject: 'Caso de exito: 42% de ahorro comprobado', preview: 'Resultados reales para su sector' },
          { subject: 'Condiciones especiales — vigentes hasta [fecha]', preview: 'No queremos que se las pierda' },
          { subject: 'Re: Cotizacion energia solar [Empresa]', preview: 'Seguimiento a nuestra propuesta' },
          { subject: 'Nuevas opciones de financiamiento — IEA', preview: 'Planes desde $0 enganche' },
          { subject: 'Su proyecto de energia solar: siguiente paso', preview: 'Listo para avanzar cuando usted diga' },
          { subject: 'Informacion complementaria — [Empresa]', preview: 'Datos adicionales que solicito' },
          { subject: '¿Necesita mas informacion? — IEA', preview: 'Estamos para ayudarle' },
          { subject: 'Beneficios actualizados para [Empresa]', preview: 'Mejores condiciones disponibles' },
          { subject: 'Ultimo dia: Condiciones especiales energia solar', preview: 'Oferta vigente hasta hoy' },
        ],
      },
      negotiation: {
        whatsapp: ['Placeholder'], sms: ['Placeholder'],
        email: [{ subject: 'P', preview: 'P' }],
      },
      reactivation: {
        whatsapp: ['Placeholder'], sms: ['Placeholder'],
        email: [{ subject: 'P', preview: 'P' }],
      },
      post_sale: {
        whatsapp: ['Placeholder'], sms: ['Placeholder'],
        email: [{ subject: 'P', preview: 'P' }],
      },
    };

    return libraries[stage] || libraries.new_lead;
  }

  // ─────────────────────────────────────────────────────
  // TONE ADJUSTMENTS
  // ─────────────────────────────────────────────────────

  private getToneAdjustments(tone: Tone): { greeting: string; cta: string; closing: string } {
    const tones: Record<Tone, { greeting: string; cta: string; closing: string }> = {
      professional: {
        greeting: 'Estimado(a)',
        cta: '¿Podriamos agendar una reunion esta semana?',
        closing: 'Quedo a sus ordenes.',
      },
      warm: {
        greeting: 'Hola',
        cta: '¿Te gustaria que platicemos mas al respecto?',
        closing: 'Un abrazo, quedo al pendiente.',
      },
      direct: {
        greeting: 'Buen dia',
        cta: '¿Cuando podemos agendar?',
        closing: 'Quedo atento a su respuesta.',
      },
      consultative: {
        greeting: 'Estimado(a)',
        cta: '¿Le gustaria explorar juntos las opciones que mejor se adapten a su situacion?',
        closing: 'Estoy para asesorarle en lo que necesite.',
      },
      high_urgency: {
        greeting: 'Buen dia',
        cta: 'Necesitamos definir esto esta semana. ¿Cuando le funciona?',
        closing: 'Espero su confirmacion.',
      },
      soft_urgency: {
        greeting: 'Hola',
        cta: '¿Podriamos avanzar pronto? Tenemos disponibilidad limitada este mes.',
        closing: 'Quedo pendiente, espero su respuesta.',
      },
    };
    return tones[tone] || tones.professional;
  }

  // ─────────────────────────────────────────────────────
  // USAGE TRACKING
  // ─────────────────────────────────────────────────────

  async trackUsage(data: {
    advisorId: string;
    leadId?: string;
    stage: string;
    channel: string;
    action: string;
    tone?: string;
    category?: string;
    messageType?: string;
    metadata?: any;
  }) {
    return this.prisma.coachUsage.create({ data });
  }

  async getCoachStats(days = 30): Promise<CoachStats> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [total, byStage, byChannel, byAdvisor, byAction] = await Promise.all([
      this.prisma.coachUsage.count({ where: { createdAt: { gte: since } } }),
      this.prisma.coachUsage.groupBy({ by: ['stage'], where: { createdAt: { gte: since } }, _count: true }),
      this.prisma.coachUsage.groupBy({ by: ['channel'], where: { createdAt: { gte: since } }, _count: true }),
      this.prisma.coachUsage.groupBy({ by: ['advisorId'], where: { createdAt: { gte: since } }, _count: true, orderBy: { _count: { advisorId: 'desc' } }, take: 10 }),
      this.prisma.coachUsage.groupBy({ by: ['action'], where: { createdAt: { gte: since } }, _count: true }),
    ]);

    return {
      totalUsages: total,
      byStage: byStage.map((g) => ({ stage: g.stage, count: g._count })),
      byChannel: byChannel.map((g) => ({ channel: g.channel, count: g._count })),
      byAdvisor: byAdvisor.map((g) => ({ advisorId: g.advisorId, count: g._count })),
      byAction: byAction.map((g) => ({ action: g.action, count: g._count })),
      topObjections: [],
    };
  }
}
