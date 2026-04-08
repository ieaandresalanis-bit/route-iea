import { IsString, IsNumber, IsOptional, IsEnum, IsEmail, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Zone, LeadSource } from '@prisma/client';

export class CreateLeadDto {
  @ApiProperty({ example: 'Grupo Industrial ABC' })
  @IsString()
  companyName!: string;

  @ApiProperty({ example: 'Juan Pérez' })
  @IsString()
  contactName!: string;

  @ApiPropertyOptional({ example: 'juan@abc.com' })
  @IsEmail() @IsOptional()
  contactEmail?: string;

  @ApiPropertyOptional({ example: '+52 33 1234 5678' })
  @IsString() @IsOptional()
  contactPhone?: string;

  @ApiPropertyOptional({ example: 'Director de Operaciones' })
  @IsString() @IsOptional()
  position?: string;

  @ApiPropertyOptional({ example: 'https://abc.com' })
  @IsString() @IsOptional()
  website?: string;

  @ApiProperty({ example: 20.6597 })
  @IsNumber() @Min(-90) @Max(90)
  latitude!: number;

  @ApiProperty({ example: -103.3496 })
  @IsNumber() @Min(-180) @Max(180)
  longitude!: number;

  @ApiProperty({ example: 'Av. Vallarta 1234, Guadalajara' })
  @IsString()
  address!: string;

  @ApiPropertyOptional({ example: 'Guadalajara' })
  @IsString() @IsOptional()
  city?: string;

  @ApiPropertyOptional({ example: 'Jalisco' })
  @IsString() @IsOptional()
  state?: string;

  @ApiPropertyOptional({ example: '44100' })
  @IsString() @IsOptional()
  postalCode?: string;

  @ApiProperty({ enum: Zone, example: 'OCCIDENTE' })
  @IsEnum(Zone)
  zone!: Zone;

  @ApiPropertyOptional({ enum: LeadSource, example: 'REFERRAL' })
  @IsEnum(LeadSource) @IsOptional()
  source?: LeadSource;

  @ApiPropertyOptional({ example: 'Manufactura' })
  @IsString() @IsOptional()
  industry?: string;

  @ApiPropertyOptional({ example: 150000.0 })
  @IsNumber() @IsOptional()
  estimatedValue?: number;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: 'User ID of assigned salesperson' })
  @IsString() @IsOptional()
  assignedToId?: string;
}
