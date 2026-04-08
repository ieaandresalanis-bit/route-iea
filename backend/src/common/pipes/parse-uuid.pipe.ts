import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates that a route param is a valid UUID.
 */
@Injectable()
export class ParseUUIDPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID_REGEX.test(value)) {
      throw new BadRequestException(`"${value}" is not a valid UUID`);
    }
    return value;
  }
}
