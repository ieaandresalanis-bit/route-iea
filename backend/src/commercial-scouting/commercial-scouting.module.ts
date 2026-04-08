import { Module } from '@nestjs/common';
import { CommercialScoutingController } from './commercial-scouting.controller';
import { CommercialScoutingService } from './commercial-scouting.service';

@Module({
  controllers: [CommercialScoutingController],
  providers: [CommercialScoutingService],
  exports: [CommercialScoutingService],
})
export class CommercialScoutingModule {}
