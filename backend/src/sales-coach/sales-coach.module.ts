import { Module } from '@nestjs/common';
import { SalesCoachService } from './sales-coach.service';
import { SalesCoachController } from './sales-coach.controller';
import { PriorityEngineModule } from '../priority-engine/priority-engine.module';

@Module({
  imports: [PriorityEngineModule],
  controllers: [SalesCoachController],
  providers: [SalesCoachService],
  exports: [SalesCoachService],
})
export class SalesCoachModule {}
