import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SupervisorAgentService } from './supervisor-agent.service';

@Controller('supervisor-agent')
@UseGuards(JwtAuthGuard)
export class SupervisorAgentController {
  private readonly logger = new Logger('SupervisorAgentController');

  constructor(private readonly service: SupervisorAgentService) {}

  // ─────────────────────────────────────────────────────────
  // GET endpoints
  // ─────────────────────────────────────────────────────────

  @Get('panel')
  async getPanel() {
    try {
      return this.service.getNetoControlPanel();
    } catch (error) {
      this.logger.error('Error obteniendo panel', error);
      throw new HttpException(
        'Error obteniendo panel de control',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('inactivity')
  async getInactivity() {
    try {
      return this.service.detectInactivity();
    } catch (error) {
      this.logger.error('Error detectando inactividad', error);
      throw new HttpException(
        'Error detectando inactividad',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('stuck-deals')
  async getStuckDeals() {
    try {
      return this.service.detectStuckDeals();
    } catch (error) {
      this.logger.error('Error detectando tratos estancados', error);
      throw new HttpException(
        'Error detectando tratos estancados',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('channel-readiness')
  async getChannelReadiness() {
    try {
      return this.service.getChannelReadiness();
    } catch (error) {
      this.logger.error('Error verificando canales', error);
      throw new HttpException(
        'Error verificando disponibilidad de canales',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('morning-briefing')
  async getMorningBriefing() {
    try {
      return this.service.generateMorningBriefing();
    } catch (error) {
      this.logger.error('Error generando briefing', error);
      throw new HttpException(
        'Error generando briefing matutino',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ─────────────────────────────────────────────────────────
  // POST endpoints
  // ─────────────────────────────────────────────────────────

  @Post('reassign-lead')
  async reassignLead(
    @Body() body: { leadId: string; fromAdvisorId: string; toAdvisorId: string; reason: string },
  ) {
    try {
      if (!body.leadId || !body.fromAdvisorId || !body.toAdvisorId || !body.reason) {
        throw new HttpException(
          'Se requieren leadId, fromAdvisorId, toAdvisorId y reason',
          HttpStatus.BAD_REQUEST,
        );
      }
      return this.service.reassignLead(
        body.leadId,
        body.fromAdvisorId,
        body.toAdvisorId,
        body.reason,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Error reasignando lead', error);
      throw new HttpException(
        'Error reasignando lead',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('bulk-reassign')
  async bulkReassign(
    @Body() body: { advisorId: string; targetAdvisorId: string; reason: string },
  ) {
    try {
      if (!body.advisorId || !body.targetAdvisorId || !body.reason) {
        throw new HttpException(
          'Se requieren advisorId, targetAdvisorId y reason',
          HttpStatus.BAD_REQUEST,
        );
      }
      return this.service.bulkReassign(
        body.advisorId,
        body.targetAdvisorId,
        body.reason,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Error en reasignacion masiva', error);
      throw new HttpException(
        'Error en reasignacion masiva',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('escalate')
  async escalate(@Body() body: { leadId: string; reason: string }) {
    try {
      if (!body.leadId || !body.reason) {
        throw new HttpException(
          'Se requieren leadId y reason',
          HttpStatus.BAD_REQUEST,
        );
      }
      return this.service.escalateToDirector(body.leadId, body.reason);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Error escalando', error);
      throw new HttpException(
        'Error escalando a director',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('force-action')
  async forceAction(
    @Body() body: { taskId: string; action: 'start' | 'reassign' | 'escalate'; params?: { toAdvisorId?: string; reason?: string } },
  ) {
    try {
      if (!body.taskId || !body.action) {
        throw new HttpException(
          'Se requieren taskId y action',
          HttpStatus.BAD_REQUEST,
        );
      }
      return this.service.forceAction(body.taskId, body.action, body.params);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Error forzando accion', error);
      throw new HttpException(
        'Error forzando accion',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('prepare-message')
  async prepareMessage(
    @Body() body: { leadId: string; channel: string; templateKey?: string },
  ) {
    try {
      if (!body.leadId || !body.channel) {
        throw new HttpException(
          'Se requieren leadId y channel',
          HttpStatus.BAD_REQUEST,
        );
      }
      return this.service.prepareMessage(
        body.leadId,
        body.channel,
        body.templateKey,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Error preparando mensaje', error);
      throw new HttpException(
        'Error preparando mensaje',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
