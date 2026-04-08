import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { WorkPlanService } from './work-plan.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Work Plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('work-plan')
export class WorkPlanController {
  constructor(private workPlan: WorkPlanService) {}

  @Get('advisors')
  @ApiOperation({ summary: 'List advisors with assigned leads' })
  getAdvisors() {
    return this.workPlan.getAdvisors();
  }

  @Get('daily')
  @ApiOperation({ summary: 'Daily work plan for an advisor (or all)' })
  @ApiQuery({ name: 'advisorId', required: false })
  getDailyPlan(@Query('advisorId') advisorId?: string) {
    return this.workPlan.getDailyPlan(advisorId || null);
  }

  @Get('weekly')
  @ApiOperation({ summary: 'Weekly work plan for an advisor (or all)' })
  @ApiQuery({ name: 'advisorId', required: false })
  getWeeklyPlan(@Query('advisorId') advisorId?: string) {
    return this.workPlan.getWeeklyPlan(advisorId || null);
  }

  @Get('monthly')
  @ApiOperation({ summary: 'Monthly summary for an advisor (or all)' })
  @ApiQuery({ name: 'advisorId', required: false })
  getMonthlySummary(@Query('advisorId') advisorId?: string) {
    return this.workPlan.getMonthlySummary(advisorId || null);
  }
}
