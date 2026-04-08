import { IsString, IsNumber, IsEnum, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FuelType, FuelSource } from '@prisma/client';

/**
 * DTO for creating a fuel log entry.
 * Supports both manual input and camera/OCR-assisted input.
 *
 * Note: "amount" in the DTO maps to "totalCost" in the database.
 */
export class CreateFuelLogDto {
  @ApiProperty({ description: 'Vehicle UUID' })
  @IsString()
  vehicleId!: string;

  @ApiProperty({ example: 45.5, description: 'Liters filled' })
  @IsNumber()
  liters!: number;

  @ApiProperty({ example: 23.50, description: 'Price per liter in MXN' })
  @IsNumber()
  pricePerLiter!: number;

  @ApiProperty({ example: 1069.25, description: 'Total amount paid in MXN' })
  @IsNumber()
  amount!: number;

  @ApiProperty({ example: 85432, description: 'Odometer reading at fill-up (km)' })
  @IsNumber()
  odometerAt!: number;

  @ApiProperty({ enum: FuelType, example: 'GASOLINE' })
  @IsEnum(FuelType)
  fuelType!: FuelType;

  @ApiPropertyOptional({ example: 'Gasolinera Pemex Av. Americas' })
  @IsString() @IsOptional()
  station?: string;

  @ApiPropertyOptional({ description: 'Notes about this fill-up' })
  @IsString() @IsOptional()
  notes?: string;

  @ApiProperty({ example: '2026-04-02T10:30:00Z', description: 'When the fill-up happened' })
  @IsDateString()
  filledAt!: string;

  // ── New fields for enhanced tracking ──────────────────────

  @ApiPropertyOptional({ example: 20.67, description: 'Latitude of the gas station' })
  @IsNumber() @IsOptional()
  latitude?: number;

  @ApiPropertyOptional({ example: -103.35, description: 'Longitude of the gas station' })
  @IsNumber() @IsOptional()
  longitude?: number;

  @ApiPropertyOptional({ description: 'URL of the receipt photo' })
  @IsString() @IsOptional()
  imageUrl?: string;

  @ApiPropertyOptional({ enum: FuelSource, default: 'MANUAL', description: 'How this entry was created' })
  @IsEnum(FuelSource) @IsOptional()
  source?: FuelSource;
}
