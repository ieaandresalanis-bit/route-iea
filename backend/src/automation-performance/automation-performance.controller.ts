import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { AutomationPerformanceService } from './automation-performance.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('automation-performance')
@UseGuards(JwtAuthGuard)
export class AutomationPerformanceController {
  constructor(private readonly perf: AutomationPerformanceService) {}

  // ─── Dashboard ──────────────────────────────────────────

  /** Full performance dashboard with funnel, breakdowns, rankings, alerts, recommendations */
  @Get('dashboard')
  getDashboard() {
    return this.perf.getPerformanceDashboard();
  }

  /** Sync lead outcomes into sequence records */
  @Post('sync-outcomes')
  syncOutcomes() {
    return this.perf.syncOutcomes();
  }

  // ─── Message Ranking ────────────────────────────────────

  /** Rank all messages by performance */
  @Get('messages')
  getMessageRanking() {
    return this.perf.getMessageRanking();
  }

  // ─── A/B Testing ────────────────────────────────────────

  /** Get all A/B tests */
  @Get('ab-tests')
  getABTests() {
    return this.perf.getABTests();
  }

  /** Create a new A/B test */
  @Post('ab-tests')
  createABTest(
    @Body() body: {
      name: string; description?: string; trigger: string; channel: string; stepNumber: number;
      variantABody: string; variantASubject?: string; variantATone?: string;
      variantBBody: string; variantBSubject?: string; variantBTone?: string;
      minSampleSize?: number;
    },
  ) {
    return this.perf.createABTest(body);
  }

  /** Record an A/B test event */
  @Post('ab-tests/:id/event')
  recordABEvent(
    @Param('id') id: string,
    @Body() body: { variant: 'A' | 'B'; event: 'sent' | 'opened' | 'replied' | 'converted' },
  ) {
    return this.perf.recordABEvent(id, body.variant, body.event);
  }

  /** Manually select winner */
  @Patch('ab-tests/:id/winner')
  selectWinner(@Param('id') id: string, @Body() body: { winner: 'A' | 'B' }) {
    return this.perf.selectWinner(id, body.winner);
  }

  // ─── Alerts ─────────────────────────────────────────────

  /** Generate performance alerts */
  @Post('alerts/generate')
  generateAlerts() {
    return this.perf.generateAlerts();
  }

  /** Get open alerts */
  @Get('alerts')
  getAlerts() {
    return this.perf.getAlerts();
  }

  /** Resolve an alert */
  @Patch('alerts/:id/resolve')
  resolveAlert(@Param('id') id: string) {
    return this.perf.resolveAlert(id);
  }

  /** Dismiss an alert */
  @Patch('alerts/:id/dismiss')
  dismissAlert(@Param('id') id: string) {
    return this.perf.dismissAlert(id);
  }

  // ─── Outcome Tracking ──────────────────────────────────

  /** Record a meeting was booked from a sequence */
  @Patch('sequence/:id/meeting')
  recordMeeting(@Param('id') id: string) {
    return this.perf.recordMeeting(id);
  }

  /** Record a deal was created from a sequence */
  @Patch('sequence/:id/deal')
  recordDeal(@Param('id') id: string) {
    return this.perf.recordDeal(id);
  }

  /** Record a deal was closed from a sequence */
  @Patch('sequence/:id/close')
  recordClose(@Param('id') id: string, @Body() body: { revenue: number }) {
    return this.perf.recordClose(id, body.revenue);
  }
}
