import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ZohoApiService } from './zoho-api.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [ZohoApiService],
  exports: [ZohoApiService],
})
export class ZohoApiModule {}
