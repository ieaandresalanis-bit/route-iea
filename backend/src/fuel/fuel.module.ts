import { Module } from '@nestjs/common';
import { FuelService } from './fuel.service';
import { FuelController } from './fuel.controller';
import { FuelOcrService } from './fuel-ocr.service';
import { FuelIntelligenceService } from './fuel-intelligence.service';

@Module({
  controllers: [FuelController],
  providers: [FuelService, FuelOcrService, FuelIntelligenceService],
  exports: [FuelService, FuelIntelligenceService],
})
export class FuelModule {}
