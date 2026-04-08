import { Module } from '@nestjs/common';
import { ExecutionOrchestrationController } from './execution-orchestration.controller';
import { ExecutionOrchestrationService } from './execution-orchestration.service';

// All orchestrated modules
import { ExecutionEngineModule } from '../execution-engine/execution-engine.module';
import { PriorityEngineModule } from '../priority-engine/priority-engine.module';
import { AlertIntelligenceModule } from '../alert-intelligence/alert-intelligence.module';
import { FollowUpAutomationModule } from '../followup-automation/followup-automation.module';
import { FollowUpIntelligenceModule } from '../follow-up-intelligence/follow-up-intelligence.module';
import { SupervisorAgentModule } from '../supervisor-agent/supervisor-agent.module';
import { ExecutionDisciplineModule } from '../execution-discipline/execution-discipline.module';
import { TeamManagementModule } from '../team-management/team-management.module';
import { MultiChannelModule } from '../multi-channel/multi-channel.module';
import { AutomationEngineModule } from '../automation-engine/automation-engine.module';
import { CommercialDirectorModule } from '../commercial-director/commercial-director.module';

@Module({
  imports: [
    ExecutionEngineModule,
    PriorityEngineModule,
    AlertIntelligenceModule,
    FollowUpAutomationModule,
    FollowUpIntelligenceModule,
    SupervisorAgentModule,
    ExecutionDisciplineModule,
    TeamManagementModule,
    MultiChannelModule,
    AutomationEngineModule,
    CommercialDirectorModule,
  ],
  controllers: [ExecutionOrchestrationController],
  providers: [ExecutionOrchestrationService],
  exports: [ExecutionOrchestrationService],
})
export class ExecutionOrchestrationModule {}
