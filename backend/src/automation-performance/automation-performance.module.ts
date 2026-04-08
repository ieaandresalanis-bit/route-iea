import { Module } from '@nestjs/common';
import { AutomationPerformanceController } from './automation-performance.controller';
import { AutomationPerformanceService } from './automation-performance.service';

@Module({
  controllers: [AutomationPerformanceController],
  providers: [AutomationPerformanceService],
  exports: [AutomationPerformanceService],
})
export class AutomationPerformanceModule {}
