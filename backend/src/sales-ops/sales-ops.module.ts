import { Module } from '@nestjs/common';
import { SalesOpsController } from './sales-ops.controller';
import { SalesOpsService } from './sales-ops.service';
import { PriorityEngineModule } from '../priority-engine/priority-engine.module';

@Module({
  imports: [PriorityEngineModule],
  controllers: [SalesOpsController],
  providers: [SalesOpsService],
  exports: [SalesOpsService],
})
export class SalesOpsModule {}
