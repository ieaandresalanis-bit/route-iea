import { Controller, Get, Post, Patch, Param, Query, Body, UseGuards } from '@nestjs/common';
import { AlertIntelligenceService } from './alert-intelligence.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('alert-intelligence')
@UseGuards(JwtAuthGuard)
export class AlertIntelligenceController {
  constructor(private readonly alerts: AlertIntelligenceService) {}

  /** Generate all alert types */
  @Post('generate')
  generateAlerts() {
    return this.alerts.generateAlerts();
  }

  /** Alert center — full dashboard view */
  @Get('center')
  getAlertCenter(
    @Query('status') status?: string,
    @Query('advisorId') advisorId?: string,
    @Query('zone') zone?: string,
    @Query('type') type?: string,
    @Query('severity') severity?: string,
  ) {
    return this.alerts.getAlertCenter({ status, advisorId, zone, type, severity });
  }

  /** Advisor daily execution view */
  @Get('view/advisor/:advisorId')
  getAdvisorView(@Param('advisorId') advisorId: string) {
    return this.alerts.getAdvisorView(advisorId);
  }

  /** Supervisor team performance view */
  @Get('view/supervisor')
  getSupervisorView() {
    return this.alerts.getSupervisorView();
  }

  /** Director strategic view */
  @Get('view/director')
  getDirectorView() {
    return this.alerts.getDirectorView();
  }

  /** Zone geographic view */
  @Get('view/zone/:zone')
  getZoneView(@Param('zone') zone: string) {
    return this.alerts.getZoneView(zone);
  }

  // ─── Actions ────────────────────────────────────────────

  @Patch(':id/resolve')
  resolveAlert(
    @Param('id') id: string,
    @Body() body: { actionTaken: string; resolutionNotes?: string; resolvedBy?: string },
  ) {
    return this.alerts.resolveAlert(id, body);
  }

  @Patch(':id/acknowledge')
  acknowledgeAlert(@Param('id') id: string) {
    return this.alerts.acknowledgeAlert(id);
  }

  @Patch(':id/escalate')
  escalateAlert(@Param('id') id: string, @Body() body: { to: string }) {
    return this.alerts.escalateAlert(id, body.to);
  }

  @Patch(':id/dismiss')
  dismissAlert(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.alerts.dismissAlert(id, body.reason);
  }

  @Patch(':id/assign')
  assignAlert(@Param('id') id: string, @Body() body: { assignedToId: string }) {
    return this.alerts.assignAlert(id, body.assignedToId);
  }

  @Post(':id/trigger')
  triggerAction(@Param('id') id: string, @Body() body: { action: string }) {
    return this.alerts.triggerAction(id, body.action);
  }
}
