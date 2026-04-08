import { Module } from '@nestjs/common';
import { MultiChannelService } from './multi-channel.service';
import { MultiChannelController } from './multi-channel.controller';

@Module({
  controllers: [MultiChannelController],
  providers: [MultiChannelService],
  exports: [MultiChannelService],
})
export class MultiChannelModule {}
