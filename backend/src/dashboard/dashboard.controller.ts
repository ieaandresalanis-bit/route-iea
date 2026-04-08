import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Fleet dashboard overview with KPIs' })
  getOverview() {
    return this.dashboardService.getOverview();
  }

  @Get('activity')
  @ApiOperation({ summary: 'Recent activity feed' })
  getRecentActivity(@Query('limit') limit?: number) {
    return this.dashboardService.getRecentActivity(limit ? Number(limit) : 20);
  }
}
