import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';

interface DailyCounter {
  date: string; // YYYY-MM-DD
  count: number;
}

interface MonthlyCounter {
  month: string; // YYYY-MM
  count: number;
}

@Injectable()
export class SmsMasivosService {
  private readonly logger = new Logger(SmsMasivosService.name);

  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly dailyLimit: number;
  private readonly monthlyLimit: number;

  private dailyCounter: DailyCounter = { date: '', count: 0 };
  private monthlyCounter: MonthlyCounter = { month: '', count: 0 };

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.apiKey = this.configService.get<string>('SMS_MASIVOS_API_KEY', '');
    this.apiUrl = this.configService.get<string>(
      'SMS_MASIVOS_API_URL',
      'https://api.smsmasivos.com.mx/sms/send',
    );
    this.dailyLimit = this.configService.get<number>('SMS_MASIVOS_DAILY_LIMIT', 1000);
    this.monthlyLimit = this.configService.get<number>('SMS_MASIVOS_MONTHLY_LIMIT', 30000);
  }

  // ─── Phone Normalization ─────────────────────────────────

  private normalizePhone(phone: string): string {
    // Strip spaces, dashes, parentheses, dots
    let cleaned = phone.replace(/[\s\-().+]/g, '');

    // If it starts with 52 and is 12 digits, add +
    if (cleaned.startsWith('52') && cleaned.length === 12) {
      return `+${cleaned}`;
    }

    // If 10 digits (Mexican local), add +52
    if (cleaned.length === 10) {
      return `+52${cleaned}`;
    }

    // If starts with 1 and is 13 digits (old +521 format), normalize to +52
    if (cleaned.startsWith('521') && cleaned.length === 13) {
      return `+52${cleaned.slice(3)}`;
    }

    // Already has country code or unknown format — return with +
    if (!cleaned.startsWith('+')) {
      cleaned = `+${cleaned}`;
    }

    return cleaned;
  }

  // ─── Rate Limiting ───────────────────────────────────────

  private getTodayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private getMonthKey(): string {
    return new Date().toISOString().slice(0, 7);
  }

  private checkLimits(): { allowed: boolean; reason?: string } {
    const today = this.getTodayKey();
    const month = this.getMonthKey();

    // Reset daily counter if date changed
    if (this.dailyCounter.date !== today) {
      this.dailyCounter = { date: today, count: 0 };
    }

    // Reset monthly counter if month changed
    if (this.monthlyCounter.month !== month) {
      this.monthlyCounter = { month, count: 0 };
    }

    if (this.dailyCounter.count >= this.dailyLimit) {
      return { allowed: false, reason: `Daily SMS limit reached (${this.dailyLimit})` };
    }

    if (this.monthlyCounter.count >= this.monthlyLimit) {
      return { allowed: false, reason: `Monthly SMS limit reached (${this.monthlyLimit})` };
    }

    return { allowed: true };
  }

  private incrementCounters(): void {
    const today = this.getTodayKey();
    const month = this.getMonthKey();

    if (this.dailyCounter.date !== today) {
      this.dailyCounter = { date: today, count: 0 };
    }
    if (this.monthlyCounter.month !== month) {
      this.monthlyCounter = { month, count: 0 };
    }

    this.dailyCounter.count++;
    this.monthlyCounter.count++;
  }

  // ─── Send SMS ────────────────────────────────────────────

  async sendSms(
    phone: string,
    message: string,
    leadId?: string,
    advisorId?: string,
    advisorName?: string,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const normalizedPhone = this.normalizePhone(phone);

    // Check rate limits
    const limitCheck = this.checkLimits();
    if (!limitCheck.allowed) {
      this.logger.warn(`SMS blocked: ${limitCheck.reason}`);

      // Log failed attempt
      await this.logSms({
        phone: normalizedPhone,
        message,
        status: 'failed',
        errorMessage: limitCheck.reason,
        leadId,
        advisorId: advisorId || 'system',
        advisorName,
      });

      return { success: false, error: limitCheck.reason };
    }

    try {
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          apikey: this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phone_number: normalizedPhone.replace('+', ''),
          message,
          sender_id: 'IEA',
        }),
      });

      const data: { success: boolean; message_id?: string; status?: string; error?: string } =
        await res.json();

      if (data.success) {
        this.incrementCounters();

        await this.logSms({
          phone: normalizedPhone,
          message,
          status: 'sent',
          providerMsgId: data.message_id,
          leadId,
          advisorId: advisorId || 'system',
          advisorName,
        });

        // Log to ContactTimeline if we have a leadId
        if (leadId) {
          await this.logTimeline(leadId, message, advisorId, advisorName);
        }

        this.logger.log(`SMS sent to ${normalizedPhone} (id: ${data.message_id})`);
        return { success: true, messageId: data.message_id };
      }

      // API returned success: false
      const errorMsg = data.error || `Provider status: ${data.status}`;
      this.logger.error(`SMS send failed: ${errorMsg}`);

      await this.logSms({
        phone: normalizedPhone,
        message,
        status: 'failed',
        errorMessage: errorMsg,
        leadId,
        advisorId: advisorId || 'system',
        advisorName,
      });

      return { success: false, error: errorMsg };
    } catch (err: any) {
      const errorMsg = err.message || 'Unknown error sending SMS';
      this.logger.error(`SMS exception: ${errorMsg}`, err.stack);

      await this.logSms({
        phone: normalizedPhone,
        message,
        status: 'failed',
        errorMessage: errorMsg,
        leadId,
        advisorId: advisorId || 'system',
        advisorName,
      });

      return { success: false, error: errorMsg };
    }
  }

  // ─── Stats ───────────────────────────────────────────────

  async getSmsStats(): Promise<{
    sentToday: number;
    sentThisMonth: number;
    dailyLimit: number;
    monthlyLimit: number;
  }> {
    const today = this.getTodayKey();
    const month = this.getMonthKey();

    return {
      sentToday: this.dailyCounter.date === today ? this.dailyCounter.count : 0,
      sentThisMonth: this.monthlyCounter.month === month ? this.monthlyCounter.count : 0,
      dailyLimit: this.dailyLimit,
      monthlyLimit: this.monthlyLimit,
    };
  }

  // ─── Query by Lead ───────────────────────────────────────

  async getSmsByLead(leadId: string): Promise<any[]> {
    return this.prisma.smsLog.findMany({
      where: { leadId },
      orderBy: { sentAt: 'desc' },
    });
  }

  // ─── Private Helpers ─────────────────────────────────────

  private async logSms(params: {
    phone: string;
    message: string;
    status: string;
    providerMsgId?: string;
    errorMessage?: string;
    leadId?: string;
    advisorId: string;
    advisorName?: string;
  }): Promise<void> {
    try {
      await this.prisma.smsLog.create({
        data: {
          leadId: params.leadId || null,
          advisorId: params.advisorId,
          advisorName: params.advisorName || null,
          phone: params.phone,
          message: params.message,
          direction: 'outbound',
          status: params.status,
          provider: 'sms_masivos',
          providerMsgId: params.providerMsgId || null,
          errorMessage: params.errorMessage || null,
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to log SMS: ${err.message}`);
    }
  }

  private async logTimeline(
    leadId: string,
    content: string,
    advisorId?: string,
    advisorName?: string,
  ): Promise<void> {
    try {
      await this.prisma.contactTimeline.create({
        data: {
          leadId,
          eventType: 'sms',
          eventSource: 'sms_masivos',
          channel: 'sms',
          content,
          advisorId: advisorId || null,
          advisorName: advisorName || null,
          status: 'completed',
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to log timeline entry: ${err.message}`);
    }
  }
}
