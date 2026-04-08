import { IsString, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOdometerLogDto {
  @ApiProperty() @IsString() vehicleId!: string;
  @ApiProperty({ example: 85432 }) @IsNumber() reading!: number;
  @ApiPropertyOptional({ example: 'manual', enum: ['manual', 'gps', 'obd'] })
  @IsString() @IsOptional() source?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() notes?: string;
}
