import { Controller, Get, Post, Patch, Delete, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ClientLifecycleService } from './client-lifecycle.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('client-lifecycle')
@UseGuards(JwtAuthGuard)
export class ClientLifecycleController {
  constructor(private readonly cls: ClientLifecycleService) {}

  // ─── Client Profiles ─────────────────────────────────────

  /** Auto-create client profiles from CERRADO_GANADO leads */
  @Post('sync')
  syncClientsFromWonLeads() {
    return this.cls.syncClientsFromWonLeads();
  }

  /** List all clients with filters */
  @Get('clients')
  getClients(
    @Query('stage') stage?: string,
    @Query('zone') zone?: string,
    @Query('advisorId') advisorId?: string,
    @Query('systemStatus') systemStatus?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('order') order?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.cls.getClients({
      stage, zone, advisorId, systemStatus, search,
      sortBy, order: order as 'asc' | 'desc',
      page: page ? +page : undefined,
      limit: limit ? +limit : undefined,
    });
  }

  /** Single client detail */
  @Get('clients/:id')
  getClient(@Param('id') id: string) {
    return this.cls.getClient(id);
  }

  /** Update client profile */
  @Patch('clients/:id')
  updateClient(@Param('id') id: string, @Body() body: any) {
    return this.cls.updateClient(id, body);
  }

  // ─── Post-Sale Sequences ─────────────────────────────────

  /** Generate post-sale follow-up steps for a client */
  @Post('clients/:id/generate-sequence')
  generateSequence(@Param('id') id: string) {
    return this.cls.generatePostSaleSequence(id);
  }

  /** List steps for a client */
  @Get('clients/:id/steps')
  getClientSteps(@Param('id') id: string) {
    return this.cls.getClientSteps(id);
  }

  /** Update a step (mark sent, outcome, etc.) */
  @Patch('steps/:id')
  updateStep(@Param('id') id: string, @Body() body: any) {
    return this.cls.updateStep(id, body);
  }

  /** Execute a pending step (mark as sent) */
  @Post('steps/:id/execute')
  executeStep(@Param('id') id: string) {
    return this.cls.executeStep(id);
  }

  // ─── Referrals ───────────────────────────────────────────

  /** Create a referral request for a client */
  @Post('clients/:id/referrals')
  createReferral(@Param('id') id: string, @Body() body: any) {
    return this.cls.createReferral(id, body);
  }

  /** List all referrals */
  @Get('referrals')
  getReferrals(@Query('status') status?: string) {
    return this.cls.getReferrals(status);
  }

  /** Update referral (convert, mark received, etc.) */
  @Patch('referrals/:id')
  updateReferral(@Param('id') id: string, @Body() body: any) {
    return this.cls.updateReferral(id, body);
  }

  /** Convert referral to lead */
  @Post('referrals/:id/convert')
  convertReferral(@Param('id') id: string) {
    return this.cls.convertReferralToLead(id);
  }

  // ─── Client Alerts ───────────────────────────────────────

  /** Generate all client alerts (churn, upsell, referral, etc.) */
  @Post('alerts/generate')
  generateAlerts() {
    return this.cls.generateClientAlerts();
  }

  /** List client alerts */
  @Get('alerts')
  getAlerts(
    @Query('type') type?: string,
    @Query('severity') severity?: string,
    @Query('status') status?: string,
  ) {
    return this.cls.getClientAlerts({ type, severity, status });
  }

  /** Resolve a client alert */
  @Patch('alerts/:id/resolve')
  resolveAlert(@Param('id') id: string, @Body() body: { actionTaken: string }) {
    return this.cls.resolveClientAlert(id, body.actionTaken);
  }

  /** Dismiss a client alert */
  @Patch('alerts/:id/dismiss')
  dismissAlert(@Param('id') id: string) {
    return this.cls.dismissClientAlert(id);
  }

  // ─── Lifecycle Transitions ───────────────────────────────

  /** Transition client lifecycle stage */
  @Patch('clients/:id/lifecycle')
  transitionLifecycle(
    @Param('id') id: string,
    @Body() body: { stage: string; reason?: string },
  ) {
    return this.cls.transitionLifecycleStage(id, body.stage, body.reason);
  }

  // ─── Expansion & Upsell ──────────────────────────────────

  /** Recalculate expansion scores for all clients */
  @Post('expansion/score')
  recalculateExpansion() {
    return this.cls.recalculateExpansionScores();
  }

  /** Get expansion opportunities */
  @Get('expansion/opportunities')
  getExpansionOpportunities() {
    return this.cls.getExpansionOpportunities();
  }

  // ─── Reactivation ────────────────────────────────────────

  /** Get inactive clients + lost deals eligible for reactivation */
  @Get('reactivation/candidates')
  getReactivationCandidates() {
    return this.cls.getReactivationCandidates();
  }

  /** Trigger reactivation sequence for a client */
  @Post('clients/:id/reactivate')
  reactivateClient(@Param('id') id: string) {
    return this.cls.reactivateClient(id);
  }

  // ─── Dashboard & Analytics ───────────────────────────────

  /** Full lifecycle dashboard data */
  @Get('dashboard')
  getDashboard() {
    return this.cls.getLifecycleDashboard();
  }

  /** Revenue expansion metrics */
  @Get('metrics/revenue')
  getRevenueMetrics() {
    return this.cls.getRevenueExpansionMetrics();
  }

  /** Strategic insights for AI agent */
  @Get('insights')
  getStrategicInsights() {
    return this.cls.getStrategicInsights();
  }

  /** Churn risk analysis */
  @Get('metrics/churn')
  getChurnAnalysis() {
    return this.cls.getChurnAnalysis();
  }

  /** Referral ROI analysis */
  @Get('metrics/referral-roi')
  getReferralROI() {
    return this.cls.getReferralROI();
  }
}
