import { Module } from '@nestjs/common';
import { WorkPlanController } from './work-plan.controller';
import { WorkPlanService } from './work-plan.service';
import { PriorityEngineModule } from '../priority-engine/priority-engine.module';

@Module({
  imports: [PriorityEngineModule],
  controllers: [WorkPlanController],
  providers: [WorkPlanService],
  exports: [WorkPlanService],
})
export class WorkPlanModule {}
