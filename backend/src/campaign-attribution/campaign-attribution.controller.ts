import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { CampaignAttributionService } from './campaign-attribution.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('attribution')
@UseGuards(JwtAuthGuard)
export class CampaignAttributionController {
  constructor(private readonly attribution: CampaignAttributionService) {}

  /** Seed campaign dimension table with known campaigns */
  @Post('seed')
  seedCampaigns() {
    return this.attribution.seedCampaigns();
  }

  /** Backfill attribution for local leads based on source field */
  @Post('backfill')
  backfillLocalLeads() {
    return this.attribution.backfillLocalLeads();
  }

  /** Process Zoho data — expects { leads: [...], deals: [...] } */
  @Post('sync')
  syncFromZoho(@Body() body: { leads: any[]; deals: any[] }) {
    return this.attribution.processZohoSync(body.leads || [], body.deals || []);
  }

  /** Get attribution validation stats */
  @Get('stats')
  getStats() {
    return this.attribution.getAttributionStats();
  }

  /** Get all campaigns (dimension table) */
  @Get('campaigns')
  getCampaigns() {
    return this.attribution.getCampaigns();
  }

  /** Get channel dimension */
  @Get('channels')
  getChannels() {
    return this.attribution.getChannels();
  }

  /** Get source type dimension */
  @Get('source-types')
  getSourceTypes() {
    return this.attribution.getSourceTypes();
  }
}
