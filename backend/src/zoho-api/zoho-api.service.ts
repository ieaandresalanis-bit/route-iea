import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

@Injectable()
export class ZohoApiService {
  private readonly logger = new Logger(ZohoApiService.name);
  private tokenCache: TokenCache | null = null;

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly refreshToken: string;
  private readonly apiBase: string;
  private readonly accountsUrl: string;

  constructor(private configService: ConfigService) {
    this.clientId = this.configService.get<string>('ZOHO_CLIENT_ID', '');
    this.clientSecret = this.configService.get<string>('ZOHO_CLIENT_SECRET', '');
    this.refreshToken = this.configService.get<string>('ZOHO_REFRESH_TOKEN', '');
    this.apiBase = this.configService.get<string>(
      'ZOHO_API_BASE',
      'https://www.zohoapis.com/crm/v2',
    );
    this.accountsUrl = this.configService.get<string>(
      'ZOHO_ACCOUNTS_URL',
      'https://accounts.zoho.com/oauth/v2/token',
    );
  }

  // ─── Token Management ────────────────────────────────────

  private async getAccessToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.accessToken;
    }

    this.logger.log('Refreshing Zoho access token');

    const url =
      `${this.accountsUrl}?refresh_token=${this.refreshToken}` +
      `&client_id=${this.clientId}` +
      `&client_secret=${this.clientSecret}` +
      `&grant_type=refresh_token`;

    const res = await fetch(url, { method: 'POST' });

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`Token refresh failed: ${res.status} ${body}`);
      throw new Error(`Zoho token refresh failed: ${res.status}`);
    }

    const data: { access_token: string; expires_in: number; token_type: string } =
      await res.json();

    // Cache with 5 min safety margin
    this.tokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 300) * 1000,
    };

    this.logger.log('Zoho access token refreshed successfully');
    return this.tokenCache.accessToken;
  }

  // ─── HTTP Helper ─────────────────────────────────────────

  private async request(
    method: string,
    url: string,
    body?: any,
    retried = false,
  ): Promise<any> {
    const token = await this.getAccessToken();

    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);

    // 401 — token expired, refresh and retry once
    if (res.status === 401 && !retried) {
      this.logger.warn('Zoho 401 — refreshing token and retrying');
      this.tokenCache = null;
      return this.request(method, url, body, true);
    }

    // 429 — rate limit, wait 1s and retry once
    if (res.status === 429 && !retried) {
      this.logger.warn('Zoho 429 — rate limited, waiting 1s');
      await new Promise((resolve: (value: void) => void) => setTimeout(resolve, 1000));
      return this.request(method, url, body, true);
    }

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Zoho API error: ${method} ${url} → ${res.status} ${text}`);
      throw new Error(`Zoho API ${res.status}: ${text}`);
    }

    // Some endpoints return 204 No Content
    if (res.status === 204) return null;

    return res.json();
  }

  // ─── Generic Methods ─────────────────────────────────────

  async getRecords(
    module: string,
    params?: {
      fields?: string;
      page?: number;
      per_page?: number;
      sort_by?: string;
      sort_order?: string;
    },
  ): Promise<any> {
    const query = new URLSearchParams();
    if (params?.fields) query.set('fields', params.fields);
    if (params?.page) query.set('page', String(params.page));
    if (params?.per_page) query.set('per_page', String(params.per_page));
    if (params?.sort_by) query.set('sort_by', params.sort_by);
    if (params?.sort_order) query.set('sort_order', params.sort_order);

    const qs = query.toString();
    const url = `${this.apiBase}/${module}${qs ? `?${qs}` : ''}`;
    return this.request('GET', url);
  }

  async searchRecords(module: string, criteria: string): Promise<any> {
    const url = `${this.apiBase}/${module}/search?criteria=${encodeURIComponent(criteria)}`;
    return this.request('GET', url);
  }

  async getRecord(module: string, id: string): Promise<any> {
    const url = `${this.apiBase}/${module}/${id}`;
    return this.request('GET', url);
  }

  async updateRecord(module: string, id: string, data: any): Promise<any> {
    const url = `${this.apiBase}/${module}/${id}`;
    return this.request('PUT', url, { data: [data] });
  }

  async createRecord(module: string, data: any): Promise<any> {
    const url = `${this.apiBase}/${module}`;
    return this.request('POST', url, { data: [data] });
  }

  // ─── Convenience Methods ─────────────────────────────────

  async getDeals(page?: number, perPage?: number): Promise<any> {
    return this.getRecords('Deals', { page, per_page: perPage });
  }

  async getLeads(page?: number, perPage?: number): Promise<any> {
    return this.getRecords('Leads', { page, per_page: perPage });
  }

  async getContacts(page?: number, perPage?: number): Promise<any> {
    return this.getRecords('Contacts', { page, per_page: perPage });
  }

  async getDealNotes(dealId: string): Promise<any> {
    const url = `${this.apiBase}/Deals/${dealId}/Notes`;
    return this.request('GET', url);
  }

  async createNote(
    module: string,
    recordId: string,
    title: string,
    content: string,
  ): Promise<any> {
    const url = `${this.apiBase}/${module}/${recordId}/Notes`;
    return this.request('POST', url, {
      data: [{ Note_Title: title, Note_Content: content }],
    });
  }

  async createTask(data: {
    Subject: string;
    Due_Date: string;
    Owner?: any;
    What_Id?: any;
    Description?: string;
    Priority?: string;
    Status?: string;
  }): Promise<any> {
    const url = `${this.apiBase}/Tasks`;
    return this.request('POST', url, { data: [data] });
  }

  async updateDealStage(dealId: string, stage: string): Promise<any> {
    return this.updateRecord('Deals', dealId, { Stage: stage });
  }

  async searchDealsByOwner(ownerEmail: string): Promise<any> {
    return this.searchRecords('Deals', `(Owner.email:equals:${ownerEmail})`);
  }

  // ─── COQL Query ──────────────────────────────────────────

  async executeCOQL(query: string): Promise<any> {
    const url = `${this.apiBase}/coql`;
    return this.request('POST', url, { select_query: query });
  }
}
