import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { DealClosingService } from './deal-closing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('deal-closing')
@UseGuards(JwtAuthGuard)
export class DealClosingController {
  constructor(private readonly dc: DealClosingService) {}

  /** Full closing pipeline scored and ranked */
  @Get('pipeline')
  getPipeline() {
    return this.dc.getClosingPipeline();
  }

  /** Weekly closing plan — targets, gaps, per-advisor */
  @Get('weekly-plan')
  getWeeklyPlan() {
    return this.dc.getWeeklyClosingPlan();
  }

  /** Daily closing tracker — progress vs goal */
  @Get('daily-tracker')
  getDailyTracker() {
    return this.dc.getDailyTracker();
  }

  /** Director strategic view — top deals, risks, forecast */
  @Get('director')
  getDirectorView() {
    return this.dc.getDirectorView();
  }

  /** Supervisor control — advisor performance, gaps, pressure */
  @Get('supervisor')
  getSupervisorView() {
    return this.dc.getSupervisorView();
  }

  /** Closing playbook for a specific deal */
  @Get('playbook/:leadId')
  getPlaybook(@Param('leadId') leadId: string) {
    return this.dc.getDealPlaybook(leadId);
  }

  /** Last agent cycle result */
  @Get('last-cycle')
  getLastCycle() {
    return this.dc.getLastAgentResult() ?? { message: 'No cycle has run yet' };
  }

  /** Manually trigger the Closing Agent */
  @Post('trigger-agent')
  triggerAgent() {
    return this.dc.runClosingAgent();
  }
}
