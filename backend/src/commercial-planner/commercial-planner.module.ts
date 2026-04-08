import { Module } from '@nestjs/common';
import { CommercialPlannerService } from './commercial-planner.service';
import { CommercialPlannerController } from './commercial-planner.controller';

@Module({
  controllers: [CommercialPlannerController],
  providers: [CommercialPlannerService],
  exports: [CommercialPlannerService],
})
export class CommercialPlannerModule {}
