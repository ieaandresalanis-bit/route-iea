import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { KpiTrackingService } from './kpi-tracking.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('kpi-tracking')
@UseGuards(JwtAuthGuard)
export class KpiTrackingController {
  constructor(private readonly svc: KpiTrackingService) {}

  @Get()
  getDashboard() {
    return this.svc.getDashboard();
  }

  @Get('advisor/:id')
  getAdvisor(@Param('id') id: string) {
    return this.svc.getAdvisorKpi(id);
  }
}
