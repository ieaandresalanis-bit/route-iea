import { PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { LeadStatus } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateLeadDto } from './create-lead.dto';

export class UpdateLeadDto extends PartialType(CreateLeadDto) {
  @ApiPropertyOptional({ enum: LeadStatus })
  @IsEnum(LeadStatus) @IsOptional()
  status?: LeadStatus;
}
