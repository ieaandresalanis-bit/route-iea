import { Module } from '@nestjs/common';
import { AgentCommandController } from './agent-command.controller';
import { AgentCommandService } from './agent-command.service';

@Module({
  controllers: [AgentCommandController],
  providers: [AgentCommandService],
})
export class AgentCommandModule {}
