import { IsString, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Request body for receipt OCR processing.
 * The user uploads the image elsewhere and sends the URL here.
 */
export class ProcessReceiptDto {
  @ApiProperty({
    example: 'https://storage.iea.com/receipts/ticket-2026-04-02.jpg',
    description: 'Public URL of the fuel receipt image',
  })
  @IsString()
  @IsUrl()
  imageUrl!: string;
}
