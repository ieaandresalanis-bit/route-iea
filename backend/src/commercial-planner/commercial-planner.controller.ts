import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CommercialPlannerService } from './commercial-planner.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('planner')
@UseGuards(JwtAuthGuard)
export class CommercialPlannerController {
  constructor(private readonly planner: CommercialPlannerService) {}

  @Get('targets')
  getTargetPriorities(@Query('limit') limit?: string) {
    return this.planner.getTargetPriorities(limit ? parseInt(limit, 10) : undefined);
  }

  @Get('zones')
  getZonePriorities() {
    return this.planner.getZonePriorities();
  }

  @Get('tickets')
  getTicketAnalysis() {
    return this.planner.getTicketAnalysis();
  }

  @Get('industries')
  getIndustryConversions() {
    return this.planner.getIndustryConversions();
  }

  @Get('campaigns')
  getCampaignRecommendations() {
    return this.planner.getCampaignRecommendations();
  }

  @Get('segments')
  getSegmentMessaging() {
    return this.planner.getSegmentMessaging();
  }

  @Get('centers')
  getCenterPlans() {
    return this.planner.getCenterPlans();
  }

  @Get('full')
  getFullPlan() {
    return this.planner.getFullPlan();
  }
}
