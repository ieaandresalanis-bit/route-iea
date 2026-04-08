import { Module } from '@nestjs/common';
import { KpiTrackingController } from './kpi-tracking.controller';
import { KpiTrackingService } from './kpi-tracking.service';

@Module({
  controllers: [KpiTrackingController],
  providers: [KpiTrackingService],
})
export class KpiTrackingModule {}
