import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { CampaignIntelligenceService } from './campaign-intelligence.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('intelligence')
@UseGuards(JwtAuthGuard)
export class CampaignIntelligenceController {
  constructor(private readonly intel: CampaignIntelligenceService) {}

  /** Full intelligence dashboard — all data in one call */
  @Get('full')
  getFullIntelligence() {
    return this.intel.getFullIntelligence();
  }

  /** Campaign leaderboard with ROI, costs, conversions */
  @Get('leaderboard')
  getLeaderboard() {
    return this.intel.getLeaderboard();
  }

  /** Funnel analysis per campaign */
  @Get('funnels')
  getFunnels() {
    return this.intel.getFunnels();
  }

  /** Lead quality metrics per campaign */
  @Get('quality')
  getLeadQuality() {
    return this.intel.getLeadQuality();
  }

  /** Time-to-close analysis per campaign */
  @Get('time-to-close')
  getTimeToClose() {
    return this.intel.getTimeToClose();
  }

  /** Breakdown by dimension: center, industry, advisor, ticket */
  @Get('breakdown')
  getBreakdown(@Query('dimension') dimension: string) {
    return this.intel.getBreakdown(dimension || 'center');
  }

  /** Update campaign cost data */
  @Post('costs')
  updateCosts(@Body() body: { costs: Array<{ campaignId: string; monthlyCost?: number; totalCost?: number }> }) {
    return this.intel.updateCampaignCosts(body.costs || []);
  }
}
