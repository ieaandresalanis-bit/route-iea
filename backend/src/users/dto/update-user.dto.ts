import { IsString, IsEmail, IsEnum, IsOptional, IsBoolean, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class UpdateUserDto {
  @ApiPropertyOptional() @IsString() @IsOptional() firstName?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() lastName?: string;
  @ApiPropertyOptional() @IsEmail() @IsOptional() email?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() phone?: string;

  @ApiPropertyOptional({ enum: ['SUPERADMIN', 'OPERATIONS', 'OPERATOR'] })
  @IsEnum(UserRole) @IsOptional()
  role?: UserRole;

  @ApiPropertyOptional() @IsBoolean() @IsOptional() isActive?: boolean;
  @ApiPropertyOptional() @IsString() @IsOptional() department?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() jobTitle?: string;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isCrewLeader?: boolean;

  // Operator license fields
  @ApiPropertyOptional() @IsString() @IsOptional() licenseNumber?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() licenseImageUrl?: string;
  @ApiPropertyOptional() @IsDateString() @IsOptional() licenseExpiration?: string;
}
