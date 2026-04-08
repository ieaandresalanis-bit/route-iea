import { Module } from '@nestjs/common';
import { AlertIntelligenceService } from './alert-intelligence.service';
import { AlertIntelligenceController } from './alert-intelligence.controller';

@Module({
  controllers: [AlertIntelligenceController],
  providers: [AlertIntelligenceService],
  exports: [AlertIntelligenceService],
})
export class AlertIntelligenceModule {}
