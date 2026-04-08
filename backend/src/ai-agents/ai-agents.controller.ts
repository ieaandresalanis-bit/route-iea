import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { AiAgentsService } from './ai-agents.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiAgentsController {
  constructor(private readonly aiAgents: AiAgentsService) {}

  // ─── AGENT 1: Commercial Director ───────────────────────
  @Get('director')
  getDirectorBriefing() {
    return this.aiAgents.getDirectorBriefing();
  }

  // ─── AGENT 2: Priority & Opportunity ────────────────────
  @Get('priorities')
  getPriorityIntelligence() {
    return this.aiAgents.getPriorityIntelligence();
  }

  // ─── AGENT 3: Sales Coach ──────────────────────────────
  @Post('coach')
  getCoachAdvice(
    @Body() body: { leadId: string; advisorId: string; situation?: string },
  ) {
    return this.aiAgents.getCoachAdvice(body.leadId, body.advisorId, body.situation);
  }

  // ─── AGENT 4: Reactivation ────────────────────────────
  @Get('reactivation')
  getReactivationPlan() {
    return this.aiAgents.getReactivationPlan();
  }

  // ─── AGENT 5: Post-Sale Intelligence ──────────────────
  @Get('post-sale')
  getPostSaleBriefing() {
    return this.aiAgents.getPostSaleBriefing();
  }
}
