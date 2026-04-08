import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DealsExplorerService } from './deals-explorer.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('deals-explorer')
@UseGuards(JwtAuthGuard)
export class DealsExplorerController {
  constructor(private readonly svc: DealsExplorerService) {}

  @Get()
  getDeals(@Query() query: any) {
    return this.svc.getDeals({
      page: query.page ? +query.page : 1,
      limit: query.limit ? +query.limit : 25,
      search: query.search,
      stage: query.stage,
      advisorId: query.advisorId,
      zone: query.zone,
      industry: query.industry,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      minAmount: query.minAmount ? +query.minAmount : undefined,
      maxAmount: query.maxAmount ? +query.maxAmount : undefined,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
  }
}
