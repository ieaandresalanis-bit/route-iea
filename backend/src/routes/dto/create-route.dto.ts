import { IsString, IsOptional, IsEnum, IsDateString, IsArray, IsNumber, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Zone } from '@prisma/client';

export class RouteStopDto {
  @ApiProperty() @IsUUID() leadId!: string;
  @ApiProperty() @IsNumber() order!: number;
}

export class CreateRouteDto {
  @ApiProperty({ example: 'Ruta Bajío - Abril 2026' })
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: Zone })
  @IsEnum(Zone) @IsOptional()
  zone?: Zone;

  @ApiPropertyOptional()
  @IsDateString() @IsOptional()
  plannedDate?: string;

  @ApiProperty({ description: 'Assigned salesperson user ID' })
  @IsString()
  assignedToId!: string;

  @ApiPropertyOptional({ description: 'Vehicle ID' })
  @IsString() @IsOptional()
  vehicleId?: string;

  @ApiPropertyOptional({ type: [RouteStopDto] })
  @IsArray() @IsOptional()
  stops?: RouteStopDto[];
}
