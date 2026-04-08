import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AdminDashboardService } from './admin-dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Admin Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin-dashboard')
export class AdminDashboardController {
  constructor(private readonly svc: AdminDashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Full commercial intelligence dashboard for director/super admin' })
  getDashboard() {
    return this.svc.getDashboard();
  }
}
