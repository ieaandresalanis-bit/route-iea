import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AssistantService, ChatResponse } from './assistant.service';

@Controller('assistant')
@UseGuards(JwtAuthGuard)
export class AssistantController {
  constructor(private service: AssistantService) {}

  @Post('chat')
  async chat(@Request() req: any, @Body() body: { message: string }): Promise<ChatResponse> {
    return this.service.chat(body.message, req.user.id);
  }
}
