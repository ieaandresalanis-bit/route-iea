import { IsString, IsNumber, IsOptional, IsDateString, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WaypointDto {
  @ApiProperty() @IsNumber() latitude!: number;
  @ApiProperty() @IsNumber() longitude!: number;
  @ApiPropertyOptional() @IsString() @IsOptional() address?: string;
  @ApiProperty() @IsNumber() order!: number;
}

export class CreateTripDto {
  @ApiProperty({ example: 'Service call - Zapopan' })
  @IsString()
  title!: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  description?: string;

  @ApiProperty() @IsNumber() originLat!: number;
  @ApiProperty() @IsNumber() originLng!: number;
  @ApiProperty() @IsString() originAddress!: string;
  @ApiProperty() @IsNumber() destLat!: number;
  @ApiProperty() @IsNumber() destLng!: number;
  @ApiProperty() @IsString() destAddress!: string;

  @ApiPropertyOptional() @IsNumber() @IsOptional() plannedDistanceKm?: number;
  @ApiPropertyOptional() @IsDateString() @IsOptional() plannedStartTime?: string;

  @ApiProperty() @IsString() vehicleId!: string;
  @ApiProperty() @IsString() driverId!: string;

  @ApiPropertyOptional({ type: [WaypointDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => WaypointDto) @IsOptional()
  waypoints?: WaypointDto[];
}
