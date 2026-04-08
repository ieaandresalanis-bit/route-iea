import { Module } from '@nestjs/common';
import { AiAgentsController } from './ai-agents.controller';
import { AiAgentsService } from './ai-agents.service';
import { CommercialDirectorModule } from '../commercial-director/commercial-director.module';
import { PriorityEngineModule } from '../priority-engine/priority-engine.module';
import { SalesCoachModule } from '../sales-coach/sales-coach.module';
import { AlertIntelligenceModule } from '../alert-intelligence/alert-intelligence.module';
import { ExecutionEngineModule } from '../execution-engine/execution-engine.module';
import { FollowUpAutomationModule } from '../followup-automation/followup-automation.module';
import { AutomationPerformanceModule } from '../automation-performance/automation-performance.module';
import { ClientLifecycleModule } from '../client-lifecycle/client-lifecycle.module';

@Module({
  imports: [
    CommercialDirectorModule,
    PriorityEngineModule,
    SalesCoachModule,
    AlertIntelligenceModule,
    ExecutionEngineModule,
    FollowUpAutomationModule,
    AutomationPerformanceModule,
    ClientLifecycleModule,
  ],
  controllers: [AiAgentsController],
  providers: [AiAgentsService],
  exports: [AiAgentsService],
})
export class AiAgentsModule {}
