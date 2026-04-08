import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { TripStatus } from '@prisma/client';
import { TripsService } from './trips.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Trips')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('trips')
export class TripsController {
  constructor(private tripsService: TripsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new trip' })
  create(@Body() dto: CreateTripDto) {
    return this.tripsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all trips' })
  @ApiQuery({ name: 'status', required: false, enum: TripStatus })
  findAll(@Query('status') status?: TripStatus) {
    return this.tripsService.findAll(status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get trip details' })
  findOne(@Param('id') id: string) {
    return this.tripsService.findOne(id);
  }

  @Patch(':id/start')
  @ApiOperation({ summary: 'Start a planned trip' })
  start(@Param('id') id: string) {
    return this.tripsService.start(id);
  }

  @Patch(':id/complete')
  @ApiOperation({ summary: 'Complete an in-progress trip' })
  complete(@Param('id') id: string, @Body('actualDistanceKm') km?: number) {
    return this.tripsService.complete(id, km);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a trip' })
  cancel(@Param('id') id: string) {
    return this.tripsService.cancel(id);
  }
}
