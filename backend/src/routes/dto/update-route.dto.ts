import { PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { RouteStatus } from '@prisma/client';
import { CreateRouteDto } from './create-route.dto';

export class UpdateRouteDto extends PartialType(CreateRouteDto) {
  @ApiPropertyOptional({ enum: RouteStatus })
  @IsEnum(RouteStatus) @IsOptional()
  status?: RouteStatus;
}
