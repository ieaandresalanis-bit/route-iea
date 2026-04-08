import { Module } from '@nestjs/common';
import { FollowUpAutomationController } from './followup-automation.controller';
import { FollowUpAutomationService } from './followup-automation.service';
import { PriorityEngineModule } from '../priority-engine/priority-engine.module';

@Module({
  imports: [PriorityEngineModule],
  controllers: [FollowUpAutomationController],
  providers: [FollowUpAutomationService],
  exports: [FollowUpAutomationService],
})
export class FollowUpAutomationModule {}
