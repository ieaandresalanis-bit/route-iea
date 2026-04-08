import { Injectable, Logger } from '@nestjs/common';
import { OcrResultDto } from './dto/ocr-result.dto';

/**
 * OCR service for extracting data from fuel receipt images.
 *
 * Currently uses a mock implementation that returns realistic data.
 * To connect a real provider, replace the body of callOcrProvider()
 * with a call to Google Vision, AWS Textract, or Anthropic's vision API.
 */
@Injectable()
export class FuelOcrService {
  private readonly logger = new Logger(FuelOcrService.name);

  /** Process a receipt image and return extracted data */
  async processReceipt(imageUrl: string): Promise<OcrResultDto> {
    this.logger.log(`Processing receipt: ${imageUrl}`);

    const rawData = await this.callOcrProvider(imageUrl);
    const result = this.parseOcrResponse(rawData);

    this.logger.log(`OCR result: ${result.liters}L, $${result.amount} MXN, confidence ${result.confidence}`);
    return result;
  }

  /**
   * Call the OCR provider.
   * SWAP POINT: Replace this method's body with a real provider call.
   *
   * Examples:
   *   - Google Vision: vision.annotateImage({ image: { source: { imageUri } } })
   *   - Anthropic:     claude.messages.create({ content: [{ type: 'image', ... }] })
   *   - AWS Textract:  textract.analyzeExpense({ Document: { ... } })
   */
  private async callOcrProvider(_imageUrl: string): Promise<Record<string, unknown>> {
    this.logger.warn('Using MOCK OCR — replace with real provider for production');
    return this.getMockResult();
  }

  /** Normalize raw OCR output into our standard shape */
  private parseOcrResponse(raw: Record<string, unknown>): OcrResultDto {
    return {
      station: raw.station as string | undefined,
      liters: raw.liters as number | undefined,
      amount: raw.amount as number | undefined,
      pricePerLiter: raw.pricePerLiter as number | undefined,
      date: raw.date as string | undefined,
      fuelType: raw.fuelType as string | undefined,
      confidence: (raw.confidence as number) ?? 0,
    };
  }

  /** Generate realistic mock data for a Mexican gas station receipt */
  private getMockResult(): Record<string, unknown> {
    const stations = [
      'Gasolinera Pemex Av. Americas 1240',
      'Estacion BP Periferico Sur 5200',
      'Gasolinera Total Lopez Mateos 3100',
      'Pemex Av. Vallarta 6000',
      'Shell Carretera a Chapala km 12',
    ];

    const liters = Math.round((30 + Math.random() * 40) * 100) / 100;
    const pricePerLiter = Math.round((22 + Math.random() * 4) * 100) / 100;
    const amount = Math.round(liters * pricePerLiter * 100) / 100;

    return {
      station: stations[Math.floor(Math.random() * stations.length)],
      liters,
      amount,
      pricePerLiter,
      date: new Date().toISOString().split('T')[0],
      fuelType: 'GASOLINE',
      confidence: Math.round((0.8 + Math.random() * 0.18) * 100) / 100,
    };
  }
}
