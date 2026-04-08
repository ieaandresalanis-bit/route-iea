import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { FuelService } from './fuel.service';
import { CreateFuelLogDto } from './dto/create-fuel-log.dto';
import { ProcessReceiptDto } from './dto/process-receipt.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

/**
 * Fuel management endpoints.
 *
 * ROUTE ORDER MATTERS: literal paths (like /dashboard) must come before
 * parameterized paths (like /vehicle/:vehicleId) to avoid NestJS
 * interpreting "dashboard" as a vehicleId.
 */
@ApiTags('Fuel')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fuel')
export class FuelController {
  constructor(private fuelService: FuelService) {}

  // ── Create ──────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Record a fuel fill-up (manual or camera-assisted)' })
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateFuelLogDto) {
    return this.fuelService.create(user.id, dto);
  }

  @Post('receipt')
  @ApiOperation({
    summary: 'Process a receipt photo with OCR',
    description: 'Send a receipt image URL. Returns extracted data (station, liters, amount) for user confirmation before saving.',
  })
  processReceipt(@Body() dto: ProcessReceiptDto) {
    return this.fuelService.processReceipt(dto.imageUrl);
  }

  // ── List ────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List all fuel logs (paginated)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'vehicleId', required: false, description: 'Filter by vehicle' })
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('vehicleId') vehicleId?: string,
  ) {
    return this.fuelService.findAll(
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
      vehicleId,
    );
  }

  // ── Dashboard (must be before :vehicleId routes) ────────────

  @Get('dashboard')
  @ApiOperation({ summary: 'Fleet-wide fuel dashboard (cost, efficiency, last load)' })
  getFleetDashboard() {
    return this.fuelService.getFleetDashboard();
  }

  // ── Per-vehicle endpoints ───────────────────────────────────

  @Get('vehicle/:vehicleId')
  @ApiOperation({ summary: 'Get fuel history for a vehicle' })
  findByVehicle(@Param('vehicleId') vehicleId: string) {
    return this.fuelService.findByVehicle(vehicleId);
  }

  @Get('vehicle/:vehicleId/efficiency')
  @ApiOperation({ summary: 'Get fuel efficiency (km/L and cost/km)' })
  getEfficiency(@Param('vehicleId') vehicleId: string) {
    return this.fuelService.getEfficiency(vehicleId);
  }

  @Get('vehicle/:vehicleId/stats')
  @ApiOperation({
    summary: 'Full fuel stats with anomaly detection',
    description: 'Returns avg km/L, cost/km, total spent, total liters, and flagged anomalies.',
  })
  getVehicleStats(@Param('vehicleId') vehicleId: string) {
    return this.fuelService.getVehicleStats(vehicleId);
  }
}
