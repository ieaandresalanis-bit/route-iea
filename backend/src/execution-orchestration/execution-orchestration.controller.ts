import {
  Controller,
  Get,
  Post,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ExecutionOrchestrationService } from './execution-orchestration.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('execution-orchestration')
@UseGuards(JwtAuthGuard)
export class ExecutionOrchestrationController {
  private readonly logger = new Logger(ExecutionOrchestrationController.name);

  constructor(
    private readonly orchestration: ExecutionOrchestrationService,
  ) {}

  /** Full system status with all metrics and agent statuses */
  @Get('status')
  getStatus() {
    return this.orchestration.getOrchestrationStatus();
  }

  /** Real-time metrics snapshot */
  @Get('metrics')
  getMetrics() {
    return this.orchestration.getRealTimeMetrics();
  }

  /** Last orchestration cycle result */
  @Get('last-cycle')
  getLastCycle() {
    return this.orchestration.getLastCycleResult() || {
      message: 'No orchestration cycle has run yet',
    };
  }

  /** Director priorities for Andrés */
  @Get('director-priorities')
  getDirectorPriorities() {
    return this.orchestration.getDirectorPriorities();
  }

  /** Priority overrides applied in current cycle */
  @Get('priority-overrides')
  getPriorityOverrides() {
    return this.orchestration.getPriorityOverrides();
  }

  /** Director's complete dashboard — everything Andrés needs */
  @Get('director-dashboard')
  getDirectorDashboard() {
    return this.orchestration.getDirectorDashboard();
  }

  /** Manually trigger a full orchestration cycle */
  @Post('trigger-cycle')
  async triggerCycle() {
    this.logger.log('Manual trigger: orchestration cycle');
    const result = await this.orchestration.runOrchestrationCycle();
    return {
      triggered: true,
      cycleId: result.cycleId,
      durationMs: result.durationMs,
      summary: result.summary,
    };
  }

  /** Full system sync — all agents coordinated */
  @Post('full-sync')
  async fullSync() {
    this.logger.log('Manual trigger: FULL SYSTEM SYNC');
    const result = await this.orchestration.fullSystemSync();
    return {
      triggered: true,
      orchestrationCycleId: result.orchestration.cycleId,
      summary: result.orchestration.summary,
      automationEngine: result.automationEngine
        ? 'completed'
        : 'failed',
      followUpScan: result.followUpScan || 'failed',
      alerts: result.alerts || 'failed',
    };
  }
}
