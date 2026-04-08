import { PartialType } from '@nestjs/swagger';
import { CreateVehicleDto } from './create-vehicle.dto';
import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { VehicleStatus } from '@prisma/client';

export class UpdateVehicleDto extends PartialType(CreateVehicleDto) {
  @ApiPropertyOptional({ enum: VehicleStatus })
  @IsEnum(VehicleStatus) @IsOptional()
  status?: VehicleStatus;
}
