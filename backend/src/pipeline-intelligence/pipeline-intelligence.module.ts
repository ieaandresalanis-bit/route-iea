import { Module } from '@nestjs/common';
import { PipelineIntelligenceController } from './pipeline-intelligence.controller';
import { PipelineIntelligenceService } from './pipeline-intelligence.service';

@Module({
  controllers: [PipelineIntelligenceController],
  providers: [PipelineIntelligenceService],
  exports: [PipelineIntelligenceService],
})
export class PipelineIntelligenceModule {}
