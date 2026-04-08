import { Module } from '@nestjs/common';
import { OdometerService } from './odometer.service';
import { OdometerController } from './odometer.controller';

@Module({
  controllers: [OdometerController],
  providers: [OdometerService],
  exports: [OdometerService],
})
export class OdometerModule {}
