import { Module } from '@nestjs/common';
import { SupervisorAgentController } from './supervisor-agent.controller';
import { SupervisorAgentService } from './supervisor-agent.service';

@Module({
  controllers: [SupervisorAgentController],
  providers: [SupervisorAgentService],
  exports: [SupervisorAgentService],
})
export class SupervisorAgentModule {}
