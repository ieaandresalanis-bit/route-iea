import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ChannelIntelligenceService } from './channel-intelligence.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('channel-intelligence')
@UseGuards(JwtAuthGuard)
export class ChannelIntelligenceController {
  constructor(private readonly svc: ChannelIntelligenceService) {}

  /** Main dashboard — channel performance, stage analysis, conversions */
  @Get()
  getDashboard(
    @Query('source') source?: string,
    @Query('zone') zone?: string,
    @Query('industry') industry?: string,
    @Query('advisorId') advisorId?: string,
    @Query('billRange') billRange?: string,
    @Query('minAmount') minAmount?: string,
    @Query('maxAmount') maxAmount?: string,
    @Query('stage') stage?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.svc.getDashboard({
      source, zone, industry, advisorId, billRange,
      minAmount: minAmount ? parseFloat(minAmount) : undefined,
      maxAmount: maxAmount ? parseFloat(maxAmount) : undefined,
      stage, dateFrom, dateTo,
    });
  }

  /** Segmentation — breakdowns by zone, industry, bill range, amount bucket, cross-tab */
  @Get('segmentation')
  getSegmentation(
    @Query('source') source?: string,
    @Query('zone') zone?: string,
    @Query('industry') industry?: string,
    @Query('advisorId') advisorId?: string,
    @Query('billRange') billRange?: string,
    @Query('minAmount') minAmount?: string,
    @Query('maxAmount') maxAmount?: string,
    @Query('stage') stage?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.svc.getSegmentation({
      source, zone, industry, advisorId, billRange,
      minAmount: minAmount ? parseFloat(minAmount) : undefined,
      maxAmount: maxAmount ? parseFloat(maxAmount) : undefined,
      stage, dateFrom, dateTo,
    });
  }

  /** Decision engine — AI-powered recommendations and action plans */
  @Get('decisions')
  getDecisions(
    @Query('source') source?: string,
    @Query('zone') zone?: string,
    @Query('industry') industry?: string,
    @Query('advisorId') advisorId?: string,
    @Query('billRange') billRange?: string,
    @Query('minAmount') minAmount?: string,
    @Query('maxAmount') maxAmount?: string,
    @Query('stage') stage?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.svc.getDecisions({
      source, zone, industry, advisorId, billRange,
      minAmount: minAmount ? parseFloat(minAmount) : undefined,
      maxAmount: maxAmount ? parseFloat(maxAmount) : undefined,
      stage, dateFrom, dateTo,
    });
  }
}
