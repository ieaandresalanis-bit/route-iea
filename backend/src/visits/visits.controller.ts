import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { VisitsService } from './visits.service';
import { CreateVisitDto, CheckInDto } from './dto/create-visit.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Visits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('visits')
export class VisitsController {
  constructor(private visitsService: VisitsService) {}

  @Post()
  @ApiOperation({ summary: 'Log a visit to a lead/client' })
  create(@Body() dto: CreateVisitDto) {
    return this.visitsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List visits with filtering' })
  @ApiQuery({ name: 'leadId', required: false })
  @ApiQuery({ name: 'visitedById', required: false })
  @ApiQuery({ name: 'outcome', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  findAll(
    @Query('leadId') leadId?: string,
    @Query('visitedById') visitedById?: string,
    @Query('outcome') outcome?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.visitsService.findAll({ leadId, visitedById, outcome, dateFrom, dateTo });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get visit details' })
  findOne(@Param('id') id: string) {
    return this.visitsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a visit' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateVisitDto>) {
    return this.visitsService.update(id, dto);
  }

  @Post(':id/check-in')
  @ApiOperation({ summary: 'GPS check-in at visit location' })
  checkIn(@Param('id') id: string, @Body() dto: CheckInDto) {
    return this.visitsService.checkIn(id, dto);
  }

  @Post(':id/check-out')
  @ApiOperation({ summary: 'GPS check-out from visit location' })
  checkOut(@Param('id') id: string, @Body() dto: CheckInDto) {
    return this.visitsService.checkOut(id, dto);
  }
}
