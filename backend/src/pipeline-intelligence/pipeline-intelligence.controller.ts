import { Controller, Get, Patch, Post, Query, Body, Req, UseGuards } from '@nestjs/common';
import { PipelineIntelligenceService } from './pipeline-intelligence.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('pipeline-intelligence')
@UseGuards(JwtAuthGuard)
export class PipelineIntelligenceController {
  constructor(private readonly svc: PipelineIntelligenceService) {}

  /** Full pipeline data — stages with leads, summary, workload, analytics */
  @Get()
  getPipeline(
    @Query('advisorId') advisorId?: string,
    @Query('zone') zone?: string,
    @Query('source') source?: string,
    @Query('industry') industry?: string,
    @Query('billRange') billRange?: string,
    @Query('minAmount') minAmount?: string,
    @Query('maxAmount') maxAmount?: string,
    @Query('stage') stage?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('label') label?: string,
  ) {
    return this.svc.getPipeline({
      advisorId, zone, source, industry, billRange,
      minAmount: minAmount ? parseFloat(minAmount) : undefined,
      maxAmount: maxAmount ? parseFloat(maxAmount) : undefined,
      stage, dateFrom, dateTo, label,
    });
  }

  /** Advisor workload breakdown */
  @Get('workload')
  getWorkload() {
    return this.svc.getWorkload();
  }

  /** Move lead to a new pipeline stage */
  @Patch('move-stage')
  moveStage(
    @Body() body: { leadId: string; newStage: string },
    @Req() req: any,
  ) {
    return this.svc.moveStage(body.leadId, body.newStage, req.user.id);
  }

  /** Log activity on a lead */
  @Post('log-activity')
  logActivity(
    @Body() body: { leadId: string; type: string; notes?: string },
    @Req() req: any,
  ) {
    return this.svc.logActivity(body.leadId, body.type, body.notes, req.user.id);
  }

  /** All unique labels extracted from lead notes */
  @Get('labels')
  getLabels() {
    return this.svc.getLabels();
  }
}
