import { Controller, Get, UseGuards } from '@nestjs/common';
import { CommercialScoutingService } from './commercial-scouting.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('scouting')
@UseGuards(JwtAuthGuard)
export class CommercialScoutingController {
  constructor(private readonly scouting: CommercialScoutingService) {}

  /** Full scouting report — all 12 sections */
  @Get('full')
  getFullReport() {
    return this.scouting.getFullScoutingReport();
  }

  /** Data inventory only */
  @Get('inventory')
  getInventory() {
    return this.scouting.getDataInventory();
  }

  /** Historical by year */
  @Get('yearly')
  getYearly() {
    return this.scouting.getHistoricalByYear();
  }

  /** Zone analysis */
  @Get('zones')
  getZones() {
    return this.scouting.getZoneAnalysis();
  }

  /** Industry analysis */
  @Get('industries')
  getIndustries() {
    return this.scouting.getIndustryAnalysis();
  }

  /** Advisor analysis */
  @Get('advisors')
  getAdvisors() {
    return this.scouting.getAdvisorAnalysis();
  }

  /** Funnel analysis */
  @Get('funnel')
  getFunnel() {
    return this.scouting.getFunnelAnalysis();
  }

  /** Lost opportunity analysis */
  @Get('lost')
  getLost() {
    return this.scouting.getLostOpportunityAnalysis();
  }

  /** Campaign cross-intelligence */
  @Get('campaigns')
  getCampaigns() {
    return this.scouting.getCampaignCrossIntel();
  }

  /** Ticket analysis */
  @Get('tickets')
  getTickets() {
    return this.scouting.getTicketAnalysis();
  }

  /** Data quality audit */
  @Get('quality')
  getQuality() {
    return this.scouting.getDataQuality();
  }
}
