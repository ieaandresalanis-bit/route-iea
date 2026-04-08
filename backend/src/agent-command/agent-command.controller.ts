import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AgentCommandService } from './agent-command.service';

@Controller('agent-command')
@UseGuards(JwtAuthGuard)
export class AgentCommandController {
  constructor(private service: AgentCommandService) {}

  @Get()
  async getDashboard() {
    return this.service.getDashboard();
  }
}
