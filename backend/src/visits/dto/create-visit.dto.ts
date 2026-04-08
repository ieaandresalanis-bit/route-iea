import { IsString, IsOptional, IsEnum, IsDateString, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VisitOutcome } from '@prisma/client';

export class CreateVisitDto {
  @ApiProperty() @IsString() leadId!: string;
  @ApiPropertyOptional() @IsString() @IsOptional() routeId?: string;
  @ApiProperty() @IsString() visitedById!: string;
  @ApiProperty() @IsDateString() visitDate!: string;
  @ApiProperty({ enum: VisitOutcome }) @IsEnum(VisitOutcome) outcome!: VisitOutcome;
  @ApiPropertyOptional() @IsString() @IsOptional() notes?: string;
  @ApiPropertyOptional() @IsDateString() @IsOptional() followUpDate?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() followUpNotes?: string;
}

export class CheckInDto {
  @ApiProperty() @IsNumber() latitude!: number;
  @ApiProperty() @IsNumber() longitude!: number;
}
