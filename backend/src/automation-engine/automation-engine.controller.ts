import { Controller, Get, Post, Patch, Query, Param, Body, UseGuards } from '@nestjs/common';
import { AutomationEngineService } from './automation-engine.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('automation')
@UseGuards(JwtAuthGuard)
export class AutomationEngineController {
  constructor(private readonly automation: AutomationEngineService) {}

  // ─── Run Automations ─────────────────────────────────

  @Post('run')
  runAll() {
    return this.automation.runAllAutomations();
  }

  @Post('run/inactive')
  runInactive() {
    return this.automation.runInactiveLeadAutomation();
  }

  @Post('run/deal-push')
  runDealPush() {
    return this.automation.runDealPushAutomation();
  }

  @Post('run/reactivation')
  runReactivation() {
    return this.automation.runReactivationSystem();
  }

  @Post('run/tasks')
  runTasks() {
    return this.automation.runDailyAutoTasks();
  }

  @Post('run/alerts')
  runAlerts() {
    return this.automation.runAlertSystem();
  }

  // ─── Alerts ──────────────────────────────────────────

  @Get('alerts')
  getAlerts(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('severity') severity?: string,
    @Query('advisorId') advisorId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.automation.getAlerts({
      status,
      type,
      severity,
      advisorId,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('alerts/stats')
  getAlertStats() {
    return this.automation.getAlertStats();
  }

  @Patch('alerts/:id')
  updateAlert(
    @Param('id') id: string,
    @Body() body: { status: string; resolvedBy?: string },
  ) {
    return this.automation.updateAlertStatus(id, body.status, body.resolvedBy);
  }

  // ─── Tasks ───────────────────────────────────────────

  @Get('tasks')
  getTasks(
    @Query('advisorId') advisorId?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('date') date?: string,
    @Query('limit') limit?: string,
  ) {
    return this.automation.getTasks({
      advisorId,
      status,
      type,
      date,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('tasks/stats')
  getTaskStats() {
    return this.automation.getTaskStats();
  }

  @Patch('tasks/:id')
  updateTask(
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.automation.updateTaskStatus(id, body.status);
  }
}
