import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MiDiaService } from './mi-dia.service';

@Controller('mi-dia')
@UseGuards(JwtAuthGuard)
export class MiDiaController {
  constructor(private readonly svc: MiDiaService) {}

  @Get()
  getMiDia(@Req() req: any) {
    return this.svc.getMiDia(req.user.id);
  }
}
