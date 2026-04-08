import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AgentLayerService } from './agent-layer.service';

@Controller('agent-layer')
@UseGuards(JwtAuthGuard)
export class AgentLayerController {
  constructor(private readonly svc: AgentLayerService) {}

  @Get()
  getDashboard() {
    return this.svc.getDashboard();
  }
}
