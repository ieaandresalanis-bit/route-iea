import { Module } from '@nestjs/common';
import { CampaignAttributionService } from './campaign-attribution.service';
import { CampaignAttributionController } from './campaign-attribution.controller';

@Module({
  controllers: [CampaignAttributionController],
  providers: [CampaignAttributionService],
  exports: [CampaignAttributionService],
})
export class CampaignAttributionModule {}
