import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TeamManagementService } from './team-management.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Team Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('team')
export class TeamManagementController {
  constructor(private readonly teamService: TeamManagementService) {}

  @Get('structure')
  @ApiOperation({ summary: 'Full team structure with workload and performance' })
  getTeamStructure() {
    return this.teamService.getTeamStructure();
  }

  @Get('historical-map')
  @ApiOperation({ summary: 'Historical ownership map for all leads' })
  getHistoricalOwnershipMap() {
    return this.teamService.getHistoricalOwnershipMap();
  }

  @Get('recovery')
  @ApiOperation({ summary: 'Recovery opportunities grouped by urgency' })
  getRecoveryOpportunities() {
    return this.teamService.getRecoveryOpportunities();
  }

  @Get('advisor/:id/daily')
  @ApiOperation({ summary: 'Daily targets and priorities for an advisor' })
  getAdvisorDailyTargets(@Param('id') id: string) {
    return this.teamService.getAdvisorDailyTargets(id);
  }

  @Post('reassign')
  @ApiOperation({ summary: 'Reassign leads to a target advisor' })
  reassignLeads(
    @Body()
    body: {
      leadIds: string[];
      targetAdvisorId: string;
      reason: 'redistribution' | 'recovery' | 'rebalance';
    },
  ) {
    return this.teamService.reassignLeads(body);
  }

  @Post('auto-distribute')
  @ApiOperation({ summary: 'Auto-distribute leads from inactive advisors and main account' })
  autoDistribute() {
    return this.teamService.autoDistribute();
  }

  @Post('mark-current')
  @ApiOperation({ summary: 'Mark emails as current active team' })
  markCurrentTeam(@Body() body: { emails: string[] }) {
    return this.teamService.markCurrentTeam(body.emails);
  }
}
