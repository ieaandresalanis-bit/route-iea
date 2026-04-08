import { Controller, Get, Post, Patch, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ExecutionEngineService } from './execution-engine.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('execution-engine')
@UseGuards(JwtAuthGuard)
export class ExecutionEngineController {
  constructor(private readonly engine: ExecutionEngineService) {}

  // ─── Generation ─────────────────────────────────────────

  /** Generate tasks from alerts, priority engine, stalled deals, etc. */
  @Post('generate')
  generateTasks() {
    return this.engine.generateTasks();
  }

  // ─── Views ──────────────────────────────────────────────

  /** Advisor daily execution view */
  @Get('advisor/:advisorId/daily')
  getAdvisorDaily(
    @Param('advisorId') advisorId: string,
    @Query('date') date?: string,
  ) {
    return this.engine.getAdvisorDailyView(advisorId, date);
  }

  /** Director daily execution view */
  @Get('director/daily')
  getDirectorDaily() {
    return this.engine.getDirectorDailyView();
  }

  /** Supervisor control panel */
  @Get('supervisor')
  getSupervisorControl() {
    return this.engine.getSupervisorControl();
  }

  /** Execution stats */
  @Get('stats')
  getExecutionStats(@Query('days') days?: string) {
    return this.engine.getExecutionStats(days ? parseInt(days, 10) : 7);
  }

  // ─── Task Actions ───────────────────────────────────────

  /** Start working on a task */
  @Patch(':id/start')
  startTask(@Param('id') id: string) {
    return this.engine.startTask(id);
  }

  /** Complete a task */
  @Patch(':id/complete')
  completeTask(
    @Param('id') id: string,
    @Body() body: { outcome: string; outcomeNotes?: string; pipelineMoved?: boolean; newStage?: string },
  ) {
    return this.engine.completeTask(id, body);
  }

  /** Skip a task */
  @Patch(':id/skip')
  skipTask(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.engine.skipTask(id, body.reason);
  }

  /** Reassign a task to another advisor */
  @Patch(':id/reassign')
  reassignTask(
    @Param('id') id: string,
    @Body() body: { newAdvisorId: string; reassignedBy: string; reason?: string },
  ) {
    return this.engine.reassignTask(id, body.newAdvisorId, body.reassignedBy, body.reason);
  }

  /** Escalate a task */
  @Patch(':id/escalate')
  escalateTask(@Param('id') id: string) {
    return this.engine.escalateTask(id);
  }

  /** Create a manual task */
  @Post('manual')
  createManualTask(
    @Body() body: {
      advisorId: string;
      leadId?: string;
      type: string;
      title: string;
      description?: string;
      suggestion?: string;
      channel?: string;
      priority?: string;
      dueDate?: string;
    },
  ) {
    return this.engine.createManualTask(body);
  }
}
