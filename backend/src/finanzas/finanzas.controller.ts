import { Controller, Get, UseGuards } from '@nestjs/common';
import { FinanzasService } from './finanzas.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('finanzas')
@UseGuards(JwtAuthGuard)
export class FinanzasController {
  constructor(private readonly svc: FinanzasService) {}

  @Get()
  getDashboard() {
    return this.svc.getDashboard();
  }
}
