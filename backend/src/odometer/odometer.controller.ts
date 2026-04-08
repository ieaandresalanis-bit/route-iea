import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { OdometerService } from './odometer.service';
import { CreateOdometerLogDto } from './dto/create-odometer-log.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Odometer')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('odometer')
export class OdometerController {
  constructor(private odometerService: OdometerService) {}

  @Post()
  @ApiOperation({ summary: 'Record an odometer reading' })
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateOdometerLogDto) {
    return this.odometerService.create(user.id, dto);
  }

  @Get('vehicle/:vehicleId')
  @ApiOperation({ summary: 'Get odometer history for a vehicle' })
  findByVehicle(@Param('vehicleId') vehicleId: string) {
    return this.odometerService.findByVehicle(vehicleId);
  }
}
