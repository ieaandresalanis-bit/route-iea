import { Module } from '@nestjs/common';
import { RevenueIntelligenceController } from './revenue-intelligence.controller';
import { RevenueIntelligenceService } from './revenue-intelligence.service';

@Module({
  controllers: [RevenueIntelligenceController],
  providers: [RevenueIntelligenceService],
  exports: [RevenueIntelligenceService],
})
export class RevenueIntelligenceModule {}
