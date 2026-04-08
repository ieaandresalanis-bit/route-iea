import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** A single anomalous fuel entry */
export class FuelAnomalyItem {
  @ApiProperty() id!: string;
  @ApiProperty() kmPerLiter!: number;
  @ApiProperty() liters!: number;
  @ApiProperty() filledAt!: Date;
}

/**
 * Comprehensive fuel statistics for a vehicle.
 * Returned by GET /api/fuel/vehicle/:id/stats
 */
export class FuelStatsDto {
  @ApiProperty({ example: 12.5 }) avgKmPerLiter!: number | null;
  @ApiProperty({ example: 1.88 }) costPerKm!: number | null;
  @ApiProperty({ example: 45320 }) totalSpent!: number;
  @ApiProperty({ example: 1925 }) totalLiters!: number;
  @ApiProperty({ example: 42 }) totalFillUps!: number;
  @ApiProperty({ example: 1 }) anomalyCount!: number;
  @ApiProperty({ type: [FuelAnomalyItem] }) anomalies!: FuelAnomalyItem[];
}
