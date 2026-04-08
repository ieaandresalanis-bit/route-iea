import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

/**
 * Shape of data extracted from a fuel receipt via OCR.
 * All fields are optional — OCR may only capture partial data.
 */
export class OcrResultDto {
  @ApiPropertyOptional({ example: 'Gasolinera Pemex Av. Americas' })
  station?: string;

  @ApiPropertyOptional({ example: 45.5 })
  liters?: number;

  @ApiPropertyOptional({ example: 1069.25, description: 'Total amount in MXN' })
  amount?: number;

  @ApiPropertyOptional({ example: 23.50 })
  pricePerLiter?: number;

  @ApiPropertyOptional({ example: '2026-04-02' })
  date?: string;

  @ApiPropertyOptional({ example: 'GASOLINE' })
  fuelType?: string;

  @ApiProperty({ example: 0.85, description: 'OCR confidence score 0-1' })
  confidence!: number;
}
