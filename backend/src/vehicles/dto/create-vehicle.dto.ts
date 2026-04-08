import { IsString, IsInt, IsEnum, IsOptional, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VehicleType, FuelType } from '@prisma/client';

export class CreateVehicleDto {
  @ApiProperty({ example: 'JMH-1234' })
  @IsString()
  plateNumber!: string;

  @ApiPropertyOptional({ example: '1HGCM82633A123456' })
  @IsString() @IsOptional()
  vin?: string;

  @ApiProperty({ example: 'Toyota' })
  @IsString()
  brand!: string;

  @ApiProperty({ example: 'Hilux' })
  @IsString()
  model!: string;

  @ApiProperty({ example: 2023 })
  @IsInt() @Min(1990) @Max(2030)
  year!: number;

  @ApiPropertyOptional({ example: 'White' })
  @IsString() @IsOptional()
  color?: string;

  @ApiPropertyOptional({ enum: VehicleType })
  @IsEnum(VehicleType) @IsOptional()
  type?: VehicleType;

  @ApiPropertyOptional({ enum: FuelType })
  @IsEnum(FuelType) @IsOptional()
  fuelType?: FuelType;

  @ApiPropertyOptional({ example: 80, description: 'Tank capacity in liters' })
  @IsNumber() @IsOptional()
  tankCapacity?: number;

  @ApiPropertyOptional({ description: 'UUID of the driver to assign' })
  @IsString() @IsOptional()
  driverId?: string;
}
