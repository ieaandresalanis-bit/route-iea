import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ExecutionDisciplineService } from './execution-discipline.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('execution-discipline')
@UseGuards(JwtAuthGuard)
export class ExecutionDisciplineController {
  private readonly logger = new Logger(ExecutionDisciplineController.name);

  constructor(private readonly discipline: ExecutionDisciplineService) {}

  /** Individual discipline score for a specific advisor */
  @Get('score/:advisorId')
  getScore(
    @Param('advisorId') advisorId: string,
    @Query('days') days?: string,
  ) {
    const numDays = days ? parseInt(days, 10) : 7;
    return this.discipline.getDisciplineScore(advisorId, numDays);
  }

  /** Full team discipline report */
  @Get('team')
  getTeamReport(@Query('days') days?: string) {
    const numDays = days ? parseInt(days, 10) : 7;
    return this.discipline.getTeamDisciplineReport(numDays);
  }

  /** Latest generated reminders for all executors */
  @Get('reminders')
  getReminders() {
    return this.discipline.latestReminders;
  }

  /** Specific executor's reminder (computed on demand) */
  @Get('reminders/:advisorId')
  getExecutorReminder(@Param('advisorId') advisorId: string) {
    return this.discipline.getExecutorReminder(advisorId);
  }

  /** Latest detected performance issues */
  @Get('performance-issues')
  getPerformanceIssues() {
    return this.discipline.latestIssues;
  }

  /** Manually trigger reminder generation */
  @Post('trigger-reminders')
  async triggerReminders() {
    this.logger.log('Manual trigger: generating reminders');
    const reminders = await this.discipline.generateReminders();
    this.discipline.latestReminders = reminders;
    return {
      triggered: true,
      count: reminders.length,
      reminders,
    };
  }

  /** Manually trigger performance check */
  @Post('trigger-performance-check')
  async triggerPerformanceCheck() {
    this.logger.log('Manual trigger: running performance check');
    const issues = await this.discipline.detectPerformanceIssues();
    this.discipline.latestIssues = issues;
    return {
      triggered: true,
      count: issues.length,
      issues,
    };
  }
}
