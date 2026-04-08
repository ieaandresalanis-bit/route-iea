import { Module } from '@nestjs/common';
import { GpsService } from './gps.service';
import { GpsController } from './gps.controller';
import { GpsGateway } from './gps.gateway';

@Module({
  controllers: [GpsController],
  providers: [GpsService, GpsGateway],
  exports: [GpsService, GpsGateway],
})
export class GpsModule {}
