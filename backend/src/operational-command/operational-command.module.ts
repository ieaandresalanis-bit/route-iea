import { Module } from '@nestjs/common';
import { OperationalCommandController } from './operational-command.controller';
import { OperationalCommandService } from './operational-command.service';

@Module({
  controllers: [OperationalCommandController],
  providers: [OperationalCommandService],
  exports: [OperationalCommandService],
})
export class OperationalCommandModule {}
