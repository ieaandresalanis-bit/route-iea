import { Module } from '@nestjs/common';
import { DealsExplorerController } from './deals-explorer.controller';
import { DealsExplorerService } from './deals-explorer.service';

@Module({
  controllers: [DealsExplorerController],
  providers: [DealsExplorerService],
})
export class DealsExplorerModule {}
