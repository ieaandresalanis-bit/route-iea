import { Module } from '@nestjs/common';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import { GoogleDirectionsService } from './google-directions.service';

@Module({
  controllers: [RoutesController],
  providers: [RoutesService, GoogleDirectionsService],
  exports: [RoutesService, GoogleDirectionsService],
})
export class RoutesModule {}
