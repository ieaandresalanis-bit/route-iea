import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { ZohoSyncService } from './zoho-sync.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('zoho-sync')
@UseGuards(JwtAuthGuard)
export class ZohoSyncController {
  constructor(private readonly sync: ZohoSyncService) {}

  /** Full sync: advisors + deals + templates */
  @Post('full')
  runFullSync(@Body() body: { deals: any[] }) {
    return this.sync.runFullSync(body.deals);
  }

  /** Sync advisors only */
  @Post('advisors')
  syncAdvisors(@Body() body: { advisors: Array<{ firstName: string; lastName: string; email: string }> }) {
    return this.sync.syncAdvisors(body.advisors);
  }

  /** Sync deals as leads */
  @Post('deals')
  syncDeals(@Body() body: { deals: any[] }) {
    return this.sync.syncDealsAsLeads(body.deals);
  }

  /** Seed message templates */
  @Post('templates')
  seedTemplates() {
    return this.sync.seedMessageTemplates();
  }
}
