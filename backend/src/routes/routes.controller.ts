import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { RouteStatus } from '@prisma/client';
import { RoutesService } from './routes.service';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Routes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('routes')
export class RoutesController {
  constructor(private routesService: RoutesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new visit route' })
  create(@Body() dto: CreateRouteDto) {
    return this.routesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List visit routes' })
  @ApiQuery({ name: 'status', required: false, enum: RouteStatus })
  findAll(@Query('status') status?: RouteStatus) {
    return this.routesService.findAll(status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get route details with stops' })
  findOne(@Param('id') id: string) {
    return this.routesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a route' })
  update(@Param('id') id: string, @Body() dto: UpdateRouteDto) {
    return this.routesService.update(id, dto);
  }

  @Post(':id/optimize')
  @ApiOperation({ summary: 'Optimize route using Google Directions API' })
  optimize(@Param('id') id: string) {
    return this.routesService.optimize(id);
  }

  @Post(':id/stops')
  @ApiOperation({ summary: 'Add a stop to a route' })
  addStop(
    @Param('id') id: string,
    @Body('leadId') leadId: string,
    @Body('order') order: number,
  ) {
    return this.routesService.addStop(id, leadId, order);
  }

  @Delete(':id/stops/:stopId')
  @ApiOperation({ summary: 'Remove a stop from a route' })
  removeStop(@Param('id') id: string, @Param('stopId') stopId: string) {
    return this.routesService.removeStop(id, stopId);
  }
}
