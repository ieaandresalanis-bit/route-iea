import { Controller, Get, UseGuards } from '@nestjs/common';
import { MetasService } from './metas.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('metas')
@UseGuards(JwtAuthGuard)
export class MetasController {
  constructor(private readonly svc: MetasService) {}

  @Get()
  getMetas() {
    return this.svc.getMetas();
  }
}
