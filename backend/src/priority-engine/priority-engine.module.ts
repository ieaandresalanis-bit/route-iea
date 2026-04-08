import { Module } from '@nestjs/common';
import { PriorityEngineService } from './priority-engine.service';

@Module({
  providers: [PriorityEngineService],
  exports: [PriorityEngineService],
})
export class PriorityEngineModule {}
