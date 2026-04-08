import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SalesOpsService } from './sales-ops.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Sales Operations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sales-ops')
export class SalesOpsController {
  constructor(private salesOps: SalesOpsService) {}

  @Get('follow-ups')
  @ApiOperation({ summary: 'Leads with pending follow-ups' })
  getFollowUps() {
    return this.salesOps.getFollowUps();
  }

  @Get('inactive')
  @ApiOperation({ summary: 'Leads with no contact in 14+ days' })
  getInactive() {
    return this.salesOps.getInactive();
  }

  @Get('priority')
  @ApiOperation({ summary: 'Top priority-scored leads (Priority Engine)' })
  getPriority() {
    return this.salesOps.getPriority();
  }

  @Get('deals-to-push')
  @ApiOperation({ summary: 'Top deals to push forward' })
  getDealsToPush() {
    return this.salesOps.getDealsToPush();
  }

  @Get('advisor-priorities')
  @ApiOperation({ summary: 'Priority lists grouped by advisor' })
  getAdvisorPriorities() {
    return this.salesOps.getAdvisorPriorities();
  }

  @Get('daily-summary')
  @ApiOperation({ summary: 'Daily operations summary counts' })
  getDailySummary() {
    return this.salesOps.getDailySummary();
  }
}
