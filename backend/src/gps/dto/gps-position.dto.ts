import { IsString, IsNumber, IsOptional, IsBoolean, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** DTO for incoming GPS position data (REST or WebSocket) */
export class GpsPositionDto {
  @ApiProperty() @IsString() vehicleId!: string;
  @ApiProperty({ example: 20.6636914 }) @IsNumber() latitude!: number;
  @ApiProperty({ example: -103.2343897 }) @IsNumber() longitude!: number;
  @ApiPropertyOptional() @IsNumber() @IsOptional() altitude?: number;
  @ApiPropertyOptional({ example: 65 }) @IsNumber() @IsOptional() speed?: number;
  @ApiPropertyOptional({ example: 180 }) @IsNumber() @IsOptional() heading?: number;
  @ApiPropertyOptional({ example: 5 }) @IsNumber() @IsOptional() accuracy?: number;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() engineOn?: boolean;
  @ApiPropertyOptional() @IsDateString() @IsOptional() recordedAt?: string;
}
