import { Module } from '@nestjs/common';
import { LiveChatController } from './live-chat.controller';
import { LiveChatService } from './live-chat.service';

@Module({
  controllers: [LiveChatController],
  providers: [LiveChatService],
  exports: [LiveChatService],
})
export class LiveChatModule {}
