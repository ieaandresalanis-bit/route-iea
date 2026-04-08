import { Module } from '@nestjs/common';
import { SelfOptimizationController } from './self-optimization.controller';
import { SelfOptimizationService } from './self-optimization.service';

@Module({
  controllers: [SelfOptimizationController],
  providers: [SelfOptimizationService],
  exports: [SelfOptimizationService],
})
export class SelfOptimizationModule {}
