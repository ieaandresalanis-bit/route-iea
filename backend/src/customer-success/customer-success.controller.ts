import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CustomerSuccessService } from './customer-success.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('customer-success')
@UseGuards(JwtAuthGuard)
export class CustomerSuccessController {
  constructor(private readonly cs: CustomerSuccessService) {}

  /** Full department status — agents, KPIs, director & supervisor views */
  @Get('status')
  getDepartmentStatus() {
    return this.cs.getDepartmentStatus();
  }

  /** Client Experience KPIs */
  @Get('kpis')
  getKPIs() {
    return this.cs.getExperienceKPIs();
  }

  /** Agent statuses */
  @Get('agents')
  getAgents() {
    return this.cs.getAgentStatuses();
  }

  /** Director strategic view — risks, expansions, referrals, health */
  @Get('director')
  getDirectorView() {
    return this.cs.getDirectorView();
  }

  /** Supervisor view — advisor performance on client success */
  @Get('supervisor')
  getSupervisorView() {
    return this.cs.getSupervisorView();
  }

  /** Last cycle result */
  @Get('last-cycle')
  getLastCycle() {
    return this.cs.getLastCycleResult() ?? { message: 'No cycle has run yet' };
  }

  /** Manually trigger a Customer Success cycle */
  @Post('trigger-cycle')
  triggerCycle() {
    return this.cs.runCustomerSuccessCycle();
  }
}
