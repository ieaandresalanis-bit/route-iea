import { Module } from '@nestjs/common';
import { DealClosingController } from './deal-closing.controller';
import { DealClosingService } from './deal-closing.service';

@Module({
  controllers: [DealClosingController],
  providers: [DealClosingService],
  exports: [DealClosingService],
})
export class DealClosingModule {}
