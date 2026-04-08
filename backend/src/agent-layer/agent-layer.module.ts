import { Module } from '@nestjs/common';
import { AgentLayerController } from './agent-layer.controller';
import { AgentLayerService } from './agent-layer.service';

@Module({
  controllers: [AgentLayerController],
  providers: [AgentLayerService],
})
export class AgentLayerModule {}
