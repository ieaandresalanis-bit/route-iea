import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AutomationEngineService } from '../automation-engine/automation-engine.service';
import { AlertIntelligenceService } from '../alert-intelligence/alert-intelligence.service';
import { ExecutionEngineService } from '../execution-engine/execution-engine.service';
import { FollowUpAutomationService } from '../followup-automation/followup-automation.service';

/**
 * Central scheduler that activates all automation on real cron schedules.
 * This is the "heartbeat" of the commercial intelligence system.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly automationEngine: AutomationEngineService,
    private readonly alertIntelligence: AlertIntelligenceService,
    private readonly executionEngine: ExecutionEngineService,
    private readonly followUpAutomation: FollowUpAutomationService,
  ) {
    this.logger.log('Scheduler activated — commercial automation is LIVE');
  }

  // ── EVERY DAY AT 7:00 AM: Alert Intelligence ──────────
  @Cron('0 7 * * 1-6') // Mon-Sat at 7 AM
  async morningAlerts() {
    this.logger.log('[CRON] 7:00 AM — Generating alert intelligence...');
    try {
      const result = await this.alertIntelligence.generateAlerts();
      this.logger.log(`[CRON] Alerts generated: ${result.created} new alerts`);
    } catch (err: any) {
      this.logger.error(`[CRON] Alert generation failed: ${err.message}`);
    }
  }

  // ── EVERY DAY AT 8:00 AM: Follow-up scan + enroll ─────
  @Cron('0 8 * * 1-6') // Mon-Sat at 8 AM
  async morningFollowUpScan() {
    this.logger.log('[CRON] 8:00 AM — Scanning leads for follow-up enrollment...');
    try {
      const result = await this.followUpAutomation.scanAndEnroll();
      this.logger.log(`[CRON] Follow-up scan: ${result.totalEnrolled} enrolled, ${result.skippedAlreadyActive + result.skippedTerminal} skipped`);
    } catch (err: any) {
      this.logger.error(`[CRON] Follow-up scan failed: ${err.message}`);
    }
  }

  // ── EVERY DAY AT 9:00 AM: Full automation run ──────────
  @Cron('0 9 * * 1-6') // Mon-Sat at 9 AM
  async morningAutomation() {
    this.logger.log('[CRON] 9:00 AM — Running full automation cycle...');
    try {
      const result = await this.automationEngine.runAllAutomations();
      this.logger.log(`[CRON] Automation complete: ${JSON.stringify(result)}`.slice(0, 200));
    } catch (err: any) {
      this.logger.error(`[CRON] Automation failed: ${err.message}`);
    }
  }

  // ── EVERY DAY AT 9:15 AM: Task generation ──────────────
  @Cron('15 9 * * 1-6') // Mon-Sat at 9:15 AM
  async morningTasks() {
    this.logger.log('[CRON] 9:15 AM — Generating execution tasks...');
    try {
      const result = await this.executionEngine.generateTasks();
      this.logger.log(`[CRON] Tasks generated: ${result.totalCreated} new tasks`);
    } catch (err: any) {
      this.logger.error(`[CRON] Task generation failed: ${err.message}`);
    }
  }

  // ── EVERY 30 MIN: Execute pending follow-up steps ──────
  @Cron('*/30 * * * 1-6') // Every 30 min Mon-Sat
  async executeFollowUps() {
    this.logger.log('[CRON] Executing pending follow-up steps...');
    try {
      const result = await this.followUpAutomation.executePendingSteps();
      if (result.executed > 0) {
        this.logger.log(`[CRON] Follow-ups: ${result.executed} executed, ${result.failed} failed, ${result.skipped} skipped`);
      }
    } catch (err: any) {
      this.logger.error(`[CRON] Follow-up execution failed: ${err.message}`);
    }
  }

  // ── EVERY DAY AT 2:00 PM: Afternoon alert refresh ─────
  @Cron('0 14 * * 1-6') // Mon-Sat at 2 PM
  async afternoonAlerts() {
    this.logger.log('[CRON] 2:00 PM — Refreshing afternoon alerts...');
    try {
      const result = await this.alertIntelligence.generateAlerts();
      this.logger.log(`[CRON] Afternoon alerts: ${result.created} new`);
    } catch (err: any) {
      this.logger.error(`[CRON] Afternoon alert refresh failed: ${err.message}`);
    }
  }

  // ── EVERY DAY AT 6:00 PM: End-of-day summary ──────────
  @Cron('0 18 * * 1-5') // Mon-Fri at 6 PM
  async endOfDayRefresh() {
    this.logger.log('[CRON] 6:00 PM — End-of-day automation refresh...');
    try {
      await this.automationEngine.runAlertSystem();
      this.logger.log('[CRON] End-of-day alerts complete');
    } catch (err: any) {
      this.logger.error(`[CRON] EOD refresh failed: ${err.message}`);
    }
  }
}
