import { Module } from '@nestjs/common';
import { FollowUpIntelligenceService } from './follow-up-intelligence.service';
import { FollowUpIntelligenceController } from './follow-up-intelligence.controller';

@Module({
  controllers: [FollowUpIntelligenceController],
  providers: [FollowUpIntelligenceService],
  exports: [FollowUpIntelligenceService],
})
export class FollowUpIntelligenceModule {}
