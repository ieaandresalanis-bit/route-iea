import { Module } from '@nestjs/common';
import { LeadsIntelligenceController } from './leads-intelligence.controller';
import { LeadsIntelligenceService } from './leads-intelligence.service';

@Module({
  controllers: [LeadsIntelligenceController],
  providers: [LeadsIntelligenceService],
})
export class LeadsIntelligenceModule {}
