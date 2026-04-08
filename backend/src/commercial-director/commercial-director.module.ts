import { Module } from '@nestjs/common';
import { CommercialDirectorService } from './commercial-director.service';
import { CommercialDirectorController } from './commercial-director.controller';
import { PriorityEngineModule } from '../priority-engine/priority-engine.module';

@Module({
  imports: [PriorityEngineModule],
  controllers: [CommercialDirectorController],
  providers: [CommercialDirectorService],
  exports: [CommercialDirectorService],
})
export class CommercialDirectorModule {}
