import { Controller, Get, Post, Patch, Param, Query, UseGuards } from '@nestjs/common';
import { FollowUpAutomationService } from './followup-automation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('followup-automation')
@UseGuards(JwtAuthGuard)
export class FollowUpAutomationController {
  constructor(private readonly automation: FollowUpAutomationService) {}

  // ─── Orchestration ──────────────────────────────────────

  /** Scan leads and enroll them in follow-up sequences */
  @Post('scan')
  scanAndEnroll() {
    return this.automation.scanAndEnroll();
  }

  /** Execute all pending steps that are due */
  @Post('execute')
  executePendingSteps() {
    return this.automation.executePendingSteps();
  }

  // ─── Dashboard & Views ──────────────────────────────────

  /** Main automation dashboard */
  @Get('dashboard')
  getDashboard() {
    return this.automation.getDashboard();
  }

  /** Leads currently in automation */
  @Get('leads')
  getLeadsInAutomation(
    @Query('status') status?: string,
    @Query('trigger') trigger?: string,
    @Query('zone') zone?: string,
  ) {
    return this.automation.getLeadsInAutomation({ status, trigger, zone });
  }

  // ─── Performance ────────────────────────────────────────

  /** Sequence performance by trigger type */
  @Get('performance/sequences')
  getSequencePerformance() {
    return this.automation.getSequencePerformance();
  }

  /** Channel performance breakdown */
  @Get('performance/channels')
  getChannelPerformance() {
    return this.automation.getChannelPerformance();
  }

  /** Template performance */
  @Get('performance/templates')
  getTemplatePerformance() {
    return this.automation.getTemplatePerformance();
  }

  /** Learning insights and recommendations */
  @Get('learning')
  getLearningInsights() {
    return this.automation.getLearningInsights();
  }

  // ─── Sequence Actions ───────────────────────────────────

  /** Pause a sequence */
  @Patch(':id/pause')
  pauseSequence(@Param('id') id: string) {
    return this.automation.pauseSequence(id);
  }

  /** Resume a paused sequence */
  @Patch(':id/resume')
  resumeSequence(@Param('id') id: string) {
    return this.automation.resumeSequence(id);
  }

  /** Stop a sequence manually */
  @Patch(':id/stop')
  stopSequence(@Param('id') id: string) {
    return this.automation.stopSequence(id, 'manual');
  }

  // ─── Step Actions ───────────────────────────────────────

  /** Mark a step as opened */
  @Patch('step/:stepId/opened')
  markStepOpened(@Param('stepId') stepId: string) {
    return this.automation.markStepOpened(stepId);
  }

  /** Mark a step as replied — stops the sequence */
  @Patch('step/:stepId/replied')
  markStepReplied(@Param('stepId') stepId: string) {
    return this.automation.markStepReplied(stepId);
  }

  /** Mark a step as leading to pipeline advance */
  @Patch('step/:stepId/advanced')
  markStepAdvanced(@Param('stepId') stepId: string) {
    return this.automation.markStepAdvanced(stepId);
  }
}
