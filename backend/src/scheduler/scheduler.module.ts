import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { AutomationEngineModule } from '../automation-engine/automation-engine.module';
import { AlertIntelligenceModule } from '../alert-intelligence/alert-intelligence.module';
import { ExecutionEngineModule } from '../execution-engine/execution-engine.module';
import { FollowUpAutomationModule } from '../followup-automation/followup-automation.module';

@Module({
  imports: [
    AutomationEngineModule,
    AlertIntelligenceModule,
    ExecutionEngineModule,
    FollowUpAutomationModule,
  ],
  providers: [SchedulerService],
})
export class SchedulerModule {}
