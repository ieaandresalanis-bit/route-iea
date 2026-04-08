import { IsEmail, IsString, MinLength, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class RegisterDto {
  @ApiProperty({ example: 'andres@iea.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiProperty({ example: 'Andres' })
  @IsString()
  firstName!: string;

  @ApiProperty({ example: 'Alanis' })
  @IsString()
  lastName!: string;

  @ApiPropertyOptional({ enum: UserRole, default: UserRole.OPERATOR })
  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @ApiPropertyOptional({ example: '+52 33 1234 5678' })
  @IsString()
  @IsOptional()
  phone?: string;
}
