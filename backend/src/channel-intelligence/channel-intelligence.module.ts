import { Module } from '@nestjs/common';
import { ChannelIntelligenceController } from './channel-intelligence.controller';
import { ChannelIntelligenceService } from './channel-intelligence.service';

@Module({
  controllers: [ChannelIntelligenceController],
  providers: [ChannelIntelligenceService],
  exports: [ChannelIntelligenceService],
})
export class ChannelIntelligenceModule {}
