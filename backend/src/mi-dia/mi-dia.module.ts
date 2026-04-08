import { Module } from '@nestjs/common';
import { MiDiaController } from './mi-dia.controller';
import { MiDiaService } from './mi-dia.service';

@Module({
  controllers: [MiDiaController],
  providers: [MiDiaService],
  exports: [MiDiaService],
})
export class MiDiaModule {}
