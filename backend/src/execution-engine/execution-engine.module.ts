import { Module } from '@nestjs/common';
import { ExecutionEngineController } from './execution-engine.controller';
import { ExecutionEngineService } from './execution-engine.service';
import { PriorityEngineModule } from '../priority-engine/priority-engine.module';

@Module({
  imports: [PriorityEngineModule],
  controllers: [ExecutionEngineController],
  providers: [ExecutionEngineService],
  exports: [ExecutionEngineService],
})
export class ExecutionEngineModule {}
