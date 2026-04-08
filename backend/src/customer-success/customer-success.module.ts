import { Module } from '@nestjs/common';
import { CustomerSuccessController } from './customer-success.controller';
import { CustomerSuccessService } from './customer-success.service';

import { ClientLifecycleModule } from '../client-lifecycle/client-lifecycle.module';
import { MultiChannelModule } from '../multi-channel/multi-channel.module';
import { AlertIntelligenceModule } from '../alert-intelligence/alert-intelligence.module';
import { ExecutionEngineModule } from '../execution-engine/execution-engine.module';

@Module({
  imports: [
    ClientLifecycleModule,
    MultiChannelModule,
    AlertIntelligenceModule,
    ExecutionEngineModule,
  ],
  controllers: [CustomerSuccessController],
  providers: [CustomerSuccessService],
  exports: [CustomerSuccessService],
})
export class CustomerSuccessModule {}
