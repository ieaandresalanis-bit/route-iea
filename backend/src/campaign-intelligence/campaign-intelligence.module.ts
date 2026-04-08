import { Module } from '@nestjs/common';
import { CampaignIntelligenceService } from './campaign-intelligence.service';
import { CampaignIntelligenceController } from './campaign-intelligence.controller';

@Module({
  controllers: [CampaignIntelligenceController],
  providers: [CampaignIntelligenceService],
  exports: [CampaignIntelligenceService],
})
export class CampaignIntelligenceModule {}
