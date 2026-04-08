import { Controller, Get, UseGuards } from '@nestjs/common';
import { CommercialDirectorService } from './commercial-director.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('director')
@UseGuards(JwtAuthGuard)
export class CommercialDirectorController {
  constructor(private readonly director: CommercialDirectorService) {}

  @Get('daily')
  getDailySummary() {
    return this.director.getDailySummary();
  }

  @Get('weekly')
  getWeeklySummary() {
    return this.director.getWeeklySummary();
  }

  @Get('bottlenecks')
  getBottlenecks() {
    return this.director.detectBottlenecks();
  }

  @Get('advisors')
  getAdvisors() {
    return this.director.analyzeAdvisors();
  }

  @Get('zones')
  getZones() {
    return this.director.analyzeZones();
  }

  @Get('conversions')
  getConversions() {
    return this.director.analyzeConversions();
  }

  @Get('risks')
  getRisks() {
    return this.director.getRiskAlerts();
  }

  @Get('recommendations')
  getRecommendations() {
    return this.director.getStrategicRecommendations();
  }

  @Get('report')
  getFullReport() {
    return this.director.getFullReport();
  }
}
