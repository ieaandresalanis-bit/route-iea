import { Module } from '@nestjs/common';
import { ClientLifecycleService } from './client-lifecycle.service';
import { ClientLifecycleController } from './client-lifecycle.controller';

@Module({
  controllers: [ClientLifecycleController],
  providers: [ClientLifecycleService],
  exports: [ClientLifecycleService],
})
export class ClientLifecycleModule {}
