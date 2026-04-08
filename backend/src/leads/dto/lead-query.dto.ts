import { IsOptional, IsString, IsEnum, IsNumberString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Zone, LeadStatus } from '@prisma/client';

export class LeadQueryDto {
  @ApiPropertyOptional({ enum: Zone })
  @IsEnum(Zone) @IsOptional()
  zone?: Zone;

  @ApiPropertyOptional({ enum: LeadStatus })
  @IsEnum(LeadStatus) @IsOptional()
  status?: LeadStatus;

  @ApiPropertyOptional({ description: 'Search company or contact name' })
  @IsString() @IsOptional()
  search?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  assignedToId?: string;

  @ApiPropertyOptional({ default: '1' })
  @IsNumberString() @IsOptional()
  page?: string;

  @ApiPropertyOptional({ default: '50' })
  @IsNumberString() @IsOptional()
  limit?: string;
}
