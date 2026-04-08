import { Controller, Get, UseGuards } from '@nestjs/common';
import { DealsIntelligenceService } from './deals-intelligence.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('deals-intelligence')
@UseGuards(JwtAuthGuard)
export class DealsIntelligenceController {
  constructor(private readonly svc: DealsIntelligenceService) {}

  @Get()
  getAnalytics() {
    return this.svc.getAnalytics();
  }
}
