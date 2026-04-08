import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { OperationalCommandService } from './operational-command.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('operational-command')
@UseGuards(JwtAuthGuard)
export class OperationalCommandController {
  constructor(private readonly oc: OperationalCommandService) {}

  /** Daily scoreboard — advisor rankings + team KPIs */
  @Get('scoreboard')
  getScoreboard() {
    return this.oc.getScoreboard();
  }

  /** Enforcement alerts — violations + rule status */
  @Get('enforcement')
  getEnforcement() {
    return this.oc.getEnforcementAlerts();
  }

  /** Adoption metrics — system usage tracking */
  @Get('adoption')
  getAdoption() {
    return this.oc.getAdoptionMetrics();
  }

  /** Team overview — operational roster */
  @Get('team')
  getTeamOverview() {
    return this.oc.getTeamOverview();
  }

  /** First week execution plan */
  @Get('first-week')
  getFirstWeekPlan() {
    return this.oc.getFirstWeekPlan();
  }

  /** Reminder log — recent enforcement reminders */
  @Get('reminders')
  getReminderLog() {
    return this.oc.getReminderLog();
  }

  /** Manually trigger enforcement reminders */
  @Post('trigger-reminders')
  triggerReminders() {
    return this.oc.sendEnforcementReminders();
  }
}
