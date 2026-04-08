import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, HttpCode } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { LeadQueryDto } from './dto/lead-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('leads')
export class LeadsController {
  constructor(private leadsService: LeadsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new lead' })
  create(@Body() dto: CreateLeadDto) {
    return this.leadsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List leads with filtering' })
  findAll(@Query() query: LeadQueryDto) {
    return this.leadsService.findAll(query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get lead counts by zone and status' })
  getStats() {
    return this.leadsService.getStats();
  }

  @Get('map')
  @ApiOperation({ summary: 'Get lightweight lead data for map markers' })
  getMapData() {
    return this.leadsService.getMapData();
  }

  @Get('commercial-map')
  @ApiOperation({ summary: 'Get enriched data for commercial decision map' })
  getCommercialMapData() {
    return this.leadsService.getCommercialMapData();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get lead details with visit history' })
  findOne(@Param('id') id: string) {
    return this.leadsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a lead' })
  update(@Param('id') id: string, @Body() dto: UpdateLeadDto) {
    return this.leadsService.update(id, dto);
  }

  @Patch(':id/convert')
  @ApiOperation({ summary: 'Convert lead to client' })
  convert(@Param('id') id: string) {
    return this.leadsService.convert(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete a lead' })
  remove(@Param('id') id: string) {
    return this.leadsService.softDelete(id);
  }
}
