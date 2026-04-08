import { Module } from '@nestjs/common';
import { DealsIntelligenceController } from './deals-intelligence.controller';
import { DealsIntelligenceService } from './deals-intelligence.service';

@Module({
  controllers: [DealsIntelligenceController],
  providers: [DealsIntelligenceService],
})
export class DealsIntelligenceModule {}
