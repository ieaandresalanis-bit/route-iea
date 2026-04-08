import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Vehicles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('vehicles')
export class VehiclesController {
  constructor(private vehiclesService: VehiclesService) {}

  @Post()
  @ApiOperation({ summary: 'Register a new vehicle' })
  create(@Body() dto: CreateVehicleDto) {
    return this.vehiclesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all vehicles' })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'MAINTENANCE', 'INACTIVE'] })
  findAll(@Query('status') status?: string) {
    return this.vehiclesService.findAll(status);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Fleet summary counts' })
  getFleetSummary() {
    return this.vehiclesService.getFleetSummary();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get vehicle details' })
  findOne(@Param('id') id: string) {
    return this.vehiclesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update vehicle' })
  update(@Param('id') id: string, @Body() dto: UpdateVehicleDto) {
    return this.vehiclesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate vehicle' })
  remove(@Param('id') id: string) {
    return this.vehiclesService.remove(id);
  }
}
