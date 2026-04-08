import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { MultiChannelService } from './multi-channel.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('multi-channel')
@UseGuards(JwtAuthGuard)
export class MultiChannelController {
  private readonly logger = new Logger(MultiChannelController.name);

  constructor(private readonly multiChannel: MultiChannelService) {}

  /** List active templates, optionally filtered by channel */
  @Get('templates')
  getTemplatesByChannel(@Query('channel') channel?: string) {
    return this.multiChannel.getTemplatesByChannel(channel);
  }

  /** All templates grouped by channel */
  @Get('templates/all')
  getAllTemplates() {
    return this.multiChannel.getAllTemplatesGrouped();
  }

  /** Render a template with lead data */
  @Post('render')
  renderTemplate(@Body() body: { templateKey: string; leadId: string }) {
    return this.multiChannel.renderTemplate(body.templateKey, body.leadId);
  }

  /** Prepare outreach for a single lead */
  @Post('prepare')
  prepareOutreach(
    @Body() body: { leadId: string; channel: string; templateKey?: string },
  ) {
    return this.multiChannel.prepareOutreach(
      body.leadId,
      body.channel as any,
      body.templateKey,
    );
  }

  /** Prepare outreach for multiple leads */
  @Post('prepare-bulk')
  prepareBulkOutreach(
    @Body() body: { leadIds: string[]; channel: string; templateKey?: string },
  ) {
    return this.multiChannel.prepareBulkOutreach(
      body.leadIds,
      body.channel as any,
      body.templateKey,
    );
  }

  /** Log that a communication was sent (manual for now) */
  @Post('log')
  logCommunication(
    @Body()
    body: {
      leadId: string;
      channel: string;
      messageBody: string;
      templateKey?: string;
      advisorId: string;
    },
  ) {
    return this.multiChannel.logCommunication(body);
  }

  /** Communication history for a lead */
  @Get('history/:leadId')
  getCommunicationHistory(@Param('leadId') leadId: string) {
    return this.multiChannel.getCommunicationHistory(leadId);
  }

  /** Per-channel statistics */
  @Get('stats')
  getChannelStats() {
    return this.multiChannel.getChannelStats();
  }

  /** Recommended channel for a lead */
  @Get('recommend/:leadId')
  getRecommendedChannel(@Param('leadId') leadId: string) {
    return this.multiChannel.getRecommendedChannel(leadId);
  }
}
