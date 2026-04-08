import {
  Controller,
  Get,
  Post,
  Patch,
  Query,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LiveChatService } from './live-chat.service';

@Controller('live-chat')
@UseGuards(JwtAuthGuard)
export class LiveChatController {
  constructor(private readonly svc: LiveChatService) {}

  // ─── Inbox ───────────────────────────────────────────────

  @Get('inbox')
  getInbox(
    @Req() req: any,
    @Query('advisorId') advisorId?: string,
    @Query('type') type?: string,
    @Query('filter') filter?: string,
    @Query('zone') zone?: string,
    @Query('stage') stage?: string,
    @Query('search') search?: string,
    @Query('minAmount') minAmount?: string,
    @Query('maxAmount') maxAmount?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.getInbox(req.user, {
      advisorId,
      type: type as any,
      filter: filter as any,
      zone,
      stage,
      search,
      minAmount: minAmount ? parseFloat(minAmount) : undefined,
      maxAmount: maxAmount ? parseFloat(maxAmount) : undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 25,
    });
  }

  // ─── Profile ─────────────────────────────────────────────

  @Get('profile/:leadId')
  getProfile(@Param('leadId') leadId: string) {
    return this.svc.getProfile(leadId);
  }

  // ─── Note ────────────────────────────────────────────────

  @Post('note')
  createNote(
    @Req() req: any,
    @Body() body: { leadId: string; content: string },
  ) {
    return this.svc.createNote(req.user.id, body.leadId, body.content);
  }

  // ─── SMS ─────────────────────────────────────────────────

  @Post('sms')
  sendSms(
    @Req() req: any,
    @Body() body: { leadId: string; phone: string; message: string },
  ) {
    return this.svc.sendSms(req.user.id, body.leadId, body.phone, body.message);
  }

  // ─── Reminder ────────────────────────────────────────────

  @Post('reminder')
  createReminder(
    @Req() req: any,
    @Body()
    body: {
      leadId: string;
      title: string;
      description?: string;
      dueDate: string;
      priority?: string;
    },
  ) {
    return this.svc.createReminder(req.user.id, body);
  }

  @Patch('reminder/:id/complete')
  completeReminder(@Req() req: any, @Param('id') id: string) {
    return this.svc.completeReminder(req.user.id, id);
  }

  // ─── WhatsApp log ────────────────────────────────────────

  @Post('whatsapp-log')
  logWhatsApp(
    @Req() req: any,
    @Body() body: { leadId: string },
  ) {
    return this.svc.logWhatsApp(req.user.id, body.leadId);
  }

  // ─── Stage ───────────────────────────────────────────────

  @Patch('stage')
  changeStage(
    @Req() req: any,
    @Body() body: { leadId: string; newStage: string; notes?: string },
  ) {
    return this.svc.changeStage(req.user.id, body.leadId, body.newStage, body.notes);
  }

  // ─── Activity ────────────────────────────────────────────

  @Post('activity')
  logActivity(
    @Req() req: any,
    @Body()
    body: { leadId: string; type: string; channel?: string; notes?: string },
  ) {
    return this.svc.logActivity(req.user.id, body);
  }

  // ─── Timeline ────────────────────────────────────────────

  @Get('timeline/:leadId')
  getTimeline(@Param('leadId') leadId: string) {
    return this.svc.getTimeline(leadId);
  }

  // ─── Suggestions ─────────────────────────────────────────

  @Get('suggestions/:leadId')
  getSuggestions(@Param('leadId') leadId: string) {
    return this.svc.getSuggestions(leadId);
  }
}
