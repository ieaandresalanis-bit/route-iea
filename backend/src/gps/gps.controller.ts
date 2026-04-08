import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { GpsService } from './gps.service';
import { GpsGateway } from './gps.gateway';
import { GpsPositionDto } from './dto/gps-position.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('GPS')
@Controller('gps')
export class GpsController {
  constructor(
    private gpsService: GpsService,
    private gpsGateway: GpsGateway,
  ) {}

  /** Record a GPS position via REST (alternative to WebSocket) */
  @Post('position')
  @ApiOperation({ summary: 'Record a GPS position' })
  async recordPosition(@Body() dto: GpsPositionDto) {
    const log = await this.gpsService.recordPosition(dto);

    // Also broadcast via WebSocket
    this.gpsGateway.server
      .to(`vehicle:${dto.vehicleId}`)
      .emit('gps:update', { ...dto, recordedAt: log.recordedAt });

    return log;
  }

  /** Record a batch of GPS positions */
  @Post('batch')
  @ApiOperation({ summary: 'Record a batch of GPS positions' })
  recordBatch(@Body() positions: GpsPositionDto[]) {
    return this.gpsService.recordBatch(positions);
  }

  /** Get all vehicles' latest positions */
  @Get('fleet')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get latest position for all active vehicles' })
  getFleetPositions() {
    return this.gpsService.getLatestPositions();
  }

  /** Get GPS history for a vehicle */
  @Get('vehicle/:vehicleId/history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get GPS history for a vehicle' })
  @ApiQuery({ name: 'from', required: true, example: '2024-01-01T00:00:00Z' })
  @ApiQuery({ name: 'to', required: true, example: '2024-01-31T23:59:59Z' })
  getVehicleHistory(
    @Param('vehicleId') vehicleId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.gpsService.getVehicleHistory(vehicleId, new Date(from), new Date(to));
  }

  /** Get the latest position for a single vehicle */
  @Get('vehicle/:vehicleId/latest')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get latest position for a vehicle' })
  getVehicleLatest(@Param('vehicleId') vehicleId: string) {
    return this.gpsService.getVehicleLatest(vehicleId);
  }
}
