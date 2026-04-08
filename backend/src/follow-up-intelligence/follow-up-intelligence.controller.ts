import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { FollowUpIntelligenceService } from './follow-up-intelligence.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('follow-up-intelligence')
@UseGuards(JwtAuthGuard)
export class FollowUpIntelligenceController {
  constructor(private readonly intelligence: FollowUpIntelligenceService) {}

  /** Full intelligence analysis for a single lead */
  @Get('lead/:leadId')
  getLeadIntelligence(@Param('leadId') leadId: string) {
    return this.intelligence.getLeadIntelligence(leadId);
  }

  /** Bulk intelligence with optional filters */
  @Get('bulk')
  getBulkIntelligence(
    @Query('zone') zone?: string,
    @Query('advisorId') advisorId?: string,
    @Query('minValue') minValue?: string,
    @Query('urgency') urgency?: string,
  ) {
    return this.intelligence.getBulkIntelligence({
      zone: zone || undefined,
      advisorId: advisorId || undefined,
      minValue: minValue ? parseFloat(minValue) : undefined,
      urgency: urgency || undefined,
    });
  }

  /** Advisor-specific intelligence with summary */
  @Get('advisor/:advisorId')
  getAdvisorIntelligence(@Param('advisorId') advisorId: string) {
    return this.intelligence.getAdvisorIntelligence(advisorId);
  }

  /** Director-level strategic briefing */
  @Get('director-briefing')
  getDirectorBriefing() {
    return this.intelligence.getDirectorBriefing();
  }
}
