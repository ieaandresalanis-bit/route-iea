import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { RevenueIntelligenceService } from './revenue-intelligence.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('revenue-intelligence')
@UseGuards(JwtAuthGuard)
export class RevenueIntelligenceController {
  constructor(private readonly ri: RevenueIntelligenceService) {}

  /** Real-time revenue dashboard with breakdowns */
  @Get('dashboard')
  getDashboard() {
    return this.ri.getDashboard();
  }

  /** Predictive forecast engine — week, month, next month */
  @Get('forecast')
  getForecast() {
    return this.ri.getForecast();
  }

  /** Revenue gap analysis — target vs forecast */
  @Get('gap-analysis')
  getGapAnalysis() {
    return this.ri.getGapAnalysis();
  }

  /** Closing + forecast integration — high-impact deals */
  @Get('closing-integration')
  getClosingIntegration() {
    return this.ri.getClosingForecastIntegration();
  }

  /** Director strategic view */
  @Get('director')
  getDirectorView() {
    return this.ri.getDirectorView();
  }

  /** Supervisor control view */
  @Get('supervisor')
  getSupervisorView() {
    return this.ri.getSupervisorView();
  }

  /** Daily revenue tracking — daily, weekly, monthly progress */
  @Get('daily-tracking')
  getDailyTracking() {
    return this.ri.getDailyTracking();
  }

  /** Last Revenue Agent cycle result */
  @Get('last-cycle')
  getLastCycle() {
    return this.ri.getLastAgentResult() ?? { message: 'No cycle has run yet' };
  }

  /** Manually trigger the Revenue Agent */
  @Post('trigger-agent')
  triggerAgent() {
    return this.ri.runRevenueAgent();
  }
}
