import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SmsMasivosService } from './sms-masivos.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [SmsMasivosService],
  exports: [SmsMasivosService],
})
export class SmsMasivosModule {}
