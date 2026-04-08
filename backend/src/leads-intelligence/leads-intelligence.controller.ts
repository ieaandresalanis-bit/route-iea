import { Controller, Get, UseGuards } from '@nestjs/common';
import { LeadsIntelligenceService } from './leads-intelligence.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('leads-intelligence')
@UseGuards(JwtAuthGuard)
export class LeadsIntelligenceController {
  constructor(private readonly svc: LeadsIntelligenceService) {}

  @Get()
  getAnalytics() {
    return this.svc.getAnalytics();
  }
}
