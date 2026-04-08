import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

/**
 * Zoho → Local DB sync service.
 * Accepts pre-fetched Zoho deal arrays and upserts them as local leads + users.
 * This is the bridge that activates the entire system.
 */
@Injectable()
export class ZohoSyncService {
  private readonly logger = new Logger(ZohoSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── STAGE MAPPING ────────────────────────────────────────
  private mapZohoStageToLocal(stage: string): string {
    const map: Record<string, string> = {
      'Pendiente de Contactar': 'PENDIENTE_CONTACTAR',
      'Intentando Contactar': 'INTENTANDO_CONTACTAR',
      'En prospección': 'EN_PROSPECCION',
      'Agendar Cita': 'AGENDAR_CITA',
      'Cita Agendada': 'AGENDAR_CITA',
      'Esperando Realizar Cotización': 'ESPERANDO_COTIZACION',
      'Cotización Entregada': 'COTIZACION_ENTREGADA',
      'Esperando Contrato y Factura': 'ESPERANDO_CONTRATO',
      'Pendiente de Pago': 'PENDIENTE_PAGO',
      'Tramite en financiera': 'ESPERANDO_CONTRATO',
      'Recoleccion de Firmas': 'ESPERANDO_CONTRATO',
      'Entrega de documentos': 'ESPERANDO_CONTRATO',
      'Etapa 1 Aspiria': 'EN_PROSPECCION',
      'Cerrado Ganado': 'CERRADO_GANADO',
      'Vendida': 'CERRADO_GANADO',
      'Cerrado Perdido': 'CERRADO_PERDIDO',
      'Lead Basura': 'LEAD_BASURA',
      'Contactar en el futuro': 'CONTACTAR_FUTURO',
    };
    return map[stage] || 'EN_PROSPECCION';
  }

  // ── SOURCE MAPPING ───────────────────────────────────────
  private mapZohoSource(leadSource: string | null): string {
    if (!leadSource) return 'OTHER';
    const src = leadSource.toLowerCase();
    if (src.includes('facebook') || src.includes('instagram') || src.includes('tiktok') || src.includes('google')) return 'WEBSITE';
    if (src.includes('cambaceo') || src.includes('cold')) return 'COLD_CALL';
    if (src.includes('recomend') || src.includes('referido')) return 'REFERRAL';
    if (src.includes('whatsapp') || src.includes('web')) return 'WEBSITE';
    if (src.includes('feria') || src.includes('expo')) return 'TRADE_SHOW';
    return 'OTHER';
  }

  // ── ZONE INFERENCE ───────────────────────────────────────
  private inferZone(dealName: string, accountName: string | null): string {
    const text = `${dealName} ${accountName || ''}`.toLowerCase();
    if (text.includes('monterrey') || text.includes('mty') || text.includes('nuevo leon')) return 'NORTE';
    if (text.includes('cdmx') || text.includes('mexico') || text.includes('puebla')) return 'CENTRO';
    if (text.includes('leon') || text.includes('queretaro') || text.includes('guanajuato') || text.includes('aguascalientes') || text.includes('slp')) return 'BAJIO';
    // Default to OCCIDENTE (Jalisco/GDL where IEA is based)
    return 'OCCIDENTE';
  }

  // ── 1. SYNC ADVISORS ────────────────────────────────────
  async syncAdvisors(advisors: Array<{
    firstName: string;
    lastName: string;
    email: string;
  }>): Promise<{ created: number; existing: number }> {
    let created = 0;
    let existing = 0;

    for (const adv of advisors) {
      const exists = await this.prisma.user.findUnique({
        where: { email: adv.email },
      });

      if (exists) {
        existing++;
        continue;
      }

      await this.prisma.user.create({
        data: {
          email: adv.email,
          password: '$2b$10$YourHashedPasswordHere', // Placeholder — must be reset
          firstName: adv.firstName,
          lastName: adv.lastName,
          role: 'OPERATOR',
          isActive: true,
          department: 'Comercial',
          jobTitle: 'Asesor Comercial',
        },
      });
      created++;
      this.logger.log(`Created advisor: ${adv.firstName} ${adv.lastName} (${adv.email})`);
    }

    return { created, existing };
  }

  // ── 2. SYNC DEALS AS LEADS ──────────────────────────────
  async syncDealsAsLeads(deals: Array<{
    id: string;
    Deal_Name: string;
    Account_Name: string | null;
    Stage: string;
    Amount: number | null;
    Lead_Source: string | null;
    'Owner.email': string;
    'Owner.first_name': string;
    'Owner.last_name': string;
    Contact_Name: { name: string; id: string } | null;
    Created_Time: string;
    Closing_Date: string | null;
  }>): Promise<{ created: number; updated: number; skipped: number; errors: string[] }> {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Pre-fetch all advisors for assignment
    const users = await this.prisma.user.findMany({
      select: { id: true, email: true },
    });
    const userByEmail = new Map(users.map(u => [u.email, u.id]));

    for (const deal of deals) {
      try {
        const zohoId = deal.id;
        const contactName = deal.Contact_Name?.name || deal.Deal_Name;
        const rawAccount = deal.Account_Name as any;
        const companyName = typeof rawAccount === 'string' ? rawAccount : (rawAccount?.name || deal.Deal_Name);
        const stage = this.mapZohoStageToLocal(deal.Stage);
        const source = this.mapZohoSource(deal.Lead_Source);
        const zone = this.inferZone(deal.Deal_Name, deal.Account_Name);
        const advisorId = userByEmail.get(deal['Owner.email']) || null;

        // Check if lead already synced by zohoDealId
        const existing = await this.prisma.lead.findFirst({
          where: { zohoDealId: zohoId },
        });

        if (existing) {
          // Update stage and amount
          await this.prisma.lead.update({
            where: { id: existing.id },
            data: {
              status: stage as any,
              estimatedValue: deal.Amount || existing.estimatedValue,
              assignedToId: advisorId || existing.assignedToId,
              zohoSyncStatus: 'synced',
              zohoLastSyncedAt: new Date(),
            },
          });
          updated++;
          continue;
        }

        // Create new lead
        await this.prisma.lead.create({
          data: {
            companyName,
            contactName,
            address: 'Guadalajara, Jalisco (pendiente geocodificar)',
            latitude: 20.6597,  // IEA HQ default
            longitude: -103.3496,
            zone: zone as any,
            status: stage as any,
            source: source as any,
            industry: deal.Lead_Source || 'General',
            estimatedValue: deal.Amount || 0,
            assignedToId: advisorId,
            zohoDealId: zohoId,
            zohoSyncStatus: 'synced',
            zohoLastSyncedAt: new Date(),
            notes: `Zoho: ${deal.Stage} | Source: ${deal.Lead_Source || 'N/A'} | Created: ${deal.Created_Time}`,
          },
        });
        created++;
      } catch (err: any) {
        errors.push(`Deal ${deal.id}: ${err.message}`);
        skipped++;
      }
    }

    this.logger.log(`Sync complete: ${created} created, ${updated} updated, ${skipped} skipped`);
    return { created, updated, skipped, errors };
  }

  // ── 3. SEED MESSAGE TEMPLATES ───────────────────────────
  async seedMessageTemplates(): Promise<{ created: number }> {
    const templates = [
      // WhatsApp — new lead
      { key: 'new_lead_whatsapp_solar_consultative', name: 'WhatsApp Primer Contacto', trigger: 'new_lead', channel: 'whatsapp', tone: 'consultative', subject: 'Primer contacto', body: 'Hola {{contactName}}, soy {{advisorName}} de IEA. Vi que estas interesado en nuestros sistemas de energia solar. Me encantaria platicarte como podemos ayudarte a reducir tu recibo de luz. Tienes un momento para una llamada rapida?' },
      // WhatsApp — no response
      { key: 'no_response_whatsapp_solar_warm', name: 'WhatsApp Seguimiento 1', trigger: 'no_response', channel: 'whatsapp', tone: 'warm', subject: 'Seguimiento', body: 'Hola {{contactName}}, te escribi hace unos dias sobre energia solar para tu negocio. Tenemos un programa especial este mes con hasta 30% de ahorro en tu recibo. Te gustaria que te envie una cotizacion sin compromiso?' },
      { key: 'no_response_whatsapp_solar_direct', name: 'WhatsApp Seguimiento 2', trigger: 'no_response', channel: 'whatsapp', tone: 'direct', subject: 'Ultimo seguimiento', body: '{{contactName}}, ultimo mensaje! Solo queria confirmar si sigues interesado en reducir tu gasto de energia. Si no es buen momento, no hay problema. Estamos aqui cuando lo necesites.' },
      // WhatsApp — stalled deal
      { key: 'stalled_deal_whatsapp_solar_urgent', name: 'WhatsApp Cotizacion Entregada', trigger: 'stalled_deal', channel: 'whatsapp', tone: 'urgent', subject: 'Cotizacion', body: 'Hola {{contactName}}, ya tuviste oportunidad de revisar la cotizacion? Recuerda que los precios de paneles pueden variar. Con gusto resuelvo cualquier duda.' },
      { key: 'stalled_deal_whatsapp_solar_consultative', name: 'WhatsApp Empujon Cierre', trigger: 'stalled_deal', channel: 'whatsapp', tone: 'consultative', subject: 'Cierre', body: '{{contactName}}, tenemos disponibilidad de instalacion para la proxima semana. Si confirmamos hoy, podemos asegurar precio y agenda. Que te parece?' },
      // WhatsApp — cold lead
      { key: 'cold_lead_whatsapp_solar_warm', name: 'WhatsApp Reactivacion', trigger: 'cold_lead', channel: 'whatsapp', tone: 'warm', subject: 'Reactivacion', body: 'Hola {{contactName}}, hace tiempo platicamos sobre energia solar. Te cuento que ahora tenemos nuevos esquemas de financiamiento que hacen mucho mas accesible la inversion. Te interesa que te platique?' },
      // SMS
      { key: 'new_lead_sms_solar_direct', name: 'SMS Primer Contacto', trigger: 'new_lead', channel: 'sms', tone: 'direct', subject: 'Contacto SMS', body: 'IEA Solar: Hola {{contactName}}, tenemos una propuesta de ahorro energetico para ti. Responde SI para mas info. {{advisorName}}' },
      { key: 'stalled_deal_sms_solar_urgent', name: 'SMS Recordatorio Cita', trigger: 'stalled_deal', channel: 'sms', tone: 'urgent', subject: 'Recordatorio', body: 'IEA: {{contactName}}, recordatorio de tu cita manana. Confirma respondiendo OK. Gracias!' },
      // Email
      { key: 'stalled_deal_email_solar_formal', name: 'Email Cotizacion', trigger: 'stalled_deal', channel: 'email', tone: 'formal', subject: 'Cotizacion IEA - {{companyName}}', body: 'Estimado(a) {{contactName}},\n\nAdjunto encontraras la cotizacion para el sistema de energia solar que platicamos.\n\nResumen:\n- Ahorro estimado mensual: {{estimatedSavings}}\n- Retorno de inversion: {{roi}} meses\n- Garantia: 25 anos\n\nQuedo a tus ordenes.\n\n{{advisorName}}\nIEA Solar' },
      { key: 'new_lead_email_solar_formal', name: 'Email Propuesta', trigger: 'new_lead', channel: 'email', tone: 'formal', subject: 'Propuesta tecnica - {{companyName}}', body: 'Estimado(a) {{contactName}},\n\nEs un placer presentarte nuestra propuesta tecnica personalizada.\n\nQuedo al pendiente de tus comentarios.\n\nSaludos,\n{{advisorName}}' },
      // Call scripts
      { key: 'new_lead_crm_task_solar_consultative', name: 'Script Llamada Inicial', trigger: 'new_lead', channel: 'crm_task', tone: 'consultative', subject: 'Script llamada inicial', body: 'Buenos dias {{contactName}}, le habla {{advisorName}} de IEA Energia Solar. Le llamo porque mostro interes en nuestros sistemas. Tiene 2 minutos para platicarle como funciona?' },
      { key: 'no_response_crm_task_solar_consultative', name: 'Script Seguimiento', trigger: 'no_response', channel: 'crm_task', tone: 'consultative', subject: 'Script seguimiento', body: '{{contactName}}, buenas tardes. Le llamo para dar seguimiento a la cotizacion que le enviamos. Ya tuvo oportunidad de revisarla? Tiene alguna duda que pueda resolver?' },
      // Post-sale
      { key: 'post_sale_whatsapp_solar_warm', name: 'WhatsApp Post-Venta', trigger: 'post_sale', channel: 'whatsapp', tone: 'warm', subject: 'Bienvenida', body: 'Hola {{contactName}}, felicidades por tu nuevo sistema solar! Soy {{advisorName}} y estare al pendiente de tu instalacion. Cualquier duda me escribes por aqui.' },
    ];

    let created = 0;
    for (const t of templates) {
      const exists = await this.prisma.messageTemplate.findUnique({
        where: { key: t.key },
      });
      if (!exists) {
        await this.prisma.messageTemplate.create({
          data: {
            key: t.key,
            name: t.name,
            trigger: t.trigger,
            channel: t.channel,
            tone: t.tone,
            industry: 'solar',
            subject: t.subject,
            body: t.body,
            variables: this.extractVariables(t.body),
          },
        });
        created++;
      }
    }

    return { created };
  }

  private extractVariables(text: string): string[] {
    const matches = text.match(/\{\{(\w+)\}\}/g) || [];
    return [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))];
  }

  // ── 4. FULL SYNC ORCHESTRATION ──────────────────────────
  async runFullSync(deals: any[]): Promise<{
    advisors: { created: number; existing: number };
    leads: { created: number; updated: number; skipped: number; errors: string[] };
    templates: { created: number };
  }> {
    // Step 1: Extract unique advisors
    const advisorMap = new Map<string, { firstName: string; lastName: string; email: string }>();
    for (const d of deals) {
      const email = d['Owner.email'];
      if (email && !advisorMap.has(email)) {
        advisorMap.set(email, {
          firstName: d['Owner.first_name'],
          lastName: d['Owner.last_name'],
          email,
        });
      }
    }

    this.logger.log(`Found ${advisorMap.size} unique advisors`);
    const advisors = await this.syncAdvisors(Array.from(advisorMap.values()));
    this.logger.log(`Advisors synced: ${advisors.created} created, ${advisors.existing} existing`);

    // Step 2: Sync deals as leads
    const leads = await this.syncDealsAsLeads(deals);
    this.logger.log(`Leads synced: ${leads.created} created, ${leads.updated} updated`);

    // Step 3: Seed message templates
    const templates = await this.seedMessageTemplates();
    this.logger.log(`Templates seeded: ${templates.created}`);

    return { advisors, leads, templates };
  }
}
