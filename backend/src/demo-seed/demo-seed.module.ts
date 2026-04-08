import { Module } from '@nestjs/common';
import { DemoSeedService } from './demo-seed.service';
import { DemoSeedController } from './demo-seed.controller';

@Module({
  controllers: [DemoSeedController],
  providers: [DemoSeedService],
})
export class DemoSeedModule {}
