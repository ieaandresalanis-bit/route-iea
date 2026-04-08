import { Module } from '@nestjs/common';
import { AutomationEngineService } from './automation-engine.service';
import { AutomationEngineController } from './automation-engine.controller';
import { PriorityEngineModule } from '../priority-engine/priority-engine.module';

@Module({
  imports: [PriorityEngineModule],
  controllers: [AutomationEngineController],
  providers: [AutomationEngineService],
  exports: [AutomationEngineService],
})
export class AutomationEngineModule {}
