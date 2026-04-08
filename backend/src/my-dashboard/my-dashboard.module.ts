import { Module } from '@nestjs/common';
import { MyDashboardController } from './my-dashboard.controller';
import { MyDashboardService } from './my-dashboard.service';

@Module({
  controllers: [MyDashboardController],
  providers: [MyDashboardService],
  exports: [MyDashboardService],
})
export class MyDashboardModule {}
