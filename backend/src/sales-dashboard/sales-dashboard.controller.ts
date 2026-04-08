import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SalesDashboardService } from './sales-dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Sales Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sales')
export class SalesDashboardController {
  constructor(private salesDashboard: SalesDashboardService) {}

  @Get('kpis')
  @ApiOperation({ summary: 'Commercial KPIs: conversion rate, pipeline, avg deal' })
  getKpis() {
    return this.salesDashboard.getKpis();
  }

  @Get('by-zone')
  @ApiOperation({ summary: 'Lead count and pipeline value by zone' })
  getByZone() {
    return this.salesDashboard.getByZone();
  }

  @Get('by-status')
  @ApiOperation({ summary: 'Lead funnel: count per status stage' })
  getByStatus() {
    return this.salesDashboard.getByStatus();
  }

  @Get('advisors')
  @ApiOperation({ summary: 'Advisor performance metrics' })
  getAdvisors() {
    return this.salesDashboard.getAdvisors();
  }

  @Get('pipeline-view')
  @ApiOperation({ summary: 'Pipeline stages with counts and values' })
  getPipelineView() {
    return this.salesDashboard.getPipelineView();
  }

  @Get('trends')
  @ApiOperation({ summary: 'Leads created and converted per week (12 weeks)' })
  getTrends() {
    return this.salesDashboard.getTrends();
  }
}
