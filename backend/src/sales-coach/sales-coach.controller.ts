import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { SalesCoachService, CoachInput, CoachStage } from './sales-coach.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('coach')
@UseGuards(JwtAuthGuard)
export class SalesCoachController {
  constructor(private readonly coach: SalesCoachService) {}

  /** Generate coaching for a lead/stage */
  @Post('generate')
  generateCoaching(@Body() input: CoachInput) {
    return this.coach.generateCoaching(input);
  }

  /** Get prebuilt suggestion library for a stage */
  @Get('library/:stage')
  getSuggestionLibrary(@Param('stage') stage: CoachStage) {
    return this.coach.getSuggestionLibrary(stage);
  }

  /** Track usage of a coaching suggestion */
  @Post('track')
  trackUsage(@Body() body: {
    advisorId: string;
    leadId?: string;
    stage: CoachStage;
    channel: string;
    action: string;
    tone?: string;
    category?: string;
    messageType?: string;
    suggestionId?: string;
    metadata?: Record<string, any>;
  }) {
    return this.coach.trackUsage(body);
  }

  /** Get coach usage stats */
  @Get('stats')
  getCoachStats(@Query('days') days?: string) {
    return this.coach.getCoachStats(days ? parseInt(days, 10) : undefined);
  }
}
