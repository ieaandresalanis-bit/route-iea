import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { LeadsExplorerService } from './leads-explorer.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('leads-explorer')
@UseGuards(JwtAuthGuard)
export class LeadsExplorerController {
  constructor(private readonly svc: LeadsExplorerService) {}

  @Get()
  getLeads(@Query() query: any) {
    return this.svc.getLeads({
      page: query.page ? +query.page : 1,
      limit: query.limit ? +query.limit : 25,
      search: query.search,
      zone: query.zone,
      industry: query.industry,
      advisorId: query.advisorId,
      status: query.status,
      source: query.source,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      minValue: query.minValue ? +query.minValue : undefined,
      maxValue: query.maxValue ? +query.maxValue : undefined,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
  }
}
