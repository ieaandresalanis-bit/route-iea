import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CommandCenterService } from './command-center.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('command-center')
@UseGuards(JwtAuthGuard)
export class CommandCenterController {
  constructor(private readonly cc: CommandCenterService) {}

  @Get('dashboard')
  getDashboard() {
    return this.cc.getDashboard();
  }

  @Get('urgency')
  getUrgency() {
    return this.cc.getUrgencyToday();
  }

  @Get('creation')
  getCreation() {
    return this.cc.getCreationBreakdown();
  }

  @Get('director')
  getDirectorView() {
    return this.cc.getDirectorView();
  }

  @Get('supervisor')
  getSupervisorView() {
    return this.cc.getSupervisorView();
  }

  @Get('advisors')
  getAdvisors() {
    return this.cc.getAdvisors();
  }

  @Get('advisor/:id')
  getAdvisorProfile(@Param('id') id: string) {
    return this.cc.getAdvisorProfile(id);
  }

  @Get('agent-guidance')
  getAgentGuidance() {
    return this.cc.getAgentGuidance();
  }

  @Get('live')
  getLiveFeed(@Query('limit') limit?: string) {
    return this.cc.getLiveFeed(limit ? parseInt(limit) : 50);
  }

  @Get('briefing')
  getBriefing() {
    return this.cc.getBriefing();
  }

  @Get('agents')
  getAgentsStatus() {
    return this.cc.getAgentsStatus();
  }
}
