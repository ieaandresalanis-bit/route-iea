import { Module } from '@nestjs/common';
import { ExecutionDisciplineService } from './execution-discipline.service';
import { ExecutionDisciplineController } from './execution-discipline.controller';

@Module({
  controllers: [ExecutionDisciplineController],
  providers: [ExecutionDisciplineService],
  exports: [ExecutionDisciplineService],
})
export class ExecutionDisciplineModule {}
