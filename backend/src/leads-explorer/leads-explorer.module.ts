import { Module } from '@nestjs/common';
import { LeadsExplorerController } from './leads-explorer.controller';
import { LeadsExplorerService } from './leads-explorer.service';

@Module({
  controllers: [LeadsExplorerController],
  providers: [LeadsExplorerService],
})
export class LeadsExplorerModule {}
