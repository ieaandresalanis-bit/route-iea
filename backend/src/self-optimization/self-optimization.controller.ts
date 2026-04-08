import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { SelfOptimizationService } from './self-optimization.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('self-optimization')
@UseGuards(JwtAuthGuard)
export class SelfOptimizationController {
  constructor(private readonly so: SelfOptimizationService) {}

  /** Performance analysis — channels, advisors, funnel, velocity */
  @Get('performance')
  getPerformance() {
    return this.so.getPerformanceAnalysis();
  }

  /** Revenue-based learning insights */
  @Get('learning')
  getLearning() {
    return this.so.getLearningInsights();
  }

  /** Pending optimizations — suggested, applied, rejected */
  @Get('optimizations')
  getOptimizations() {
    return this.so.getOptimizations();
  }

  /** Apply an optimization */
  @Post('optimizations/:id/apply')
  applyOptimization(@Param('id') id: string) {
    return this.so.applyOptimization(id);
  }

  /** Reject an optimization */
  @Post('optimizations/:id/reject')
  rejectOptimization(@Param('id') id: string) {
    return this.so.rejectOptimization(id);
  }

  /** Experimentation engine — A/B test results */
  @Get('experiments')
  getExperiments() {
    return this.so.getExperiments();
  }

  /** Feedback loop status — system improvement tracking */
  @Get('feedback-loop')
  getFeedbackLoop() {
    return this.so.getFeedbackLoopStatus();
  }

  /** Director strategic insights */
  @Get('director')
  getDirectorInsights() {
    return this.so.getDirectorInsights();
  }

  /** Supervisor coaching & execution insights */
  @Get('supervisor')
  getSupervisorInsights() {
    return this.so.getSupervisorInsights();
  }

  /** Last optimization agent cycle */
  @Get('last-cycle')
  getLastCycle() {
    return this.so.getLastAgentResult() ?? { message: 'No cycle has run yet' };
  }

  /** Manually trigger the Optimization Agent */
  @Post('trigger-agent')
  triggerAgent() {
    return this.so.runOptimizationAgent();
  }
}
