import { IsString, IsEmail, IsEnum, IsOptional, IsBoolean, MinLength, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class CreateUserDto {
  @ApiProperty({ example: 'Juan' })
  @IsString()
  firstName!: string;

  @ApiProperty({ example: 'Perez' })
  @IsString()
  lastName!: string;

  @ApiProperty({ example: 'juan.perez@iea.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'SecurePass123!', minLength: 6 })
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiProperty({ enum: ['SUPERADMIN', 'OPERATIONS', 'OPERATOR'], example: 'OPERATOR' })
  @IsEnum(UserRole)
  role!: UserRole;

  @ApiPropertyOptional({ example: '+52 33 1234 5678' })
  @IsString() @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 'Operaciones' })
  @IsString() @IsOptional()
  department?: string;

  @ApiPropertyOptional({ example: 'Tecnico Electricista' })
  @IsString() @IsOptional()
  jobTitle?: string;

  @ApiPropertyOptional({ example: false })
  @IsBoolean() @IsOptional()
  isCrewLeader?: boolean;

  // Operator-only license fields
  @ApiPropertyOptional({ example: 'LIC-GDL-12345' })
  @IsString() @IsOptional()
  licenseNumber?: string;

  @ApiPropertyOptional({ example: 'https://storage.iea.com/licenses/juan-perez.jpg' })
  @IsString() @IsOptional()
  licenseImageUrl?: string;

  @ApiPropertyOptional({ example: '2027-12-31' })
  @IsDateString() @IsOptional()
  licenseExpiration?: string;
}
